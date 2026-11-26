// Facturación CFDI 4.0 con el PAC simulado: datos fiscales, factura a cliente (PUE y PPD), global, autofactura,
// nota de crédito, complemento de pago, cancelación con PIN, bloqueo de cancelar ventas facturadas, XML e impresión.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const CARPETA = fs.mkdtempSync(path.join(os.tmpdir(), 'vetshop-facturas-'));
process.env.ALMACENAMIENTO = 'local';
process.env.ALMACENAMIENTO_CARPETA = CARPETA;
process.env.FACTURACION_PAC = 'simulado';

const h = require('./helpers/app');
const Producto = require('../models/Producto');
const Venta = require('../models/Venta');
const Factura = require('../models/Factura');
const IntentoAutofactura = require('../models/IntentoAutofactura');
const inv = require('../services/inventario');
const precios = require('../services/precios');
const { conTransaccion } = require('../helpers/transaccion');
const { diaLocal } = require('../helpers/fechas');
const { Auditoria } = h.modelos;

let A, dueno, cajero, collar, croqueta, clinica, sinDatos;
const PIN = '4821';

beforeAll(async () => {
  await h.resetDb();
  A = await h.crearSucursal({ nombre: 'Centro', tipo: 'tienda' });
  dueno = await h.sesion({ rol: 'dueno', pin: PIN });
  cajero = await h.sesion({ rol: 'cajero', sucursales: [A._id] });
  collar = await Producto.create({ sku: 'COL', nombre: 'Collar', categoria: 'accesorio', unidad: 'pieza', iva: 'tasa_16', claveSat: '10141600' });
  croqueta = await Producto.create({ sku: 'CRO', nombre: 'Croqueta', categoria: 'otro', unidad: 'kg', iva: 'tasa_0' });
  await precios.fijarPrecio({ clave: 'publico', productoId: collar._id, precio: 11600 }, dueno.usuario); // $116 con IVA
  await precios.fijarPrecio({ clave: 'publico', productoId: croqueta._id, precio: 5000 }, dueno.usuario); // $50/kg
  for (const p of [collar, croqueta]) {
    await conTransaccion(s => inv.registrarEntrada({ sucursal: A._id, producto: p._id, cantidad: 100000, costoUnitario: 100, origen: 'compra', usuario: dueno.usuario._id }, s));
  }
  await h.abrirTurno(cajero, A);
  const cliente = datos => h.request(h.app).post('/api/clientes').set(h.auth(dueno.token)).send({ tipo: 'clinica', listaPrecios: 'publico', ...datos });
  clinica = (await cliente({
    nombre: 'Clínica Patitas', rfc: 'CPA850101AB1', credito: { activo: true, limite: 1000000 },
    fiscal: { razonSocial: 'Clínica Patitas SA de CV', regimen: '601', codigoPostal: '63000', usoCfdi: 'G03' }
  })).body.datos;
  sinDatos = (await cliente({ nombre: 'Sin datos' })).body.datos;
});
afterAll(async () => {
  await h.cerrar();
  fs.rmSync(CARPETA, { recursive: true, force: true });
});

const api = (s, metodo, ruta) => h.request(h.app)[metodo](ruta).set(h.auth(s.token, A));
const vender = (partidas, pagos, extra = {}) =>
  api(cajero, 'post', '/api/ventas').send({ claveOperacion: randomUUID(), partidas, pagos, ...extra }).then(r => {
    expect(r.status).toBe(201);
    return r.body.datos;
  });
const facturar = (cuerpo, s = cajero) => api(s, 'post', '/api/facturas').send({ claveOperacion: randomUUID(), ...cuerpo });
const pinDueno = () => ({ usuario: dueno.usuario.usuario, pin: PIN });

let ventaTarjeta, facturaCliente, ventaCredito, facturaPPD;

describe('datos fiscales', () => {
  test('el cliente guarda razón social, régimen, CP y uso; el producto su clave SAT', async () => {
    expect(clinica.fiscal).toEqual({ razonSocial: 'CLÍNICA PATITAS SA DE CV', regimen: '601', codigoPostal: '63000', usoCfdi: 'G03' });
    const malo = await h.request(h.app).patch(`/api/clientes/${clinica.id}`).set(h.auth(dueno.token)).send({ fiscal: { codigoPostal: '630' } });
    expect(malo.status).toBe(400);
    const p = await h.request(h.app).get(`/api/productos/${collar._id}`).set(h.auth(dueno.token));
    expect(p.body.datos.claveSat).toBe('10141600');
  });
});

describe('factura a cliente', () => {
  test('PUE con forma de pago de la venta; conceptos por partida; XML guardado; la venta queda facturada', async () => {
    ventaTarjeta = await vender([{ producto: String(collar._id), cantidad: 2 }, { producto: String(croqueta._id), cantidad: 1500 }], [{ metodo: 'tarjeta', monto: 23200 + 7500 }]);
    const res = await facturar({ cliente: clinica.id, ventas: [ventaTarjeta.id] });
    expect(res.status).toBe(201);
    facturaCliente = res.body.datos;
    expect(facturaCliente).toMatchObject({
      tipo: 'I', modalidad: 'cliente', folioCompleto: 'F-1', estado: 'timbrada', formaPago: '04', metodoPago: 'PUE',
      subtotal: 20000 + 7500, iva: 3200, total: 30700, receptor: { rfc: 'CPA850101AB1', regimen: '601', usoCfdi: 'G03' }, pac: 'simulado'
    });
    expect(facturaCliente.uuid).toMatch(/^[0-9A-F-]{36}$/);
    expect(facturaCliente.conceptos.map(c => [c.claveSat, c.claveUnidad, c.cantidad])).toEqual([['10141600', 'H87', 2], ['01010101', 'KGM', 1.5]]);
    expect((await Venta.findById(ventaTarjeta.id).setOptions({ sinAlcance: true }).lean()).factura.toString()).toBe(facturaCliente.id);
    const xml = await api(cajero, 'get', `/api/facturas/${facturaCliente.id}/xml`);
    expect(xml.text).toContain(`UUID="${facturaCliente.uuid}"`);
    expect(xml.text).toContain('Rfc="CPA850101AB1"');
    const html = await api(cajero, 'get', `/api/facturas/${facturaCliente.id}/representacion`);
    expect(html.text).toContain('SIN VALIDEZ FISCAL');
    expect(await Auditoria.exists({ accion: 'factura.emitir_cliente', entidadId: facturaCliente.id })).toBeTruthy();
  });

  test('una venta no se factura dos veces; sin datos fiscales no se factura', async () => {
    expect((await facturar({ cliente: clinica.id, ventas: [ventaTarjeta.id] })).body.codigo).toBe('VENTAS_NO_FACTURABLES');
    const v = await vender([{ producto: String(collar._id), cantidad: 1 }], [{ metodo: 'efectivo', monto: 11600 }]);
    const sin = await facturar({ cliente: sinDatos.id, ventas: [v.id] });
    expect(sin.body).toMatchObject({ codigo: 'FALTAN_DATOS_FISCALES', detalles: { faltan: ['RFC', 'razón social', 'régimen fiscal', 'código postal'] } });
    // La venta no quedó marcada
    expect((await api(cajero, 'get', '/api/facturas/ventas-facturables')).body.datos.map(x => x.id)).toContain(v.id);
  });

  test('si el PAC rechaza el comprobante, la factura queda en error y la venta se libera', async () => {
    const v = await vender([{ producto: String(collar._id), cantidad: 1 }], [{ metodo: 'efectivo', monto: 11600 }]);
    const Cliente = require('../models/Cliente');
    await Cliente.updateOne({ _id: sinDatos.id }, { $set: { rfc: 'GOMA800101AB1', fiscal: { razonSocial: 'ANA GOMEZ', regimen: '612', codigoPostal: '63000', usoCfdi: 'G03' } } });
    // Los datos son válidos: se sustituye el PAC simulado para forzar un rechazo
    const { ErrorApp } = require('../helpers/errores');
    const pac = require('../services/pac/simulado');
    const original = pac.timbrar;
    pac.timbrar = async () => {
      throw new ErrorApp(422, 'El PAC rechazó el comprobante: prueba', 'PAC_RECHAZO');
    };
    const res = await facturar({ cliente: sinDatos.id, ventas: [v.id] });
    pac.timbrar = original;
    expect(res.status).toBe(422);
    expect(await Factura.findOne({ estado: 'error', sucursal: A._id }).lean()).toMatchObject({ error: expect.stringContaining('prueba') });
    expect((await Venta.findById(v.id).setOptions({ sinAlcance: true }).lean()).factura).toBeNull();
  });

  test('venta a crédito: factura PPD con forma 99 y saldo; complemento de pago con parcialidad', async () => {
    ventaCredito = await vender([{ producto: String(collar._id), cantidad: 5 }], [{ metodo: 'credito', monto: 58000 }], { cliente: clinica.id });
    facturaPPD = (await facturar({ cliente: clinica.id, ventas: [ventaCredito.id] })).body.datos;
    expect(facturaPPD).toMatchObject({ metodoPago: 'PPD', formaPago: '99', saldo: 58000 });
    const cp = await api(cajero, 'post', `/api/facturas/${facturaPPD.id}/complemento-pago`).send({ claveOperacion: randomUUID(), monto: 20000, formaPago: '03' });
    expect(cp.status).toBe(201);
    expect(cp.body.datos).toMatchObject({ tipo: 'P', folioCompleto: 'CP-1', total: 0, pago: { monto: 20000, documentos: [{ parcialidad: 1, saldoAnterior: 58000, importePagado: 20000, saldoInsoluto: 38000 }] } });
    expect((await api(cajero, 'get', `/api/facturas/${facturaPPD.id}`)).body.datos).toMatchObject({ saldo: 38000, parcialidades: 1 });
    expect((await api(cajero, 'post', `/api/facturas/${facturaPPD.id}/complemento-pago`).send({ claveOperacion: randomUUID(), monto: 38001, formaPago: '03' })).status).toBe(400);
  });
});

describe('notas de crédito y cancelación', () => {
  test('nota de crédito relacionada (01) con IVA proporcional; no más que el total', async () => {
    const nc = await api(cajero, 'post', `/api/facturas/${facturaCliente.id}/nota-credito`).send({ claveOperacion: randomUUID(), monto: 11600, descripcion: 'Devolución de un collar' });
    expect(nc.status).toBe(201);
    expect(nc.body.datos).toMatchObject({ tipo: 'E', folioCompleto: 'NC-1', total: 11600, relacionados: { tipoRelacion: '01', uuids: [facturaCliente.uuid] } });
    expect(nc.body.datos.subtotal + nc.body.datos.iva).toBe(11600);
    expect((await api(cajero, 'post', `/api/facturas/${facturaCliente.id}/nota-credito`).send({ claveOperacion: randomUUID(), monto: 30700 })).status).toBe(400);
  });

  test('cancelar: PIN del dueño; con notas o complementos vigentes no se puede; la venta facturada no se cancela', async () => {
    const pinMalo = await api(dueno, 'post', `/api/facturas/${facturaCliente.id}/cancelar`).send({ motivo: '02', autorizacion: { usuario: dueno.usuario.usuario, pin: '0000' } });
    expect(pinMalo.status).toBe(401);
    expect((await api(cajero, 'post', `/api/facturas/${facturaCliente.id}/cancelar`).send({ motivo: '02', autorizacion: pinDueno() })).status).toBe(403);
    expect((await api(dueno, 'post', `/api/facturas/${facturaCliente.id}/cancelar`).send({ motivo: '02', autorizacion: pinDueno() })).body.codigo).toBe('FACTURA_CON_RELACIONADOS');
    const ventaCancel = await api(dueno, 'post', `/api/ventas/${ventaTarjeta.id}/cancelar`).send({ motivo: 'Prueba', autorizacion: pinDueno() });
    expect(ventaCancel.body.codigo).toBe('VENTA_FACTURADA');

    // Cancelar primero la nota de crédito, luego la factura: la venta queda libre
    const nota = await Factura.findOne({ tipo: 'E', sucursal: A._id }).lean();
    expect((await api(dueno, 'post', `/api/facturas/${nota._id}/cancelar`).send({ motivo: '02', autorizacion: pinDueno() })).status).toBe(200);
    const c = await api(dueno, 'post', `/api/facturas/${facturaCliente.id}/cancelar`).send({ motivo: '02', autorizacion: pinDueno() });
    expect(c.status).toBe(200);
    expect(c.body.datos.estado).toBe('cancelada');
    expect((await Venta.findById(ventaTarjeta.id).setOptions({ sinAlcance: true }).lean()).factura).toBeNull();
    expect(await Auditoria.countDocuments({ accion: 'factura.cancelar' })).toBe(2);
  });

  test('cancelar el complemento devuelve el saldo a la factura PPD', async () => {
    const cp = await Factura.findOne({ tipo: 'P', sucursal: A._id }).lean();
    await api(dueno, 'post', `/api/facturas/${cp._id}/cancelar`).send({ motivo: '02', autorizacion: pinDueno() });
    expect((await api(cajero, 'get', `/api/facturas/${facturaPPD.id}`)).body.datos).toMatchObject({ saldo: 58000, parcialidades: 0 });
  });
});

describe('global y autofactura', () => {
  test('global: ventas de contado sin factura de días cerrados, un concepto por ticket, receptor público en general', async () => {
    // Una venta de ayer (se mueve la fecha) que no se facturó
    const v = await vender([{ producto: String(collar._id), cantidad: 1 }], [{ metodo: 'efectivo', monto: 11600 }]);
    const ayer = new Date(Date.now() - 86400000);
    await Venta.collection.updateMany({ sucursal: A._id, factura: null }, { $set: { fecha: ayer } });
    expect((await api(cajero, 'post', '/api/facturas/global').send({ claveOperacion: randomUUID(), periodicidad: 'dia', desde: diaLocal(), hasta: diaLocal() })).status).toBe(400);
    const res = await api(cajero, 'post', '/api/facturas/global').send({ claveOperacion: randomUUID(), periodicidad: 'dia', desde: diaLocal(ayer), hasta: diaLocal(ayer) });
    expect(res.status).toBe(201);
    const g = res.body.datos;
    expect(g).toMatchObject({ modalidad: 'global', receptor: { rfc: 'XAXX010101000', regimen: '616', usoCfdi: 'S01' }, global: { periodicidad: '01', meses: diaLocal(ayer).slice(5, 7) } });
    expect(g.conceptos.every(c => c.claveUnidad === 'ACT' && c.descripcion === 'Venta')).toBe(true);
    expect(g.conceptos.map(c => c.noIdentificacion)).toContain(`V-${v.folio}`);
    // La venta a crédito sin facturar no entra
    expect(g.ventas).not.toContain(ventaCredito.id);
  });

  test('autofactura pública: datos correctos factura el ticket; datos falsos cuentan intentos; descarga con UUID', async () => {
    const v = await vender([{ producto: String(collar._id), cantidad: 1 }], [{ metodo: 'efectivo', monto: 11600 }]);
    const datos = { sucursal: String(A._id), folio: `V-${v.folio}`, total: 11600, rfc: 'pemj900101ab1', razonSocial: 'Juan Pérez', regimen: '612', codigoPostal: '63100', usoCfdi: 'G03' };
    const publico = (cuerpo, ip = '10.0.0.1') => h.request(h.app).post('/api/autofactura').set('X-Forwarded-For', ip).send(cuerpo);
    expect((await h.request(h.app).get('/api/autofactura/sucursales')).body.datos.map(s => s.nombre)).toEqual(['Centro']);
    expect((await publico({ ...datos, total: 11601 })).status).toBe(404);
    const ok = await publico(datos);
    expect(ok.status).toBe(201);
    expect(ok.body.datos).toMatchObject({ folio: expect.stringMatching(/^F-\d+$/), receptor: 'JUAN PÉREZ' });
    expect((await publico(datos)).body.codigo).toBe('VENTA_FACTURADA');
    const xml = await h.request(h.app).get(`/api/autofactura/${ok.body.datos.id}/xml?uuid=${ok.body.datos.uuid}`);
    expect(xml.text).toContain('Rfc="PEMJ900101AB1"');
    expect((await h.request(h.app).get(`/api/autofactura/${ok.body.datos.id}/xml?uuid=${randomUUID()}`)).status).toBe(404);
    // Límite de intentos fallidos por IP
    await IntentoAutofactura.deleteMany({});
    for (let i = 0; i < 10; i += 1) await publico({ ...datos, total: 1 }, '10.0.0.9');
    expect((await publico(datos, '10.0.0.9')).status).toBe(429);
  });

  test('el cajero factura; el almacén no tiene facturación', async () => {
    const almacen = await h.sesion({ rol: 'almacen', sucursales: [A._id] });
    expect((await api(almacen, 'get', '/api/facturas')).status).toBe(403);
    const lista = (await api(cajero, 'get', '/api/facturas')).body;
    expect(lista.total).toBeGreaterThanOrEqual(5);
  });
});

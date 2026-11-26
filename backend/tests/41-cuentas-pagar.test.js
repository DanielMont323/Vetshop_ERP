// Cuentas por pagar: se generan al recibir compras (contado ya pagadas), pagos parciales y totales,
// cancelación de pagos, resumen por proveedor, alertas del tablero, Excel y migración de compras anteriores.
const { randomUUID } = require('crypto');
const h = require('./helpers/app');
const Producto = require('../models/Producto');
const Compra = require('../models/Compra');
const CuentaPorPagar = require('../models/CuentaPorPagar');
const cuentas = require('../services/cuentasPorPagar');
const { diaLocal } = require('../helpers/fechas');
const { Auditoria } = h.modelos;

let A, dueno, almacen, proveedor, proveedor2, collar;
const DIA = 86400000;

beforeAll(async () => {
  await h.resetDb();
  A = await h.crearSucursal({ nombre: 'A' });
  dueno = await h.sesion({ rol: 'dueno' });
  almacen = await h.sesion({ rol: 'almacen', sucursales: [A._id] });
  collar = await Producto.create({ sku: 'COL-1', nombre: 'Collar', categoria: 'accesorio', unidad: 'pieza', iva: 'tasa_0' });
  proveedor = (await api(almacen, 'post', '/api/proveedores', null).send({ nombre: 'Distribuidora (prueba)', diasCredito: 30 })).body.datos;
  proveedor2 = (await api(almacen, 'post', '/api/proveedores', null).send({ nombre: 'Laboratorio (prueba)', diasCredito: 15 })).body.datos;
});
afterAll(h.cerrar);

function api(s, metodo, ruta, sucursal = A) {
  return h.request(h.app)[metodo](ruta).set(h.auth(s.token, sucursal));
}
let folio = 0;
// Recibe una compra de `cantidad` collares a $100.00 (sin IVA)
async function recibir(prov, cantidad, condicionPago = 'credito', fechaFactura = diaLocal()) {
  folio += 1;
  const c = await api(almacen, 'post', '/api/compras').send({
    proveedor: String(prov.id), folioFactura: `F-${folio}`, fechaFactura, condicionPago,
    partidas: [{ producto: String(collar._id), cantidad, costoUnitario: 10000 }]
  });
  expect(c.status).toBe(201);
  const r = await api(almacen, 'post', `/api/compras/${c.body.datos.id}/confirmar`);
  expect(r.status).toBe(200);
  return r.body.datos;
}
const pagar = (monto, extra = {}, prov = proveedor) =>
  h.request(h.app).post('/api/cuentas-por-pagar/pagos').set(h.auth(dueno.token)).send({ claveOperacion: randomUUID(), proveedor: String(prov.id), monto, metodo: 'transferencia', ...extra });
const listar = async (query = '') => (await h.request(h.app).get(`/api/cuentas-por-pagar${query}`).set(h.auth(dueno.token))).body;

describe('al recibir una compra', () => {
  test('a crédito queda pendiente con su vencimiento; de contado queda ya pagada', async () => {
    const credito = await recibir(proveedor, 3); // $300
    const contado = await recibir(proveedor, 1, 'contado');
    const c1 = await CuentaPorPagar.findOne({ compra: credito.id }).lean();
    expect(c1).toMatchObject({ total: 30000, saldo: 30000, pagado: 0, estado: 'pendiente', condicionPago: 'credito', folioFactura: credito.folioFactura });
    expect(c1.vencimiento.getTime()).toBe(new Date(credito.vencimiento).getTime());
    expect(await CuentaPorPagar.findOne({ compra: contado.id }).lean()).toMatchObject({ estado: 'pagada', saldo: 0, pagadaAlRecibir: true });
  });

  test('solo el dueño las consulta', async () => {
    expect((await h.request(h.app).get('/api/cuentas-por-pagar').set(h.auth(almacen.token))).status).toBe(403);
    const body = await listar();
    expect(body.datos).toHaveLength(1);
    expect(body.resumen).toMatchObject({ pendiente: 30000, vencido: 0, facturas: 1 });
  });
});

describe('pagos', () => {
  test('pago parcial y luego el resto; la factura queda pagada; reintento sin duplicar', async () => {
    await recibir(proveedor, 2); // segunda factura, $200
    const clave = randomUUID();
    const p1 = await pagar(10000, { claveOperacion: clave, referencia: 'SPEI 1' });
    expect(p1.status).toBe(201);
    expect(p1.body.datos.aplicaciones).toEqual([expect.objectContaining({ monto: 10000 })]);
    expect((await pagar(10000, { claveOperacion: clave })).body.repetido).toBe(true);
    expect((await listar()).resumen.pendiente).toBe(40000);

    // Exceso: 409 con el máximo
    const exceso = await pagar(40001);
    expect(exceso.body).toMatchObject({ codigo: 'PAGO_EXCEDE_SALDO', detalles: { maximo: 40000 } });

    const p2 = await pagar(40000, { metodo: 'cheque', referencia: 'CH-55' });
    expect(p2.status).toBe(201);
    expect(p2.body.datos.aplicaciones.map(a => a.monto)).toEqual([20000, 20000]);
    expect((await listar()).resumen).toMatchObject({ pendiente: 0, facturas: 0 });
    expect(await Auditoria.countDocuments({ accion: 'proveedor.pago' })).toBe(2);
    expect((await pagar(100)).body.codigo).toBe('SIN_SALDO');
  });

  test('pagar facturas elegidas; no se pueden elegir de otro proveedor', async () => {
    const f1 = await recibir(proveedor2, 1);
    const f2 = await recibir(proveedor2, 1);
    const cuentas2 = (await listar(`?proveedor=${proveedor2.id}`)).datos;
    const segunda = cuentas2.find(c => c.folioFactura === f2.folioFactura);
    const res = await pagar(10000, { cuentas: [segunda.id] }, proveedor2);
    expect(res.body.datos.aplicaciones).toEqual([expect.objectContaining({ folioFactura: f2.folioFactura, monto: 10000 })]);
    const otra = cuentas2.find(c => c.folioFactura === f1.folioFactura);
    expect((await pagar(100, { cuentas: [otra.id] }, proveedor)).status).toBe(400);
  });

  test('fecha del pago: puede ser anterior, nunca futura', async () => {
    const ayer = diaLocal(new Date(Date.now() - DIA));
    const manana = diaLocal(new Date(Date.now() + DIA));
    expect((await pagar(1000, { fecha: manana }, proveedor2)).status).toBe(400);
    const res = await pagar(1000, { fecha: ayer }, proveedor2);
    expect(diaLocal(res.body.datos.fecha)).toBe(ayer);
  });

  test('cancelar un pago regresa el saldo a las facturas (y queda en bitácora)', async () => {
    const antes = (await listar()).resumen.pendiente;
    const pago = (await pagar(9000, {}, proveedor2)).body.datos;
    expect((await listar()).resumen.pendiente).toBe(antes - 9000);
    const c = await h.request(h.app).post(`/api/cuentas-por-pagar/pagos/${pago.id}/cancelar`).set(h.auth(dueno.token)).send({ motivo: 'Se registró dos veces' });
    expect(c.status).toBe(200);
    expect((await listar()).resumen.pendiente).toBe(antes);
    expect((await h.request(h.app).post(`/api/cuentas-por-pagar/pagos/${pago.id}/cancelar`).set(h.auth(dueno.token)).send({ motivo: 'Otra vez' })).body.codigo).toBe('PAGO_CANCELADO');
    expect(await Auditoria.exists({ accion: 'proveedor.cancelar_pago', entidadId: pago.id })).toBeTruthy();
    const pagos = (await h.request(h.app).get(`/api/cuentas-por-pagar/pagos?proveedor=${proveedor2.id}`).set(h.auth(dueno.token))).body.datos;
    expect(pagos.find(p => p.id === pago.id).estado).toBe('cancelado');
  });
});

describe('vencimientos, tablero, Excel y migración', () => {
  test('resumen por proveedor con vencido y por vencer; alertas del tablero', async () => {
    const vieja = await recibir(proveedor, 1, 'credito', diaLocal(new Date(Date.now() - 40 * DIA))); // venció hace 10 días
    const body = await listar();
    expect(body.datos[0].folioFactura).toBe(vieja.folioFactura); // la que vence primero
    expect(body.datos[0].diasParaVencer).toBe(-10);
    const fila = body.proveedores.find(p => p.proveedor.nombre === 'Distribuidora (prueba)');
    expect(fila).toMatchObject({ saldo: 10000, d1_30: 10000, vencido: 10000 });
    expect(body.resumen.vencido).toBe(10000);

    // proveedor2 (15 días): sus facturas de hoy vencen en 15 días; una de hace 10 días vence en 5
    await recibir(proveedor2, 1, 'credito', diaLocal(new Date(Date.now() - 10 * DIA)));
    const tablero = await h.request(h.app).get('/api/reportes/dashboard').set(h.auth(dueno.token));
    expect(tablero.body.datos.alertas).toMatchObject({ facturasVencidas: 1, facturasPorVencer: 1 });
  });

  test('Excel de cuentas por pagar', async () => {
    const xls = await h.request(h.app).get('/api/cuentas-por-pagar/excel').set(h.auth(dueno.token)).buffer(true).parse((r, cb) => {
      const partes = [];
      r.on('data', d => partes.push(d));
      r.on('end', () => cb(null, Buffer.concat(partes)));
    });
    expect(xls.status).toBe(200);
    expect(xls.body.subarray(0, 2).toString()).toBe('PK');
  });

  test('compras recibidas antes del módulo: se crean sus cuentas una sola vez', async () => {
    const compra = await recibir(proveedor, 1);
    await CuentaPorPagar.deleteOne({ compra: compra.id });
    expect(await cuentas.generarFaltantes()).toBe(1);
    expect(await cuentas.generarFaltantes()).toBe(0);
    expect(await CuentaPorPagar.countDocuments({})).toBe(await Compra.countDocuments({ estado: 'recibida', sucursal: A._id }));
  });
});

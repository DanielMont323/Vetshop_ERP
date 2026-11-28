// Paso 24: clientes de distribución. Nota de venta en hoja carta; abono con detalle (ventas, facturas, saldo) para
// WhatsApp y complemento de pago automático de las facturas PPD (PAC simulado).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const CARPETA = fs.mkdtempSync(path.join(os.tmpdir(), 'vetshop-distribucion-'));
process.env.ALMACENAMIENTO = 'local';
process.env.ALMACENAMIENTO_CARPETA = CARPETA;
process.env.FACTURACION_PAC = 'simulado';

const h = require('./helpers/app');
const Producto = require('../models/Producto');
const Factura = require('../models/Factura');
const AbonoCliente = require('../models/AbonoCliente');
const inv = require('../services/inventario');
const precios = require('../services/precios');
const pac = require('../services/pac');
const { conTransaccion } = require('../helpers/transaccion');

let A, dueno, cajero, collar, clinica, v1, v2, facturaPPD;
const PIN = '4821';

beforeAll(async () => {
  await h.resetDb();
  A = await h.crearSucursal({ nombre: 'Centro', tipo: 'tienda' });
  dueno = await h.sesion({ rol: 'dueno', pin: PIN });
  cajero = await h.sesion({ rol: 'cajero', sucursales: [A._id] });
  collar = await Producto.create({ sku: 'COL', nombre: 'Collar <b>Pro</b>', categoria: 'accesorio', unidad: 'pieza', iva: 'tasa_16', claveSat: '10141600' });
  await precios.fijarPrecio({ clave: 'publico', productoId: collar._id, precio: 11600 }, dueno.usuario);
  await conTransaccion(s => inv.registrarEntrada({ sucursal: A._id, producto: collar._id, cantidad: 1000, costoUnitario: 100, origen: 'compra', usuario: dueno.usuario._id }, s));
  await h.abrirTurno(cajero, A);
  clinica = (await h.request(h.app).post('/api/clientes').set(h.auth(dueno.token)).send({
    nombre: 'Clínica Patitas', tipo: 'clinica', listaPrecios: 'publico', rfc: 'CPA850101AB1', direccion: 'Av. México 100, Tepic', telefono: '3111112233',
    credito: { activo: true, limite: 10000000 }, fiscal: { razonSocial: 'Clínica Patitas SA de CV', regimen: '601', codigoPostal: '63000', usoCfdi: 'G03' }
  })).body.datos;
  await h.request(h.app).patch(`/api/clientes/${clinica.id}/contacto`).set(h.auth(cajero.token)).send({ whatsapp: '3111112233' });
});
afterAll(async () => {
  await h.cerrar();
  fs.rmSync(CARPETA, { recursive: true, force: true });
});

const api = (s, metodo, ruta) => h.request(h.app)[metodo](ruta).set(h.auth(s.token, A));
const venderACredito = cantidad => api(cajero, 'post', '/api/ventas').send({
  claveOperacion: randomUUID(), cliente: clinica.id, partidas: [{ producto: collar._id, cantidad }], pagos: [{ metodo: 'credito', monto: 11600 * cantidad }]
}).then(r => r.body.datos);
const abonar = (monto, extra = {}) => api(cajero, 'post', '/api/cobranza/abonos').send({ claveOperacion: randomUUID(), cliente: clinica.id, monto, metodo: 'transferencia', ...extra });

describe('nota de venta', () => {
  test('hoja carta con datos del cliente, vencimiento del crédito y texto escapado', async () => {
    v1 = await venderACredito(5);
    const r = await api(cajero, 'get', `/api/ventas/${v1.id}/nota`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/html/);
    expect(r.text).toContain('Por el presente pagaré');
    expect(r.text).toContain('<h1>Vet Shop</h1>'); // cliente con negocio
    expect(r.text).toContain('size: letter');
    expect(r.text).toContain('CPA850101AB1');
    expect(r.text).toContain('Av. México 100, Tepic');
    expect(r.text).toContain('Vence el');
    expect(r.text).toContain('Collar &lt;b&gt;Pro&lt;/b&gt;');
    expect(r.text).toContain('<td>TOTAL</td><td>580.00</td>');
    expect(r.text).toContain('<td>IVA</td><td>80.00</td>');
  });
});

describe('abono de distribución', () => {
  test('cubre la venta facturada PPD: timbra el complemento y devuelve el detalle para WhatsApp', async () => {
    v2 = await venderACredito(2);
    facturaPPD = (await api(cajero, 'post', '/api/facturas').send({ claveOperacion: randomUUID(), cliente: clinica.id, ventas: [v1.id] })).body.datos;
    expect(facturaPPD).toMatchObject({ metodoPago: 'PPD', saldo: 58000 });

    const r = await abonar(30000, { cargos: undefined });
    expect(r.status).toBe(201);
    const { detalle } = r.body;
    expect(detalle.cliente).toMatchObject({ nombre: 'Clínica Patitas', whatsapp: '3111112233' });
    expect(detalle.ventas).toEqual([{ folio: `V-${v1.folio}`, monto: 30000, bonificacion: 0, factura: expect.objectContaining({ folio: facturaPPD.folioCompleto, metodoPago: 'PPD' }) }]);
    expect(detalle.complementos).toEqual([expect.objectContaining({ estado: 'timbrado', monto: 30000, folioFactura: facturaPPD.folioCompleto })]);
    expect(detalle.saldo).toBe(58000 + 23200 - 30000);
    expect((await api(cajero, 'get', `/api/facturas/${facturaPPD.id}`)).body.datos).toMatchObject({ saldo: 28000, parcialidades: 1 });
    expect(await Factura.countDocuments({ sucursal: A._id, tipo: 'P' })).toBe(1);
  });

  test('un reintento del mismo abono (misma clave) no timbra otra vez', async () => {
    const r = await abonar(23200, { cargos: [] });
    const clave = randomUUID();
    const primero = await abonar(10000, { claveOperacion: clave });
    const repetido = await abonar(10000, { claveOperacion: clave });
    expect(repetido.status).toBe(200);
    expect(repetido.body.detalle.abono.id).toBe(primero.body.detalle.abono.id);
    expect(await Factura.countDocuments({ sucursal: A._id, tipo: 'P' })).toBe(r.body.detalle.complementos.length + 1 + primero.body.detalle.complementos.length);
  });

  test('si el PAC falla, el abono queda y el complemento se reintenta', async () => {
    const v3 = await venderACredito(1);
    const f3 = (await api(cajero, 'post', '/api/facturas').send({ claveOperacion: randomUUID(), cliente: clinica.id, ventas: [v3.id] })).body.datos;
    const original = pac.proveedor;
    pac.proveedor = () => ({ ...original(), timbrar: async () => { throw new Error('PAC fuera de servicio'); } });
    let r;
    try {
      r = await abonar(5000, { cargos: [(await api(cajero, 'get', `/api/cobranza/clientes/${clinica.id}`)).body.datos.pendientes.find(c => c.folio === `V-${v3.folio}`).id] });
    } finally {
      pac.proveedor = original;
    }
    expect(r.status).toBe(201);
    expect(r.body.detalle.complementos).toEqual([expect.objectContaining({ estado: 'error', folioFactura: f3.folioCompleto })]);
    const re = await api(cajero, 'post', `/api/cobranza/abonos/${r.body.datos.id}/complementos`);
    expect(re.body.datos.complementos.map(c => c.estado)).toEqual(['error', 'timbrado']);
    expect((await api(cajero, 'get', `/api/facturas/${f3.id}`)).body.datos.saldo).toBe(11600 - 5000);

    // Con complemento vigente el abono no se cancela
    const c = await api(cajero, 'post', `/api/cobranza/abonos/${r.body.datos.id}/cancelar`).send({ motivo: 'Prueba', autorizacion: { usuario: dueno.usuario.usuario, pin: PIN } });
    expect(c.status).toBe(409);
    expect(c.body.codigo).toBe('ABONO_CON_COMPLEMENTO');
    expect((await AbonoCliente.findById(r.body.datos.id).lean()).estado).toBe('aplicado');
  });
});

// Metas de venta: definirlas (dueño), vendedor elegido en la caja, avance por sucursal y vendedor con
// porcentaje y proyección, mi avance, tablero y lista de vendedores.
const { randomUUID } = require('crypto');
const h = require('./helpers/app');
const Producto = require('../models/Producto');
const inv = require('../services/inventario');
const precios = require('../services/precios');
const { datosMes } = require('../services/metas');
const { conTransaccion } = require('../helpers/transaccion');
const { diaLocal } = require('../helpers/fechas');
const { Auditoria } = h.modelos;

let A, B, dueno, cajero, cajero2, cajeroB, collar;
const periodo = diaLocal().slice(0, 7);

beforeAll(async () => {
  await h.resetDb();
  A = await h.crearSucursal({ nombre: 'A' });
  B = await h.crearSucursal({ nombre: 'B' });
  dueno = await h.sesion({ rol: 'dueno', pin: '4821', nombre: 'Dueño' });
  cajero = await h.sesion({ rol: 'cajero', sucursales: [A._id], nombre: 'Ana' });
  cajero2 = await h.sesion({ rol: 'cajero', sucursales: [A._id], nombre: 'Beto' });
  cajeroB = await h.sesion({ rol: 'cajero', sucursales: [B._id], nombre: 'Ciro' });
  collar = await Producto.create({ sku: 'COL', nombre: 'Collar', categoria: 'accesorio', unidad: 'pieza', iva: 'tasa_16' });
  await precios.fijarPrecio({ clave: 'publico', productoId: collar._id, precio: 10000 }, dueno.usuario);
  await conTransaccion(s => inv.registrarEntrada({ sucursal: A._id, producto: collar._id, cantidad: 100, costoUnitario: 5000, origen: 'compra', usuario: dueno.usuario._id }, s));
  await h.abrirTurno(cajero, A);
});
afterAll(h.cerrar);

const api = (s, metodo, ruta, sucursal = A) => h.request(h.app)[metodo](ruta).set(h.auth(s.token, sucursal));
const vender = (cantidad, extra = {}) =>
  api(cajero, 'post', '/api/ventas').send({ claveOperacion: randomUUID(), partidas: [{ producto: String(collar._id), cantidad }], pagos: [{ metodo: 'tarjeta', monto: cantidad * 10000 }], ...extra });

test('meses: días transcurridos y si está en curso', () => {
  const ahora = new Date('2026-11-25T18:00:00Z'); // 25 de noviembre en Tepic
  expect(datosMes('2026-11', ahora)).toMatchObject({ diasMes: 30, transcurridos: 25, enCurso: true });
  expect(datosMes('2026-10', ahora)).toMatchObject({ diasMes: 31, transcurridos: 31, enCurso: false });
  expect(datosMes('2026-12', ahora)).toMatchObject({ transcurridos: 0, enCurso: false });
});

test('solo el dueño fija metas; vendedor de otra sucursal no; queda en bitácora', async () => {
  expect((await api(cajero, 'put', '/api/metas').send({ periodo, monto: 100 })).status).toBe(403);
  const res = await api(dueno, 'put', '/api/metas').send({ periodo, monto: 1000000, tickets: 50 });
  expect(res.status).toBe(200);
  expect(res.body.datos).toMatchObject({ periodo, monto: 1000000, tickets: 50, vendedor: null });
  expect((await api(dueno, 'put', '/api/metas').send({ periodo, vendedor: String(cajero.usuario._id), monto: 500000 })).status).toBe(200);
  expect((await api(dueno, 'put', '/api/metas').send({ periodo, vendedor: String(cajeroB.usuario._id), monto: 1 })).status).toBe(400);
  expect((await api(dueno, 'put', '/api/metas').send({ periodo: '2026-13', monto: 1 })).status).toBe(400);
  expect(await Auditoria.countDocuments({ accion: 'meta.fijar' })).toBe(2);
});

test('la venta cuenta para el vendedor elegido (o para el cajero); vendedor de otra sucursal no se acepta', async () => {
  expect((await vender(3)).body.datos.vendedor.nombre).toBe('Ana');
  const otra = await vender(2, { vendedor: String(cajero2.usuario._id) });
  expect(otra.status).toBe(201);
  expect(otra.body.datos).toMatchObject({ cajero: { nombre: 'Ana' }, vendedor: { nombre: 'Beto' } });
  expect((await vender(1, { vendedor: String(cajeroB.usuario._id) })).status).toBe(400);
});

test('avance por sucursal y vendedor: vendido, tickets, porcentaje, proyección y ranking', async () => {
  const res = await api(dueno, 'get', `/api/metas?periodo=${periodo}`);
  expect(res.status).toBe(200);
  const d = res.body.datos;
  const a = d.sucursales.find(s => s.sucursal.nombre === 'A');
  expect(a).toMatchObject({ meta: 1000000, metaTickets: 50, vendido: 50000, tickets: 2, porcentaje: 5 });
  expect(a.proyeccion).toBe(Math.round((50000 / d.diasTranscurridos) * d.diasMes));
  expect(a.vendedores.map(v => [v.vendedor.nombre, v.vendido, v.meta, v.porcentaje])).toEqual([['Ana', 30000, 500000, 6], ['Beto', 20000, null, null]]);
  // El cajero no ve el avance general
  expect((await api(cajero, 'get', '/api/metas')).status).toBe(403);
});

test('mi avance (cajero) y vendedores de la sucursal', async () => {
  const mio = await api(cajero, 'get', '/api/metas/mi-avance');
  expect(mio.body.datos).toMatchObject({ periodo, meta: 500000, vendido: 30000, tickets: 1, porcentaje: 6 });
  const lista = (await api(cajero, 'get', '/api/metas/vendedores')).body.datos.map(u => u.nombre);
  expect(lista).toEqual(expect.arrayContaining(['Ana', 'Beto', 'Dueño']));
  expect(lista).not.toContain('Ciro');
});

test('tablero: metas del mes de las sucursales con meta; quitar una meta con monto 0', async () => {
  const tablero = async () => (await h.request(h.app).get('/api/reportes/dashboard').set(h.auth(dueno.token))).body.datos.metas;
  expect((await tablero()).map(m => [m.sucursal.nombre, m.meta, m.vendido])).toEqual([['A', 1000000, 50000]]);
  expect((await api(dueno, 'put', '/api/metas').send({ periodo, monto: 0 })).body.datos).toBeNull();
  expect(await tablero()).toEqual([]);
});

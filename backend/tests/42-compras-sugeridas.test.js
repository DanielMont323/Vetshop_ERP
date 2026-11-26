// Compras sugeridas: venta diaria × cobertura, mínimo/máximo, lotes que caducan dentro de la cobertura,
// mercancía en camino (traspasos y borradores), proveedor habitual con último costo, existencia en almacén.
const { randomUUID } = require('crypto');
const h = require('./helpers/app');
const Producto = require('../models/Producto');
const precios = require('../services/precios');
const inv = require('../services/inventario');
const { conTransaccion } = require('../helpers/transaccion');
const { diaLocal } = require('../helpers/fechas');
const { redondear } = require('../services/sugeridos');

let T, W, dueno, almacen, cajero, proveedor, collar, croqueta, vacuna, shampoo;

beforeAll(async () => {
  await h.resetDb();
  T = await h.crearSucursal({ nombre: 'Tienda', tipo: 'tienda' });
  W = await h.crearSucursal({ nombre: 'Almacén', tipo: 'almacen' });
  dueno = await h.sesion({ rol: 'dueno', pin: '4821' });
  almacen = await h.sesion({ rol: 'almacen', sucursales: [T._id, W._id] });
  cajero = await h.sesion({ rol: 'cajero', sucursales: [T._id] });
  collar = await Producto.create({ sku: 'COL', nombre: 'Collar', categoria: 'accesorio', unidad: 'pieza', iva: 'tasa_16' });
  croqueta = await Producto.create({ sku: 'CRO', nombre: 'Croqueta granel', categoria: 'otro', unidad: 'kg', iva: 'tasa_0', minimos: [{ sucursal: T._id, cantidad: 5000, maximo: 20000 }] });
  vacuna = await Producto.create({ sku: 'VAC', nombre: 'Vacuna', categoria: 'otro', unidad: 'pieza', iva: 'tasa_0', minimos: [{ sucursal: T._id, cantidad: 5 }] });
  shampoo = await Producto.create({ sku: 'SHA', nombre: 'Shampoo', categoria: 'higiene', unidad: 'pieza', iva: 'tasa_16' });
  await precios.fijarPrecio({ clave: 'publico', productoId: collar._id, precio: 10000 }, dueno.usuario);

  proveedor = (await api(almacen, 'post', '/api/proveedores', null).send({ nombre: 'Distribuidora (prueba)' })).body.datos;
  // 40 collares recibidos por compra (proveedor habitual, costo $50) y 30 vendidos en la tienda
  const c = await api(almacen, 'post', '/api/compras').send({
    proveedor: String(proveedor.id), folioFactura: 'F-1', fechaFactura: diaLocal(), condicionPago: 'contado',
    partidas: [{ producto: String(collar._id), cantidad: 40, costoUnitario: 5000 }]
  });
  await api(almacen, 'post', `/api/compras/${c.body.datos.id}/confirmar`);
  await h.abrirTurno(cajero, T);
  const venta = await api(cajero, 'post', '/api/ventas').send({ claveOperacion: randomUUID(), partidas: [{ producto: String(collar._id), cantidad: 30 }], pagos: [{ metodo: 'efectivo', monto: 300000 }] });
  expect(venta.status).toBe(201);

  const entrada = (sucursal, producto, cantidad, extra = {}) =>
    conTransaccion(s => inv.registrarEntrada({ sucursal, producto: producto._id, cantidad, costoUnitario: 1000, origen: 'compra', usuario: dueno.usuario._id, ...extra }, s));
  await entrada(T, croqueta, 3500); // 3.5 kg, mínimo 5 kg, máximo 20 kg
  const enDiezDias = new Date(Date.now() + 10 * 86400000);
  const [a, m, d] = diaLocal(enDiezDias).split('-');
  await entrada(T, vacuna, 10, { caducidad: `${d}/${m}/${a}` }); // caduca en 10 días
  await entrada(T, shampoo, 50);
  await entrada(W, collar, 100);
});
afterAll(h.cerrar);

function api(s, metodo, ruta, sucursal = T) {
  return h.request(h.app)[metodo](ruta).set(h.auth(s.token, sucursal));
}
const sugeridas = async (query = '', s = almacen, sucursal = T) => api(s, 'get', `/api/compras/sugeridas${query}`, sucursal);
const fila = (body, producto) => body.datos.find(f => f.producto.sku === producto.sku);

test('redondeo: piezas enteras y granel a kilos completos', () => {
  expect(redondear(4.2, 'pieza')).toBe(5);
  expect(redondear(16500, 'kg')).toBe(17000);
});

test('permisos y sucursal obligatoria', async () => {
  expect((await sugeridas('', cajero)).status).toBe(403);
  const sinSucursal = await h.request(h.app).get('/api/compras/sugeridas').set(h.auth(dueno.token));
  expect(sinSucursal.status).toBe(400);
  expect((await sugeridas('?dias=45')).status).toBe(400);
});

test('por venta diaria: 30 vendidos en 30 días × 15 días de cobertura − 10 en existencia = 5', async () => {
  const res = await sugeridas();
  expect(res.status).toBe(200);
  expect(fila(res.body, collar)).toMatchObject({
    vendido: 30, ventaDiaria: 1, necesidad: 15, existencia: 10, enCamino: 0, sugerido: 5,
    proveedor: { nombre: 'Distribuidora (prueba)' }, ultimoCosto: 5000, costoEstimado: 25000, enAlmacen: 100
  });
  // Con 30 días de cobertura se piden 20
  expect(fila((await sugeridas('?cobertura=30')).body, collar).sugerido).toBe(20);
});

test('mínimo y máximo: por debajo del mínimo se pide hasta el máximo (granel redondeado a kg)', async () => {
  expect(fila((await sugeridas()).body, croqueta)).toMatchObject({ minimo: 5000, maximo: 20000, existencia: 3500, sugerido: 17000, proveedor: null });
});

test('lotes que caducan dentro de la cobertura no cuentan como existencia', async () => {
  expect(fila((await sugeridas()).body, vacuna)).toMatchObject({ existencia: 0, porCaducar: 10, sugerido: 5 });
  // Con 5 días de cobertura la vacuna (caduca en ~10 días) sí cuenta
  expect(fila((await sugeridas('?cobertura=5')).body, vacuna)).toBeUndefined();
});

test('lo que viene en camino (traspaso en tránsito y compra en borrador) se descuenta', async () => {
  const t = await api(almacen, 'post', '/api/traspasos', W).send({ destino: String(T._id), partidas: [{ producto: String(collar._id), cantidad: 3 }] });
  expect(t.status).toBe(201);
  await api(almacen, 'post', '/api/compras').send({
    proveedor: String(proveedor.id), folioFactura: 'F-2', fechaFactura: diaLocal(), condicionPago: 'contado',
    partidas: [{ producto: String(collar._id), cantidad: 1, costoUnitario: 5000 }]
  });
  expect(fila((await sugeridas()).body, collar)).toMatchObject({ enCamino: 4, sugerido: 1 });
});

test('sin necesidad no aparece, salvo con todos=true; totales y filtro por categoría', async () => {
  const res = await sugeridas();
  expect(fila(res.body, shampoo)).toBeUndefined();
  expect(res.body.totales).toMatchObject({ productos: 3, conAlmacen: 1 });
  expect(fila((await sugeridas('?todos=true')).body, shampoo)).toMatchObject({ sugerido: 0, existencia: 50 });
  expect((await sugeridas('?categoria=accesorio')).body.datos.map(f => f.producto.sku)).toEqual(['COL']);
});

test('el máximo no puede ser menor que el mínimo', async () => {
  const res = await h.request(h.app).patch(`/api/productos/${croqueta._id}`).set(h.auth(dueno.token)).send({ minimos: [{ sucursal: String(T._id), cantidad: 5000, maximo: 1000 }] });
  expect(res.status).toBe(400);
});

// Traspasos: salida FEFO del origen (sin caducados), recepción por lote con mismo lote/caducidad/costo,
// diferencias autorizadas con PIN del dueño, cancelación con reversa exacta y alcance por sucursal.
const h = require('./helpers/app');
const Producto = require('../models/Producto');
const Traspaso = require('../models/Traspaso');
const InventoryLayer = require('../models/InventoryLayer');
const InventoryMovement = require('../models/InventoryMovement');
const inv = require('../services/inventario');
const { conTransaccion } = require('../helpers/transaccion');
const { Auditoria } = h.modelos;

let ALM, TA, TB, CERRADA, dueno, almacen, tiendaA, cajeroA, med, granel;

beforeAll(async () => {
  await h.resetDb();
  ALM = await h.crearSucursal({ nombre: 'Almacén', tipo: 'almacen' });
  TA = await h.crearSucursal({ nombre: 'Tienda A' });
  TB = await h.crearSucursal({ nombre: 'Tienda B' });
  CERRADA = await h.crearSucursal({ nombre: 'Cerrada', activa: false });
  dueno = await h.sesion({ rol: 'dueno', pin: '4821' });
  almacen = await h.sesion({ rol: 'almacen', sucursales: [ALM._id] });
  tiendaA = await h.sesion({ rol: 'almacen', sucursales: [TA._id] });
  cajeroA = await h.sesion({ rol: 'cajero', sucursales: [TA._id] });
  med = await Producto.create({ sku: 'MED', nombre: 'Antibiótico', categoria: 'medicamento', unidad: 'pieza', iva: 'tasa_0' });
  granel = await Producto.create({ sku: 'GRA', nombre: 'Granel', categoria: 'alimento', unidad: 'kg', iva: 'tasa_0' });
  await conTransaccion(async s => {
    const u = dueno.usuario._id;
    await inv.registrarEntrada({ sucursal: ALM._id, producto: med._id, cantidad: 3, costoUnitario: 9000, lote: 'CAD', caducidad: '01/2020', origen: 'inventario_inicial', permitirCaducado: true, usuario: u }, s);
    await inv.registrarEntrada({ sucursal: ALM._id, producto: med._id, cantidad: 10, costoUnitario: 12000, lote: 'L2', caducidad: '06/2027', origen: 'compra', usuario: u }, s);
    await inv.registrarEntrada({ sucursal: ALM._id, producto: med._id, cantidad: 5, costoUnitario: 10000, lote: 'L1', caducidad: '03/2027', origen: 'compra', usuario: u }, s);
    await inv.registrarEntrada({ sucursal: ALM._id, producto: granel._id, cantidad: 10000, costoUnitario: 4000, caducidad: '12/2027', origen: 'compra', usuario: u }, s);
  });
});
afterAll(h.cerrar);

const api = (s, metodo, ruta, sucursal) => h.request(h.app)[metodo](ruta).set(h.auth(s.token, sucursal));
const enviar = (cuerpo, s = almacen, sucursal = ALM) => api(s, 'post', '/api/traspasos', sucursal).send(cuerpo);
const capas = async (producto, sucursal) => InventoryLayer.find({ sucursal: sucursal._id, producto: producto._id, cantidadRestante: { $gt: 0 } }).sort({ ordenFefo: 1 }).lean();
const restante = async (producto, sucursal) => (await capas(producto, sucursal)).reduce((s, c) => s + c.cantidadRestante, 0);

let t1;

describe('enviar', () => {
  test('destinos: todas las sucursales activas menos el origen', async () => {
    const res = await api(almacen, 'get', '/api/traspasos/destinos', ALM);
    expect(res.body.datos.map(s => s.nombre)).toEqual(['Tienda A', 'Tienda B']);
  });

  test('sale del origen por FEFO (sin caducados), con lotes y costo; queda en tránsito', async () => {
    const res = await enviar({ destino: String(TA._id), partidas: [{ producto: String(med._id), cantidad: 7 }, { producto: String(granel._id), cantidad: 2500 }], observaciones: 'Surtido semanal' });
    expect(res.status).toBe(201);
    t1 = res.body.datos;
    expect(t1).toMatchObject({ folio: 1, estado: 'en_transito', origen: { nombre: 'Almacén' }, destino: { nombre: 'Tienda A' } });
    expect(t1.partidas[0].lotes.map(l => [l.lote, l.enviado, l.costoUnitario])).toEqual([['L1', 5, 10000], ['L2', 2, 12000]]);
    expect(await restante(med, ALM)).toBe(3 + 8); // quedan el caducado (3) y 8 de L2
    expect(await restante(med, TA)).toBe(0); // todavía no llega
    expect(await InventoryMovement.countDocuments({ sucursal: ALM._id, tipo: 'traspaso_salida', 'referencia.id': t1.id })).toBe(2);
  });

  test('sin existencia vigente suficiente → 409 (los caducados no se traspasan)', async () => {
    const res = await enviar({ destino: String(TA._id), partidas: [{ producto: String(med._id), cantidad: 10 }] });
    expect(res.status).toBe(409);
    expect(res.body.mensaje).toMatch(/caducados/);
  });

  test('validaciones: mismo destino, destino desactivado, sin X-Sucursal, cajero sin permiso', async () => {
    expect((await enviar({ destino: String(ALM._id), partidas: [{ producto: String(med._id), cantidad: 1 }] })).status).toBe(400);
    expect((await enviar({ destino: String(CERRADA._id), partidas: [{ producto: String(med._id), cantidad: 1 }] })).status).toBe(400);
    expect((await enviar({ destino: String(TA._id), partidas: [{ producto: String(med._id), cantidad: 1 }] }, almacen, null)).status).toBe(400);
    expect((await api(cajeroA, 'get', '/api/traspasos', TA)).status).toBe(403);
  });
});

describe('recibir', () => {
  test('el destino lo ve como recibido pendiente; otra tienda no lo ve', async () => {
    const res = await api(tiendaA, 'get', '/api/traspasos?direccion=recibidos&estado=en_transito', TA);
    expect(res.body.datos.map(t => t.id)).toEqual([t1.id]);
    expect((await api(dueno, 'get', `/api/traspasos/${t1.id}`, TB)).status).toBe(404);
  });

  test('solo el destino recibe; no puede llegar más de lo enviado', async () => {
    expect((await api(almacen, 'post', `/api/traspasos/${t1.id}/recibir`, ALM).send({ recibidos: [[5, 2], [2500]] })).status).toBe(404);
    expect((await api(tiendaA, 'post', `/api/traspasos/${t1.id}/recibir`, TA).send({ recibidos: [[6, 2], [2500]] })).status).toBe(400);
    expect((await api(tiendaA, 'post', `/api/traspasos/${t1.id}/recibir`, TA).send({ recibidos: [[5, 2]] })).status).toBe(400);
  });

  test('completo: entra con el mismo lote, caducidad y costo; queda recibido', async () => {
    const res = await api(tiendaA, 'post', `/api/traspasos/${t1.id}/recibir`, TA).send({ recibidos: [[5, 2], [2500]], observaciones: 'Todo bien' });
    expect(res.status).toBe(200);
    expect(res.body.datos.estado).toBe('recibido');
    const enTA = await capas(med, TA);
    expect(enTA.map(c => [c.lote, c.cantidadRestante, c.costoUnitario, c.origen])).toEqual([['L1', 5, 10000, 'traspaso_entrada'], ['L2', 2, 12000, 'traspaso_entrada']]);
    expect(enTA[0].caducidad.toISOString()).toBe('2027-04-01T06:59:59.999Z');
    expect(await restante(granel, TA)).toBe(2500);
    expect((await api(tiendaA, 'post', `/api/traspasos/${t1.id}/recibir`, TA).send({ recibidos: [[5, 2], [2500]] })).status).toBe(409);
  });
});

describe('diferencias', () => {
  let t2;
  test('llega menos de lo enviado: queda con diferencia y en bitácora', async () => {
    t2 = (await enviar({ destino: String(TA._id), partidas: [{ producto: String(med._id), cantidad: 3 }] })).body.datos;
    const res = await api(tiendaA, 'post', `/api/traspasos/${t2.id}/recibir`, TA).send({ recibidos: [[2]], observaciones: 'Una caja rota' });
    expect(res.body.datos).toMatchObject({ estado: 'con_diferencia', faltantes: [{ sku: 'MED', lote: 'L2', faltante: 1 }] });
    expect(await Auditoria.countDocuments({ accion: 'traspaso.recibido_con_diferencia', entidadId: t2.id })).toBe(1);
  });

  test('autorizar la diferencia exige PIN del dueño', async () => {
    const autorizar = cuerpo => api(tiendaA, 'post', `/api/traspasos/${t2.id}/autorizar-diferencia`, TA).send(cuerpo);
    expect((await autorizar({ nota: 'Caja rota' })).status).toBe(400);
    expect((await autorizar({ nota: 'Caja rota', autorizacion: { usuario: dueno.usuario.usuario, pin: '0000' } })).status).toBe(401);
    const ok = await autorizar({ nota: 'Caja rota en el camino', autorizacion: { usuario: dueno.usuario.usuario, pin: '4821' } });
    expect(ok.body.datos).toMatchObject({ estado: 'diferencia_autorizada', diferencia: { autorizadoPorNombre: dueno.usuario.nombre } });
    expect(await Auditoria.countDocuments({ accion: 'traspaso.autorizar_diferencia', entidadId: t2.id })).toBe(1);
    expect((await autorizar({ nota: 'otra vez', autorizacion: { usuario: dueno.usuario.usuario, pin: '4821' } })).status).toBe(409);
  });

  test('un lote que caducó en el camino se puede recibir (para darlo de baja después)', async () => {
    const t = (await enviar({ destino: String(TA._id), partidas: [{ producto: String(med._id), cantidad: 1 }] })).body.datos;
    await Traspaso.updateOne({ _id: t.id, origen: ALM._id }, { $set: { 'partidas.0.lotes.0.caducidad': new Date('2020-01-01T00:00:00Z') } });
    const res = await api(tiendaA, 'post', `/api/traspasos/${t.id}/recibir`, TA).send({ recibidos: [[1]] });
    expect(res.status).toBe(200);
  });
});

describe('cancelar', () => {
  test('solo en tránsito y desde el origen; la mercancía regresa a sus lotes', async () => {
    const antes = await restante(med, ALM);
    const t = (await enviar({ destino: String(TB._id), partidas: [{ producto: String(med._id), cantidad: 2 }] })).body.datos;
    expect(await restante(med, ALM)).toBe(antes - 2);
    expect((await api(dueno, 'post', `/api/traspasos/${t.id}/cancelar`, TB).send({ motivo: 'No era' })).status).toBe(404); // desde el destino no
    const res = await api(almacen, 'post', `/api/traspasos/${t.id}/cancelar`, ALM).send({ motivo: 'Se equivocó de tienda' });
    expect(res.body.datos.estado).toBe('cancelado');
    expect(await restante(med, ALM)).toBe(antes);
    expect((await api(dueno, 'post', `/api/traspasos/${t.id}/recibir`, TB).send({ recibidos: [[2]] })).status).toBe(409);
    expect((await api(almacen, 'post', `/api/traspasos/${t1.id}/cancelar`, ALM).send({ motivo: 'tarde' })).status).toBe(409);
  });
});

test('el origen ve sus enviados; el dueño ve todos los de una sucursal', async () => {
  const enviados = await api(almacen, 'get', '/api/traspasos?direccion=enviados', ALM);
  expect(enviados.body.total).toBe(4);
  const deTA = await api(dueno, 'get', '/api/traspasos', TA);
  expect(deTA.body.datos.every(t => t.destino.nombre === 'Tienda A' || t.origen.nombre === 'Tienda A')).toBe(true);
});

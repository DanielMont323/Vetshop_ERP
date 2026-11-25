// Punto de venta por la API: cobrar, precios por lista, descuentos con PIN, pagos, folios, idempotencia,
// receta, ventas en espera, consulta por rol, ticket y cancelación con reversa exacta.
const { randomUUID } = require('crypto');
const h = require('./helpers/app');
const Producto = require('../models/Producto');
const Venta = require('../models/Venta');
const InventoryLayer = require('../models/InventoryLayer');
const InventoryMovement = require('../models/InventoryMovement');
const VentaEnEspera = require('../models/VentaEnEspera');
const inv = require('../services/inventario');
const precios = require('../services/precios');
const { conTransaccion } = require('../helpers/transaccion');
const { desglosarIva } = require('../services/calculoVenta');
const { Auditoria } = h.modelos;

let A, B, dueno, cajero, cajero2, cajeroB, almacen, collar, granel, antibiotico, sinPrecio, raro, clinica;

beforeAll(async () => {
  await h.resetDb();
  A = await h.crearSucursal({ nombre: 'A' });
  B = await h.crearSucursal({ nombre: 'B' });
  dueno = await h.sesion({ rol: 'dueno', pin: '4821' });
  cajero = await h.sesion({ rol: 'cajero', sucursales: [A._id] });
  cajero2 = await h.sesion({ rol: 'cajero', sucursales: [A._id] });
  cajeroB = await h.sesion({ rol: 'cajero', sucursales: [B._id] });
  almacen = await h.sesion({ rol: 'almacen', sucursales: [A._id] });

  collar = await Producto.create({ sku: 'COL', nombre: 'Collar', categoria: 'accesorio', unidad: 'pieza', iva: 'tasa_16' });
  granel = await Producto.create({ sku: 'GRA', nombre: 'Granel', categoria: 'alimento', unidad: 'kg', iva: 'tasa_0' });
  antibiotico = await Producto.create({ sku: 'ANT', nombre: 'Antibiótico', categoria: 'medicamento', unidad: 'pieza', iva: 'tasa_0', requiereReceta: true });
  sinPrecio = await Producto.create({ sku: 'SINP', nombre: 'Sin precio', categoria: 'otro', unidad: 'pieza', iva: 'tasa_16' });
  raro = await Producto.create({ sku: 'RARO', nombre: 'Correa <b>"Pro"</b> & más', categoria: 'accesorio', unidad: 'pieza', iva: 'tasa_16' });

  const actor = dueno.usuario;
  for (const [p, clave, precio] of [[collar, 'publico', 14900], [collar, 'mayoreo', 12000], [granel, 'publico', 8990], [antibiotico, 'publico', 34900], [raro, 'publico', 5000]]) {
    await precios.fijarPrecio({ clave, productoId: p._id, precio }, actor);
  }
  await conTransaccion(async s => {
    const u = actor._id;
    await inv.registrarEntrada({ sucursal: A._id, producto: collar._id, cantidad: 3, costoUnitario: 7000, lote: 'C1', caducidad: '01/2028', origen: 'compra', usuario: u }, s);
    await inv.registrarEntrada({ sucursal: A._id, producto: collar._id, cantidad: 100, costoUnitario: 7500, lote: 'C2', caducidad: '06/2028', origen: 'compra', usuario: u }, s);
    await inv.registrarEntrada({ sucursal: A._id, producto: granel._id, cantidad: 50000, costoUnitario: 5000, caducidad: '12/2027', origen: 'compra', usuario: u }, s);
    await inv.registrarEntrada({ sucursal: A._id, producto: antibiotico._id, cantidad: 5, costoUnitario: 20000, lote: 'AB', caducidad: '12/2027', origen: 'compra', usuario: u }, s);
    await inv.registrarEntrada({ sucursal: A._id, producto: raro._id, cantidad: 5, costoUnitario: 2000, origen: 'compra', usuario: u }, s);
    await inv.registrarEntrada({ sucursal: A._id, producto: sinPrecio._id, cantidad: 5, costoUnitario: 2000, origen: 'compra', usuario: u }, s);
    await inv.registrarEntrada({ sucursal: B._id, producto: collar._id, cantidad: 5, costoUnitario: 7000, origen: 'compra', usuario: u }, s);
  });
  const res = await h.request(h.app).post('/api/clientes').set(h.auth(dueno.token)).send({ nombre: 'Clínica Patitas (prueba)', tipo: 'clinica', listaPrecios: 'mayoreo' });
  clinica = res.body.datos;
});
afterAll(h.cerrar);

const vender = (s, cuerpo, sucursal = A) =>
  h.request(h.app).post('/api/ventas').set(h.auth(s.token, sucursal)).send({ claveOperacion: randomUUID(), ...cuerpo });
const efectivo = monto => [{ metodo: 'efectivo', monto }];
const restante = async (producto, sucursal = A) =>
  (await InventoryLayer.find({ sucursal: sucursal._id, producto: producto._id }).lean()).reduce((s, c) => s + c.cantidadRestante, 0);
const pinDueno = () => ({ usuario: dueno.usuario.usuario, pin: '4821' });

describe('cobrar', () => {
  test('público en general: precios del servidor, IVA desglosado, cambio, lotes FEFO; el cajero no ve costos', async () => {
    const res = await vender(cajero, { partidas: [{ producto: String(collar._id), cantidad: 4 }, { producto: String(granel._id), cantidad: 750 }], pagos: efectivo(100000) });
    expect(res.status).toBe(201);
    const v = res.body.datos;
    const total = 4 * 14900 + 6743; // granel: 89.90 × 0.75 = 67.425 → 67.43
    expect(v).toMatchObject({ serie: 'V', folio: 1, estado: 'cobrada', total, descuento: 0, cambio: 100000 - total, cliente: { nombre: 'Público en general' }, listaPrecios: 'publico' });
    expect(v.iva).toBe(desglosarIva(59600, 1600));
    expect(v.partidas[0].lotes.map(l => [l.lote, l.cantidad])).toEqual([['C1', 3], ['C2', 1]]);
    expect(v.costo).toBeUndefined();
    expect(v.partidas[0].costo).toBeUndefined();
    expect(await restante(collar)).toBe(99);

    // El dueño sí ve el costo guardado (3 × 70 + 1 × 75)
    const conCosto = await h.request(h.app).get(`/api/ventas/${v.id}`).set(h.auth(dueno.token, A));
    expect(conCosto.body.datos.partidas[0].costo).toBe(28500);
  });

  test('folios consecutivos por sucursal; cada sucursal empieza en 1', async () => {
    const r2 = await vender(cajero, { partidas: [{ producto: String(collar._id), cantidad: 1 }], pagos: efectivo(14900) });
    expect(r2.body.datos.folio).toBe(2);
    const rB = await vender(cajeroB, { partidas: [{ producto: String(collar._id), cantidad: 1 }], pagos: efectivo(14900) }, B);
    expect(rB.body.datos.folio).toBe(1);
  });

  test('cliente con lista mayoreo; si un producto no tiene precio de mayoreo se usa el de público', async () => {
    const res = await vender(cajero, { cliente: clinica.id, partidas: [{ producto: String(collar._id), cantidad: 1 }, { producto: String(granel._id), cantidad: 1000 }], pagos: efectivo(20990) });
    expect(res.status).toBe(201);
    expect(res.body.datos.partidas.map(p => [p.listaAplicada, p.precioUnitario])).toEqual([['mayoreo', 12000], ['publico', 8990]]);
    expect(res.body.datos.cliente.nombre).toBe('Clínica Patitas (prueba)');
  });

  test('el precio lo decide el servidor: un precio enviado por la caja se ignora', async () => {
    const res = await vender(cajero, { partidas: [{ producto: String(collar._id), cantidad: 1, precioUnitario: 1 }], pagos: efectivo(14900) });
    expect(res.body.datos.total).toBe(14900);
  });

  test('pagos mixtos y validaciones de pago', async () => {
    const ok = await vender(cajero, { partidas: [{ producto: String(collar._id), cantidad: 2 }], pagos: [{ metodo: 'tarjeta', monto: 20000, referencia: '4321' }, { metodo: 'efectivo', monto: 10000 }] });
    expect(ok.status).toBe(201);
    expect(ok.body.datos.cambio).toBe(200);
    expect((await vender(cajero, { partidas: [{ producto: String(collar._id), cantidad: 1 }], pagos: efectivo(10000) })).status).toBe(400);
    expect((await vender(cajero, { partidas: [{ producto: String(collar._id), cantidad: 1 }], pagos: [{ metodo: 'tarjeta', monto: 20000 }] })).status).toBe(400);
    expect((await vender(cajero, { partidas: [{ producto: String(collar._id), cantidad: 1 }], pagos: [{ metodo: 'vales', monto: 14900 }] })).status).toBe(400);
  });

  test('descuento: sin autorización 403; PIN equivocado 401; con PIN del dueño se cobra y queda en bitácora', async () => {
    const cuerpo = { partidas: [{ producto: String(collar._id), cantidad: 1, descuentoPorcentaje: 1000 }], pagos: efectivo(13410) };
    expect((await vender(cajero, cuerpo)).body.codigo).toBe('AUTORIZACION_REQUERIDA');
    expect((await vender(cajero, { ...cuerpo, autorizacion: { usuario: dueno.usuario.usuario, pin: '0000' } })).status).toBe(401);
    const ok = await vender(cajero, { ...cuerpo, autorizacion: pinDueno() });
    expect(ok.status).toBe(201);
    expect(ok.body.datos).toMatchObject({ subtotal: 14900, descuento: 1490, total: 13410 });
    expect(ok.body.datos.partidas[0]).toMatchObject({ descuentoPorcentaje: 1000, descuento: 1490, precioUnitario: 14900 });
    const registro = await Auditoria.findOne({ accion: 'venta.descuento', entidadId: ok.body.datos.id });
    expect(registro.autorizadoPor).toEqual(dueno.usuario._id);
  });

  test('producto con receta → 409 RECETA_REQUERIDA y no se descuenta nada', async () => {
    const res = await vender(cajero, { partidas: [{ producto: String(antibiotico._id), cantidad: 1 }], pagos: efectivo(34900) });
    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe('RECETA_REQUERIDA');
    expect(await restante(antibiotico)).toBe(5);
  });

  test('sin precio → 409 SIN_PRECIO; sin existencia → 409 y NO se gasta folio', async () => {
    expect((await vender(cajero, { partidas: [{ producto: String(sinPrecio._id), cantidad: 1 }], pagos: efectivo(100) })).body.codigo).toBe('SIN_PRECIO');
    const antes = await Venta.countDocuments({ sucursal: A._id });
    const sinExistencia = await vender(cajero, { partidas: [{ producto: String(collar._id), cantidad: 5000 }], pagos: efectivo(5000 * 14900) });
    expect(sinExistencia.status).toBe(409);
    expect(sinExistencia.body.codigo).toBe('EXISTENCIA_INSUFICIENTE');
    const siguiente = await vender(cajero, { partidas: [{ producto: String(collar._id), cantidad: 1 }], pagos: efectivo(14900) });
    expect(siguiente.body.datos.folio).toBe(antes + 1); // sin huecos
  });

  test('misma claveOperacion dos veces (doble clic): se cobra una sola vez', async () => {
    const claveOperacion = randomUUID();
    const cuerpo = { claveOperacion, partidas: [{ producto: String(collar._id), cantidad: 1 }], pagos: efectivo(14900) };
    const antes = await restante(collar);
    const r = await Promise.all([vender(cajero, cuerpo), vender(cajero, cuerpo), vender(cajero, cuerpo)]);
    expect(new Set(r.map(x => x.body.datos.id)).size).toBe(1);
    expect(r.filter(x => x.body.repetida === false)).toHaveLength(1);
    expect(await restante(collar)).toBe(antes - 1);
  });

  test('ventas simultáneas: folios únicos y consecutivos', async () => {
    const antes = await Venta.countDocuments({ sucursal: A._id });
    const r = await Promise.all([1, 2, 3, 4, 5].map(() => vender(cajero, { partidas: [{ producto: String(collar._id), cantidad: 1 }], pagos: efectivo(14900) })));
    expect(r.every(x => x.status === 201)).toBe(true);
    expect(r.map(x => x.body.datos.folio).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5].map(i => antes + i));
  });

  test('el cajero de A no cobra en B; almacén no cobra; sin X-Sucursal → 400', async () => {
    expect((await vender(cajero, { partidas: [{ producto: String(collar._id), cantidad: 1 }], pagos: efectivo(14900) }, B)).status).toBe(403);
    expect((await vender(almacen, { partidas: [{ producto: String(collar._id), cantidad: 1 }], pagos: efectivo(14900) })).status).toBe(403);
    expect((await vender(cajero, { partidas: [{ producto: String(collar._id), cantidad: 1 }], pagos: efectivo(14900) }, null)).status).toBe(400);
  });
});

describe('ventas en espera', () => {
  test('guardar no consume inventario; cobrarla la borra en la misma operación', async () => {
    const antes = await restante(collar);
    const e = await h.request(h.app).post('/api/ventas/espera').set(h.auth(cajero.token, A)).send({ nota: 'Señora del perro café', partidas: [{ producto: String(collar._id), cantidad: 2 }] });
    expect(e.status).toBe(201);
    expect(await restante(collar)).toBe(antes);
    const lista = await h.request(h.app).get('/api/ventas/espera').set(h.auth(cajero2.token, A));
    expect(lista.body.datos.map(x => x.nota)).toContain('Señora del perro café');

    const v = await vender(cajero2, { esperaId: e.body.datos.id, partidas: [{ producto: String(collar._id), cantidad: 2 }], pagos: efectivo(29800) });
    expect(v.status).toBe(201);
    expect(await VentaEnEspera.countDocuments({ sucursal: A._id, _id: e.body.datos.id })).toBe(0);
    expect(await restante(collar)).toBe(antes - 2);
  });
});

describe('consultar', () => {
  test('el cajero ve solo SUS ventas de hoy; otro cajero no ve las ajenas; almacén no ve ventas', async () => {
    const mias = await h.request(h.app).get('/api/ventas').set(h.auth(cajero.token, A));
    expect(mias.status).toBe(200);
    expect(mias.body.datos.every(v => String(v.cajero.id) === String(cajero.usuario._id))).toBe(true);
    const ajena = mias.body.datos[0].id;
    expect((await h.request(h.app).get(`/api/ventas/${ajena}`).set(h.auth(cajero2.token, A))).status).toBe(404);
    expect((await h.request(h.app).get('/api/ventas').set(h.auth(almacen.token, A))).status).toBe(403);
  });

  test('el dueño ve todas las de la sucursal, con costo', async () => {
    const todas = await h.request(h.app).get('/api/ventas?limite=200').set(h.auth(dueno.token, A));
    expect(new Set(todas.body.datos.map(v => String(v.cajero.id))).size).toBe(2);
    expect(todas.body.datos[0].costo).toBeGreaterThan(0);
  });
});

describe('ticket', () => {
  test('HTML para 80 mm (y 58 mm) con folio, total, pagos; el texto se escapa', async () => {
    const v = (await vender(cajero, { partidas: [{ producto: String(raro._id), cantidad: 1 }], pagos: efectivo(10000) })).body.datos;
    const res = await h.request(h.app).get(`/api/ventas/${v.id}/ticket`).set(h.auth(cajero.token, A));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain(`V-${v.folio}`);
    expect(res.text).toContain('TOTAL');
    expect(res.text).toContain('$50.00');
    expect(res.text).toContain('Cambio');
    expect(res.text).toContain('Correa &lt;b&gt;&quot;Pro&quot;&lt;/b&gt; &amp; más');
    expect(res.text).not.toContain('<b>"Pro"</b>');
    expect(res.text).toContain('width: 80mm');
    const angosto = await h.request(h.app).get(`/api/ventas/${v.id}/ticket?ancho=58`).set(h.auth(cajero.token, A));
    expect(angosto.text).toContain('width: 58mm');
  });
});

describe('cancelar', () => {
  test('con PIN del dueño: devuelve la mercancía a los lotes exactos, en bitácora; no se cancela dos veces', async () => {
    const v = (await vender(cajero, { partidas: [{ producto: String(granel._id), cantidad: 2500 }], pagos: efectivo(22475) })).body.datos;
    const antes = await restante(granel);
    const cancelar = cuerpo => h.request(h.app).post(`/api/ventas/${v.id}/cancelar`).set(h.auth(cajero.token, A)).send(cuerpo);

    expect((await cancelar({ motivo: 'Se equivocó de producto' })).status).toBe(400);
    expect((await cancelar({ motivo: 'Se equivocó de producto', autorizacion: { usuario: dueno.usuario.usuario, pin: '0000' } })).status).toBe(401);
    const res = await cancelar({ motivo: 'Se equivocó de producto', autorizacion: pinDueno() });
    expect(res.status).toBe(200);
    expect(res.body.datos.estado).toBe('cancelada');
    expect(await restante(granel)).toBe(antes + 2500);
    const reversa = await InventoryMovement.findOne({ sucursal: A._id, 'referencia.id': v.id, tipo: 'cancelacion' }).lean();
    expect(reversa.capas.map(c => String(c.capa))).toEqual(v.partidas[0].lotes.map(l => String(l.capa)));
    expect(await Auditoria.countDocuments({ accion: 'venta.cancelar', entidadId: v.id })).toBe(1);

    expect((await cancelar({ motivo: 'otra vez', autorizacion: pinDueno() })).status).toBe(409);
    const ticket = await h.request(h.app).get(`/api/ventas/${v.id}/ticket`).set(h.auth(cajero.token, A));
    expect(ticket.text).toContain('CANCELADA');
  });

  test('una venta es inmutable: no hay PUT y el modelo rechaza cambios que no sean la cancelación', async () => {
    const v = (await vender(cajero, { partidas: [{ producto: String(collar._id), cantidad: 1 }], pagos: efectivo(14900) })).body.datos;
    expect((await h.request(h.app).put(`/api/ventas/${v.id}`).set(h.auth(dueno.token, A)).send({ total: 1 })).status).toBe(404);
    await expect(Venta.updateOne({ _id: v.id, sucursal: A._id }, { $set: { total: 1 } })).rejects.toThrow(/no se puede modificar/);
    await expect(Venta.deleteOne({ _id: v.id, sucursal: A._id })).rejects.toThrow(/no se puede borrar/);
  });
});

describe('clientes', () => {
  test('el cajero consulta pero no crea; "Público en general" no se desactiva', async () => {
    const lista = await h.request(h.app).get('/api/clientes').set(h.auth(cajero.token));
    expect(lista.body.datos[0]).toMatchObject({ nombre: 'Público en general', esPublicoGeneral: true });
    expect((await h.request(h.app).post('/api/clientes').set(h.auth(cajero.token)).send({ nombre: 'X', tipo: 'publico', listaPrecios: 'empleado' })).status).toBe(403);
    const pg = lista.body.datos[0].id;
    expect((await h.request(h.app).patch(`/api/clientes/${pg}`).set(h.auth(dueno.token)).send({ activo: false })).status).toBe(400);
  });
});

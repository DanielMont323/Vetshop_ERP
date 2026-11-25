// Listas de precios: las 4 listas, fijar y quitar precios, precio con respaldo en "público".
const h = require('./helpers/app');
const Producto = require('../models/Producto');
const ListaPrecios = require('../models/ListaPrecios');
const precios = require('../services/precios');
const { Auditoria } = h.modelos;

let dueno, cajero, croqueta, granel;
beforeAll(async () => {
  await h.resetDb();
  const centro = await h.crearSucursal({ nombre: 'Centro' });
  dueno = await h.sesion({ rol: 'dueno' });
  cajero = await h.sesion({ rol: 'cajero', sucursales: [centro._id] });
  croqueta = await Producto.create({ sku: 'CRQ-1', nombre: 'Croqueta', categoria: 'alimento', unidad: 'pieza', iva: 'tasa_0' });
  granel = await Producto.create({ sku: 'GRA-1', nombre: 'Granel', categoria: 'alimento', unidad: 'kg', iva: 'tasa_0' });
});
afterAll(h.cerrar);

const api = (metodo, ruta, token = dueno.token) => h.request(h.app)[metodo](ruta).set(h.auth(token));
const fijar = (clave, producto, precio, token) => api('put', `/api/listas-precios/${clave}/precios/${producto._id}`, token).send({ precio });

test('GET /api/listas-precios devuelve siempre las 4 listas (aunque estén vacías)', async () => {
  const res = await api('get', '/api/listas-precios', cajero.token);
  expect(res.status).toBe(200);
  expect(res.body.datos.map(l => l.clave)).toEqual(['publico', 'mayoreo', 'clinica', 'empleado']);
  expect(res.body.datos.every(l => l.totalPrecios === 0)).toBe(true);
});

test('fijar un precio crea la lista si no existía, y cambiarlo no duplica la entrada', async () => {
  expect((await fijar('mayoreo', croqueta, 110000)).status).toBe(200);
  expect((await fijar('mayoreo', croqueta, 105000)).status).toBe(200);
  const lista = await ListaPrecios.findOne({ clave: 'mayoreo' }).lean();
  expect(lista.nombre).toBe('Mayoreo');
  expect(lista.precios).toEqual([{ producto: croqueta._id, precio: 105000 }]);

  const registros = await Auditoria.find({ entidadId: croqueta._id, accion: 'precio.cambiar' }).sort({ fecha: 1 }).lean();
  expect(registros.map(r => [r.antes.precio, r.despues.precio])).toEqual([[null, 110000], [110000, 105000]]);
});

test('fijados en paralelo para el mismo producto no lo duplican en la lista', async () => {
  await Promise.allSettled([fijar('clinica', granel, 7000), fijar('clinica', granel, 7100), fijar('clinica', granel, 7200)]);
  const lista = await ListaPrecios.findOne({ clave: 'clinica' }).lean();
  expect(lista.precios.filter(p => p.producto.equals(granel._id))).toHaveLength(1);
});

test('DELETE quita el precio y lo registra', async () => {
  await fijar('empleado', croqueta, 99000);
  const res = await api('delete', `/api/listas-precios/empleado/precios/${croqueta._id}`);
  expect(res.status).toBe(200);
  expect((await precios.preciosDeProducto(croqueta._id)).empleado).toBeUndefined();
  expect(await Auditoria.countDocuments({ entidadId: croqueta._id, accion: 'precio.quitar' })).toBe(1);
});

test('validaciones: centavos enteros, lista y producto existentes', async () => {
  expect((await fijar('publico', croqueta, 1299.5)).status).toBe(400);
  expect((await fijar('publico', croqueta, '129900')).status).toBe(400);
  expect((await fijar('publico', croqueta, -100)).status).toBe(400);
  expect((await fijar('vip', croqueta, 100)).status).toBe(400);
  expect((await api('put', '/api/listas-precios/publico/precios/64b7f0c2a1b2c3d4e5f60718').send({ precio: 100 })).status).toBe(404);
});

test('solo el dueño cambia precios (403 para el cajero)', async () => {
  expect((await fijar('publico', croqueta, 100, cajero.token)).status).toBe(403);
  expect((await api('delete', `/api/listas-precios/publico/precios/${croqueta._id}`, cajero.token)).status).toBe(403);
});

describe('resolverPrecio (lo usará la caja en el Paso 5)', () => {
  beforeAll(async () => {
    await fijar('publico', croqueta, 129900);
    await fijar('mayoreo', croqueta, 105000);
  });

  test('usa el precio de la lista del cliente', async () => {
    expect(await precios.resolverPrecio(croqueta._id, 'mayoreo')).toEqual({ precio: 105000, lista: 'mayoreo' });
  });

  test('si la lista del cliente no tiene precio, usa el de público y lo dice', async () => {
    expect(await precios.resolverPrecio(croqueta._id, 'empleado')).toEqual({ precio: 129900, lista: 'publico' });
  });

  test('sin precio en público ni en su lista → null (la caja no podrá venderlo)', async () => {
    expect(await precios.resolverPrecio(granel._id, 'mayoreo')).toBeNull();
  });

  test('lista desconocida → error', async () => {
    await expect(precios.resolverPrecio(croqueta._id, 'vip')).rejects.toMatchObject({ status: 404 });
  });
});

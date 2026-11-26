// Los datos de demostración se cargan completos y dejan el sistema listo para enseñarlo.
const h = require('./helpers/app');
const { sembrar } = require('../scripts/datosDemo');
const Producto = require('../models/Producto');
const InventoryLayer = require('../models/InventoryLayer');

beforeAll(h.resetDb);
afterAll(h.cerrar);

test('sembrar crea usuarios con PIN, catálogo con precios, inventario con alertas, proveedores y clientes', async () => {
  const usuarios = await sembrar({ password: 'Demo-12345', pinDueno: '2468', pinMedico: '1357' });
  expect(usuarios).toEqual(['dueno.demo', 'cajero.centro', 'almacen.demo', 'medico.demo']);
  expect(await Producto.countDocuments({})).toBe(5);

  const login = await h.login('dueno.demo', 'Demo-12345');
  expect(login.status).toBe(200);
  const token = login.body.datos.token;
  const centro = login.body.datos.usuario.sucursales.find(s => s.nombre === 'Centro (prueba)');
  const existencias = await h.request(h.app).get('/api/existencias').set(h.auth(token, centro.id));
  const alertas = existencias.body.datos.flatMap(f => f.alertas);
  expect(alertas).toEqual(expect.arrayContaining(['caducado', 'por_caducar']));
  expect(await InventoryLayer.countDocuments({ sucursal: { $exists: true } }).setOptions({ sinAlcance: true })).toBe(12);

  const clientes = await h.request(h.app).get('/api/clientes').set(h.auth(token));
  expect(clientes.body.datos.map(c => c.nombre)).toContain('Público en general');
});

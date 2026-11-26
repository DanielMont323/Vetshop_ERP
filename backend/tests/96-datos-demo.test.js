// Los datos de demostración se cargan completos (Fase 1 y Fase 2) y dejan el sistema listo para enseñarlo.
const fs = require('fs');
const os = require('os');
const path = require('path');

const CARPETA = fs.mkdtempSync(path.join(os.tmpdir(), 'vetshop-demo-'));
process.env.ALMACENAMIENTO = 'local';
process.env.ALMACENAMIENTO_CARPETA = CARPETA;
process.env.FACTURACION_PAC = 'simulado';

const h = require('./helpers/app');
const { sembrar } = require('../scripts/datosDemo');
const Producto = require('../models/Producto');
const InventoryLayer = require('../models/InventoryLayer');

beforeAll(h.resetDb);
afterAll(async () => {
  await h.cerrar();
  fs.rmSync(CARPETA, { recursive: true, force: true });
});

let token, centro;

test('sembrar crea usuarios con PIN, catálogo con precios, inventario con alertas, proveedores y clientes', async () => {
  const usuarios = await sembrar({ password: 'Demo-12345', pinDueno: '2468', pinMedico: '1357' });
  expect(usuarios).toEqual(['dueno.demo', 'cajero.centro', 'cajero.norte', 'almacen.demo', 'medico.demo']);
  expect(await Producto.countDocuments({})).toBe(5);

  const login = await h.login('dueno.demo', 'Demo-12345');
  expect(login.status).toBe(200);
  token = login.body.datos.token;
  centro = login.body.datos.usuario.sucursales.find(s => s.nombre === 'Centro (prueba)');
  const existencias = await h.request(h.app).get('/api/existencias').set(h.auth(token, centro.id));
  const alertas = existencias.body.datos.flatMap(f => f.alertas);
  expect(alertas).toEqual(expect.arrayContaining(['caducado', 'por_caducar']));
  // 12 lotes iniciales + 2 compras recibidas en la demo
  expect(await InventoryLayer.countDocuments({ sucursal: { $exists: true } }).setOptions({ sinAlcance: true })).toBe(14);

  const clientes = await h.request(h.app).get('/api/clientes').set(h.auth(token));
  expect(clientes.body.datos.map(c => c.nombre)).toContain('Público en general');
});

test('Fase 2: ventas, cartera con vencido, cuentas por pagar, frío, metas y factura de prueba', async () => {
  const get = ruta => h.request(h.app).get(ruta).set(h.auth(token, centro.id));

  const cartera = (await get('/api/cobranza/cartera')).body;
  const peludos = cartera.datos.find(f => f.cliente.nombre === 'Estética Peludos (prueba)');
  expect(peludos.vencido).toBeGreaterThan(0);
  expect(cartera.datos.find(f => f.cliente.nombre === 'Clínica Patitas (prueba)').saldo).toBe(224000 - 50000);

  const porPagar = (await h.request(h.app).get('/api/cuentas-por-pagar').set(h.auth(token))).body;
  expect(porPagar.resumen).toMatchObject({ facturas: 1, venceSemana: 155000 });

  const equipos = (await get('/api/cadena-frio/equipos')).body.datos;
  expect(equipos.map(e => e.nombre)).toEqual(['Refri vacunas (prueba)']);
  expect((await get('/api/cadena-frio/lecturas?fueraDeRango=true')).body.datos).toHaveLength(1);

  const avance = (await get('/api/metas')).body.datos.sucursales.find(s => s.sucursal.id === centro.id);
  expect(avance.meta).toBe(5000000);
  expect(avance.vendedores[0]).toMatchObject({ vendedor: { nombre: 'Cajero Centro' }, meta: 3000000 });

  const facturas = (await get('/api/facturas')).body;
  expect(facturas.datos).toEqual([expect.objectContaining({ folioCompleto: 'F-1', metodoPago: 'PPD', pac: 'simulado', estado: 'timbrada' })]);

  const tablero = (await get('/api/reportes/dashboard')).body.datos;
  expect(tablero.alertas).toMatchObject({ lecturasFueraDeRango: 1 });
  expect(tablero.metas).toHaveLength(1);
});

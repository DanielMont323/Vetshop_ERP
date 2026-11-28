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
  // 12 lotes iniciales + 6 de existencia extra + 3 compras + 2 traspasos recibidos/ajustes de la demo
  expect(await InventoryLayer.countDocuments({ sucursal: { $exists: true } }).setOptions({ sinAlcance: true })).toBeGreaterThanOrEqual(21);

  const clientes = await h.request(h.app).get('/api/clientes').set(h.auth(token));
  expect(clientes.body.datos.map(c => c.nombre)).toContain('Público en general');
});

test('Fase 2: ventas, cartera con vencido, cuentas por pagar, traspasos, recetas, conteo, frío, metas y facturas', async () => {
  const get = ruta => h.request(h.app).get(ruta).set(h.auth(token, centro.id));

  const cartera = (await get('/api/cobranza/cartera')).body;
  const peludos = cartera.datos.find(f => f.cliente.nombre === 'Estética Peludos (prueba)');
  expect(peludos.vencido).toBeGreaterThan(0);
  expect(cartera.datos.find(f => f.cliente.nombre === 'Clínica Patitas (prueba)').saldo).toBe(224000 - 50000 - 30000); // abono de la Fase 2 y de la Fase 3

  const porPagar = (await h.request(h.app).get('/api/cuentas-por-pagar').set(h.auth(token))).body;
  expect(porPagar.resumen).toMatchObject({ facturas: 3, venceSemana: 155000 }); // + DEMO-201 de la Fase 3 (vence en 30 días)
  expect(porPagar.resumen.vencido).toBe(250000 - 100000);

  // Cuatro semanas de ventas en Centro y Norte
  const { diaLocal } = require('../helpers/fechas');
  const desde = diaLocal(new Date(Date.now() - 30 * 86400000));
  const reporte = (await h.request(h.app).get(`/api/reportes/ventas?desde=${desde}&hasta=${diaLocal()}`).set(h.auth(token))).body.datos;
  expect(reporte.sucursales.map(s => s.sucursal.nombre).sort()).toEqual(['Centro (prueba)', 'Norte (prueba)']);
  expect(reporte.totales.ventas).toBeGreaterThan(40);

  const traspasos = (await h.request(h.app).get('/api/traspasos').set(h.auth(token))).body.datos;
  expect(traspasos.map(x => x.estado).sort()).toEqual(['en_transito', 'recibido']);
  expect((await get('/api/recetas')).body.datos.map(r => r.estado).sort()).toEqual(['pendiente', 'validada']);
  expect((await h.request(h.app).get('/api/conteos').set(h.auth(token))).body.datos[0]).toMatchObject({ estado: 'aplicado' });
  expect((await get('/api/ventas/espera')).body.datos).toHaveLength(1);

  const equipos = (await get('/api/cadena-frio/equipos')).body.datos;
  expect(equipos.map(e => e.nombre)).toEqual(['Refri vacunas (prueba)']);
  expect((await get('/api/cadena-frio/lecturas?fueraDeRango=true')).body.datos).toHaveLength(1);

  const avance = (await get('/api/metas')).body.datos.sucursales.find(s => s.sucursal.id === centro.id);
  expect(avance.meta).toBe(2500000);
  expect(avance.vendedores[0]).toMatchObject({ vendedor: { nombre: 'Cajero Centro' }, meta: 2000000 });

  const facturas = (await get('/api/facturas')).body;
  expect(facturas.datos).toEqual(expect.arrayContaining([expect.objectContaining({ folioCompleto: 'F-1', metodoPago: 'PPD', pac: 'simulado', estado: 'timbrada' })]));

  const tablero = (await get('/api/reportes/dashboard')).body.datos;
  expect(tablero.alertas).toMatchObject({ lecturasFueraDeRango: 1 });
  expect(tablero.metas).toHaveLength(1);
});

test('Fase 3: promociones, lealtad, mascotas, recordatorios, gastos de caja, pedidos y complemento de pago', async () => {
  const get = ruta => h.request(h.app).get(ruta).set(h.auth(token, centro.id));
  const { yaCargada } = require('../scripts/datosDemoFase3');
  expect(await yaCargada()).toBe(true);

  expect((await get('/api/promociones?estado=vigentes')).body.datos.map(p => p.nombre).sort()).toEqual(['Accesorios 10 % (prueba)', 'Vacunas por caducar (prueba)']);
  expect((await get('/api/promociones?estado=proximas')).body.datos).toHaveLength(1);
  const cfg = (await get('/api/configuracion')).body.datos;
  expect(cfg.descuentos.motivos[0]).toEqual({ nombre: 'Cliente frecuente', maximo: 1000, requierePin: false });

  const clientes = (await get('/api/clientes')).body.datos;
  const ana = clientes.find(c => c.nombre === 'Ana Martínez (prueba)');
  expect(ana.lealtad.costales).toBe(5);
  expect(ana.lealtad.puntos).toBeGreaterThan(0);
  const movimientos = (await get(`/api/clientes/${ana.id}/lealtad`)).body.datos.movimientos.map(m => m.tipo);
  expect(movimientos).toEqual(expect.arrayContaining(['acumulo', 'canje']));
  expect((await get(`/api/mascotas?cliente=${ana.id}`)).body.datos.map(m => m.nombre)).toEqual(['Max', 'Michi']);

  expect((await get('/api/recordatorios?vista=hoy')).body.datos).toHaveLength(3);
  expect((await get('/api/recordatorios?vista=proximos')).body.datos).toHaveLength(1);
  expect((await get('/api/recordatorios?vista=avisados')).body.datos).toHaveLength(1);

  const turno = (await h.request(h.app).get('/api/turnos/actual').set(h.auth((await h.login('cajero.centro', 'Demo-12345')).body.datos.token, centro.id))).body.datos;
  expect(turno.retiros.filter(r => r.tipo === 'gasto')).toHaveLength(2);

  const almacen = (await h.request(h.app).get('/api/sucursales').set(h.auth(token))).body.datos.find(s => s.nombre === 'Almacén (prueba)');
  const peds = (await h.request(h.app).get('/api/pedidos').set(h.auth(token, almacen.id))).body.datos;
  expect(peds.map(p => p.estado).sort()).toEqual(['borrador', 'enviado', 'parcial']);

  const facturas = (await get('/api/facturas')).body.datos;
  expect(facturas.some(f => f.tipo === 'P' && f.estado === 'timbrada')).toBe(true);
  const sugeridas = (await get('/api/compras/sugeridas?todos=true')).body.datos;
  expect(sugeridas.find(f => f.producto.sku === 'CRQ-AD-20')).toBeTruthy();
});

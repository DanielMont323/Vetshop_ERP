// Dashboard y reportes: totales y margen, agrupación por día/semana/mes/año en hora de Tepic,
// por sucursal, cajero, forma de pago, público vs distribución, productos; Excel; permisos.
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const h = require('./helpers/app');
const Venta = require('../models/Venta');
const Cliente = require('../models/Cliente');
const Turno = require('../models/Turno');

const { ObjectId } = mongoose.Types;
let A, B, dueno, cajero, publicoGeneral, clinica;
const cajero1 = { id: new ObjectId(), nombre: 'Ana' };
const cajero2 = { id: new ObjectId(), nombre: 'Beto' };
const prodX = { id: new ObjectId(), sku: 'X', nombre: 'Producto X' };
const prodY = { id: new ObjectId(), sku: 'Y', nombre: 'Granel Y' };

let folio = 0;
// Venta "a mano" con importes exactos. partidas: [{ prod, cantidad, importe, iva, costo, unidad }]
function venta({ sucursal = A, fecha, cliente = publicoGeneral, cajero = cajero1, partidas, pagos, cambio = 0, estado = 'cobrada' }) {
  folio += 1;
  const filas = partidas.map(p => ({
    producto: p.prod.id, sku: p.prod.sku, nombre: p.prod.nombre, unidad: p.unidad || 'pieza', cantidad: p.cantidad, listaAplicada: 'publico',
    precioUnitario: p.importe, tipoIva: 'tasa_16', tasaIva: 1600, bruto: p.importe, descuento: 0, importe: p.importe, iva: p.iva, costo: p.costo, lotes: []
  }));
  const total = filas.reduce((s, p) => s + p.importe, 0);
  return Venta.create({
    sucursal: sucursal._id, serie: 'V', folio, caja: 1, cajero: cajero.id, cajeroNombre: cajero.nombre,
    cliente: cliente._id, clienteNombre: cliente.nombre, listaPrecios: cliente.listaPrecios,
    partidas: filas, subtotal: total, descuento: 0, total, iva: filas.reduce((s, p) => s + p.iva, 0), costo: filas.reduce((s, p) => s + p.costo, 0),
    pagos, cambio, estado, claveOperacion: `prueba-${folio}`, fecha: new Date(fecha)
  });
}

beforeAll(async () => {
  await h.resetDb();
  A = await h.crearSucursal({ nombre: 'Centro' });
  B = await h.crearSucursal({ nombre: 'Norte' });
  dueno = await h.sesion({ rol: 'dueno' });
  cajero = await h.sesion({ rol: 'cajero', sucursales: [A._id] });
  publicoGeneral = await Cliente.create({ nombre: 'Público en general', tipo: 'publico', listaPrecios: 'publico', esPublicoGeneral: true });
  clinica = await Cliente.create({ nombre: 'Clínica', tipo: 'clinica', listaPrecios: 'mayoreo' });

  // 24/11/2026 en Tepic (UTC-7): de 07:00Z del 24 a 06:59Z del 25
  await venta({ fecha: '2026-11-24T16:00:00Z', partidas: [{ prod: prodX, cantidad: 2, importe: 11600, iva: 1600, costo: 6000 }], pagos: [{ metodo: 'efectivo', monto: 20000 }], cambio: 8400 });
  await venta({ fecha: '2026-11-25T05:00:00Z', cajero: cajero2, cliente: clinica, partidas: [{ prod: prodY, cantidad: 1500, importe: 5000, iva: 0, costo: 3000, unidad: 'kg' }], pagos: [{ metodo: 'tarjeta', monto: 5000 }] }); // 24/11 22:00 Tepic
  // 25/11/2026 en Tepic
  await venta({ fecha: '2026-11-25T08:00:00Z', partidas: [{ prod: prodX, cantidad: 1, importe: 5800, iva: 800, costo: 3000 }], pagos: [{ metodo: 'transferencia', monto: 5800 }] });
  await venta({ fecha: '2026-11-25T09:00:00Z', estado: 'cancelada', partidas: [{ prod: prodX, cantidad: 9, importe: 99999, iva: 0, costo: 1 }], pagos: [{ metodo: 'efectivo', monto: 99999 }] });
  // Otra sucursal, mismo día
  await venta({ sucursal: B, fecha: '2026-11-24T18:00:00Z', partidas: [{ prod: prodX, cantidad: 1, importe: 5800, iva: 800, costo: 3000 }], pagos: [{ metodo: 'efectivo', monto: 5800 }] });
  // Diciembre
  await venta({ fecha: '2026-12-02T18:00:00Z', partidas: [{ prod: prodX, cantidad: 1, importe: 5800, iva: 800, costo: 3000 }], pagos: [{ metodo: 'efectivo', monto: 5800 }] });
});
afterAll(h.cerrar);

const get = (ruta, sucursal) => h.request(h.app).get(ruta).set(h.auth(dueno.token, sucursal));

describe('reporte de ventas', () => {
  test('totales del día en Tepic: una venta de las 22:00 cuenta para ese día, no para el siguiente; canceladas no cuentan', async () => {
    const res = await get('/api/reportes/ventas?desde=2026-11-24&hasta=2026-11-24', A);
    expect(res.status).toBe(200);
    expect(res.body.datos.totales).toMatchObject({ ventas: 2, total: 16600, iva: 1600, base: 15000, costo: 9000, margen: 6000, margenPorcentaje: 40, ticketPromedio: 8300 });
    const dia25 = await get('/api/reportes/ventas?desde=2026-11-25&hasta=2026-11-25', A);
    expect(dia25.body.datos.totales).toMatchObject({ ventas: 1, total: 5800 });
  });

  test('por día rellena los días sin ventas; por semana, mes y año', async () => {
    const dias = await get('/api/reportes/ventas?desde=2026-11-23&hasta=2026-11-26', A);
    expect(dias.body.datos.periodos.map(p => [p.periodo, p.ventas])).toEqual([['2026-11-23', 0], ['2026-11-24', 2], ['2026-11-25', 1], ['2026-11-26', 0]]);
    const meses = await get('/api/reportes/ventas?desde=2026-11-01&hasta=2026-12-31&agrupar=mes', A);
    expect(meses.body.datos.periodos.map(p => [p.periodo, p.total])).toEqual([['2026-11', 22400], ['2026-12', 5800]]);
    const semanas = await get('/api/reportes/ventas?desde=2026-11-01&hasta=2026-12-31&agrupar=semana', A);
    expect(semanas.body.datos.periodos.map(p => p.periodo)).toEqual(['2026-S48', '2026-S49']);
    const anio = await get('/api/reportes/ventas?desde=2026-01-01&hasta=2026-12-31&agrupar=anio', A);
    expect(anio.body.datos.periodos).toEqual([expect.objectContaining({ periodo: '2026', ventas: 4 })]);
  });

  test('por sucursal (el dueño sin X-Sucursal ve todas), por cajero y por forma de pago (efectivo sin el cambio)', async () => {
    const res = await get('/api/reportes/ventas?desde=2026-11-24&hasta=2026-11-24');
    const d = res.body.datos;
    expect(d.sucursales.map(s => [s.sucursal.nombre, s.total])).toEqual([['Centro', 16600], ['Norte', 5800]]);
    expect(d.cajeros.map(c => [c.cajero.nombre, c.total])).toEqual([['Ana', 17400], ['Beto', 5000]]);
    expect(d.formasPago).toEqual([
      { metodo: 'efectivo', ventas: 2, monto: 20000 - 8400 + 5800 },
      { metodo: 'tarjeta', ventas: 1, monto: 5000 },
      { metodo: 'transferencia', ventas: 0, monto: 0 }
    ]);
  });

  test('público vs distribución (por tipo de cliente) y productos más vendidos', async () => {
    const d = (await get('/api/reportes/ventas?desde=2026-11-24&hasta=2026-11-25', A)).body.datos;
    expect(d.canales.map(c => [c.canal, c.total])).toEqual([['publico', 17400], ['distribucion', 5000]]);
    expect(d.productos.map(p => [p.sku, p.cantidad, p.total, p.margen])).toEqual([['X', 3, 17400, 6000], ['Y', 1500, 5000, 2000]]);
  });

  test('validaciones y rango máximo', async () => {
    expect((await get('/api/reportes/ventas?desde=24-11-2026', A)).status).toBe(400);
    expect((await get('/api/reportes/ventas?agrupar=hora', A)).status).toBe(400);
    expect((await get('/api/reportes/ventas?desde=2020-01-01&hasta=2026-12-31', A)).status).toBe(400);
  });
});

describe('Excel', () => {
  test('descarga un libro con resumen, agrupaciones y el detalle de ventas en pesos', async () => {
    const res = await get('/api/reportes/ventas.xlsx?desde=2026-11-24&hasta=2026-11-25', A).buffer(true).parse((r, cb) => {
      const partes = [];
      r.on('data', c => partes.push(c));
      r.on('end', () => cb(null, Buffer.concat(partes)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('ventas_2026-11-24_2026-11-25.xlsx');
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(res.body);
    expect(libro.worksheets.map(w => w.name)).toEqual(['Resumen', 'Por periodo', 'Por sucursal', 'Por cajero', 'Forma de pago', 'Público vs distribución', 'Productos', 'Ventas']);
    const resumen = libro.getWorksheet('Resumen');
    expect(resumen.getCell('B4').value).toBe(3); // ventas cobradas, sin formato de moneda
    expect(resumen.getCell('B4').numFmt || '').not.toContain('$');
    expect(resumen.getCell('B5').value).toBe(224); // total $224.00 (16600 + 5800 centavos)
    expect(resumen.getCell('B5').numFmt).toContain('$');
    const ventas = libro.getWorksheet('Ventas');
    expect(ventas.rowCount).toBe(1 + 4); // encabezado + 3 cobradas + 1 cancelada (el detalle las muestra todas)
    expect(ventas.getCell('A3').value).toBe('24/11/2026 22:00'); // hora de Tepic
    expect(ventas.getCell('K2').value).toBe(116); // efectivo neto: 200 − 84 de cambio
    const productos = libro.getWorksheet('Productos');
    expect(productos.getCell('C3').value).toBe(1.5); // granel en kg
  });
});

describe('dashboard', () => {
  test('hoy, últimos 7 días y alertas (cortes pendientes y con diferencia)', async () => {
    await Turno.create({ sucursal: A._id, caja: 1, cajero: cajero.usuario._id, cajeroNombre: 'X', estado: 'contado', apertura: { fecha: new Date(), fondo: 0 } });
    const res = await get('/api/reportes/dashboard', A);
    expect(res.status).toBe(200);
    expect(res.body.datos.ultimos7).toHaveLength(7);
    expect(res.body.datos.hoy).toEqual(expect.objectContaining({ ventas: expect.any(Number), total: expect.any(Number) }));
    expect(res.body.datos.alertas).toMatchObject({ cortesPendientes: 1, caducados: 0, recetasPendientes: 0, traspasosPorRecibir: 0 });
  });

  test('solo el dueño ve reportes', async () => {
    expect((await h.request(h.app).get('/api/reportes/dashboard').set(h.auth(cajero.token, A))).status).toBe(403);
  });
});

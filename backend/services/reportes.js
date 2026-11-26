// Dashboard y reportes de ventas. Todo en centavos; los días, semanas, meses y años son los de Tepic
// (America/Mazatlan), no los de UTC. Solo cuentan las ventas COBRADAS (las canceladas no).
//
//   base (sin IVA) = total − iva        margen = base − costo (costo de los lotes que salieron)
const Venta = require('../models/Venta');
const Sucursal = require('../models/Sucursal');
const Turno = require('../models/Turno');
const Receta = require('../models/Receta');
const Traspaso = require('../models/Traspaso');
const { matchAlcance, conAlcance } = require('../helpers/alcance');
const { ZONA, rangoDia, rangoDias, diaLocal } = require('../helpers/fechas');
const existencias = require('./existencias');
const cuentasPorPagar = require('./cuentasPorPagar');

const TIPOS_DISTRIBUCION = ['clinica', 'veterinaria', 'petshop', 'estetica'];
const FORMATOS = { dia: '%Y-%m-%d', semana: '%G-S%V', mes: '%Y-%m', anio: '%Y' };
const DIA_MS = 86400000;

const sumas = {
  ventas: { $sum: 1 },
  total: { $sum: '$total' },
  iva: { $sum: '$iva' },
  costo: { $sum: '$costo' },
  descuento: { $sum: '$descuento' }
};

// Agrega base, margen y ticket promedio a una fila de sumas
function conMargen(f) {
  const base = f.total - f.iva;
  return {
    ...f,
    base,
    margen: base - f.costo,
    margenPorcentaje: base > 0 ? Math.round(((base - f.costo) / base) * 1000) / 10 : 0, // 1 decimal, solo para mostrar
    ticketPromedio: f.ventas ? Math.round(f.total / f.ventas) : 0
  };
}

const vacio = () => conMargen({ ventas: 0, total: 0, iva: 0, costo: 0, descuento: 0 });

function rango({ desde, hasta } = {}) {
  const hoy = diaLocal();
  return rangoDias(desde || hoy, hasta || desde || hoy);
}

const matchVentas = (alcance, { inicio, fin }) => matchAlcance(alcance, { estado: 'cobrada', fecha: { $gte: inicio, $lt: fin } });

async function totales(alcance, r) {
  const [f] = await Venta.aggregate([matchVentas(alcance, r), { $group: { _id: null, ...sumas } }, { $unset: '_id' }]);
  return f ? conMargen(f) : vacio();
}

// Ventas por día / semana (ISO) / mes / año. Por día rellena los días sin ventas con ceros.
async function porPeriodo(alcance, r, agrupar = 'dia') {
  const filas = await Venta.aggregate([
    matchVentas(alcance, r),
    { $group: { _id: { $dateToString: { format: FORMATOS[agrupar], date: '$fecha', timezone: ZONA } }, ...sumas } },
    { $sort: { _id: 1 } }
  ]);
  const lista = filas.map(({ _id, ...f }) => ({ periodo: _id, ...conMargen(f) }));
  if (agrupar !== 'dia') return lista;
  const porDia = new Map(lista.map(f => [f.periodo, f]));
  const dias = [];
  for (let t = r.inicio.getTime(); t < r.fin.getTime(); t += DIA_MS) {
    const dia = diaLocal(new Date(t + 12 * 3600000)); // mediodía de ese día en Tepic
    dias.push(porDia.get(dia) || { periodo: dia, ...vacio() });
  }
  return dias;
}

async function porSucursal(alcance, r) {
  const filas = await Venta.aggregate([matchVentas(alcance, r), { $group: { _id: '$sucursal', ...sumas } }, { $sort: { total: -1 } }]);
  const nombres = new Map((await Sucursal.find({ _id: { $in: filas.map(f => f._id) } }).lean()).map(s => [String(s._id), s.nombre]));
  return filas.map(({ _id, ...f }) => ({ sucursal: { id: _id, nombre: nombres.get(String(_id)) || '—' }, ...conMargen(f) }));
}

async function porCajero(alcance, r) {
  const filas = await Venta.aggregate([
    matchVentas(alcance, r),
    { $group: { _id: { id: '$cajero', nombre: '$cajeroNombre' }, ...sumas } },
    { $sort: { total: -1 } }
  ]);
  return filas.map(({ _id, ...f }) => ({ cajero: _id, ...conMargen(f) }));
}

// Lo cobrado por forma de pago (el efectivo ya sin el cambio entregado). «credito» = lo que quedó a cuenta del cliente.
async function porFormaPago(alcance, r) {
  const [pagos, cambio] = await Promise.all([
    Venta.aggregate([matchVentas(alcance, r), { $unwind: '$pagos' }, { $group: { _id: '$pagos.metodo', monto: { $sum: '$pagos.monto' }, ventas: { $sum: 1 } } }]),
    Venta.aggregate([matchVentas(alcance, r), { $group: { _id: null, cambio: { $sum: '$cambio' } } }])
  ]);
  const porMetodo = Object.fromEntries(pagos.map(p => [p._id, p]));
  return ['efectivo', 'tarjeta', 'transferencia', 'credito'].map(metodo => ({
    metodo,
    ventas: porMetodo[metodo]?.ventas || 0,
    monto: (porMetodo[metodo]?.monto || 0) - (metodo === 'efectivo' ? cambio[0]?.cambio || 0 : 0)
  }));
}

// Público (incluye "Público en general" y empleados) vs distribución (clínicas, veterinarias, petshops, estéticas)
async function porCanal(alcance, r) {
  const filas = await Venta.aggregate([
    matchVentas(alcance, r),
    { $lookup: { from: 'clientes', localField: 'cliente', foreignField: '_id', as: 'c' } },
    { $set: { canal: { $cond: [{ $in: [{ $first: '$c.tipo' }, TIPOS_DISTRIBUCION] }, 'distribucion', 'publico'] } } },
    { $group: { _id: '$canal', ...sumas } }
  ]);
  const porCanalMap = Object.fromEntries(filas.map(({ _id, ...f }) => [_id, conMargen(f)]));
  return ['publico', 'distribucion'].map(canal => ({ canal, ...(porCanalMap[canal] || vacio()) }));
}

async function productosMasVendidos(alcance, r, limite = 20) {
  const filas = await Venta.aggregate([
    matchVentas(alcance, r),
    { $unwind: '$partidas' },
    {
      $group: {
        _id: '$partidas.producto',
        sku: { $first: '$partidas.sku' },
        nombre: { $first: '$partidas.nombre' },
        unidad: { $first: '$partidas.unidad' },
        cantidad: { $sum: '$partidas.cantidad' },
        total: { $sum: '$partidas.importe' },
        iva: { $sum: '$partidas.iva' },
        costo: { $sum: '$partidas.costo' },
        ventas: { $sum: 1 }
      }
    },
    { $sort: { total: -1 } },
    { $limit: limite }
  ]);
  return filas.map(({ _id, ...f }) => ({ producto: _id, ...conMargen({ ...f, descuento: 0 }) }));
}

async function resumen(alcance, { desde, hasta, agrupar = 'dia' } = {}) {
  const r = rango({ desde, hasta });
  const [t, periodos, sucursales, cajeros, formas, canales, productos] = await Promise.all([
    totales(alcance, r), porPeriodo(alcance, r, agrupar), porSucursal(alcance, r), porCajero(alcance, r),
    porFormaPago(alcance, r), porCanal(alcance, r), productosMasVendidos(alcance, r)
  ]);
  return { desde: desde || diaLocal(), hasta: hasta || desde || diaLocal(), agrupar, totales: t, periodos, sucursales, cajeros, formasPago: formas, canales, productos };
}

// Dashboard: hoy, últimos 7 días y alertas de la sucursal activa (o de todas, para el dueño sin X-Sucursal)
async function dashboard(alcance, ahora = new Date()) {
  const hoy = rangoDia(ahora);
  const hace7 = { inicio: new Date(hoy.inicio.getTime() - 6 * DIA_MS), fin: hoy.fin };
  const [deHoy, semana, filasExistencias, cortesPendientes, cortesConDiferencia, recetasPendientes, traspasosPorRecibir, porPagar] = await Promise.all([
    totales(alcance, hoy),
    porPeriodo(alcance, hace7, 'dia'),
    existencias.listar(alcance, { ahora }),
    Turno.countDocuments(conAlcance({ estado: 'contado' }, alcance)),
    Turno.countDocuments(conAlcance({ estado: 'cerrado', 'cierre.justificacion': { $exists: true }, 'cierre.fecha': { $gte: hace7.inicio } }, alcance)),
    Receta.countDocuments(conAlcance({ estado: 'pendiente' }, alcance)),
    Traspaso.countDocuments(conAlcance({ estado: 'en_transito' }, alcance, 'destino')),
    cuentasPorPagar.alertas(ahora)
  ]);
  const cuenta = alerta => filasExistencias.filter(f => f.alertas.includes(alerta)).length;
  return {
    hoy: deHoy,
    ultimos7: semana,
    alertas: {
      caducados: cuenta('caducado'),
      porCaducar: cuenta('por_caducar'),
      bajoMinimo: cuenta('bajo_minimo'),
      cortesPendientes,
      cortesConDiferencia,
      recetasPendientes,
      traspasosPorRecibir,
      ...porPagar
    }
  };
}

// Detalle de cada venta del rango (para el Excel del contador)
async function detalleVentas(alcance, { desde, hasta } = {}) {
  const r = rango({ desde, hasta });
  const lista = await Venta.find(matchAlcance(alcance, { fecha: { $gte: r.inicio, $lt: r.fin } }).$match).sort({ fecha: 1 }).lean();
  const nombres = new Map((await Sucursal.find({ _id: { $in: [...new Set(lista.map(v => String(v.sucursal)))] } }).lean()).map(s => [String(s._id), s.nombre]));
  return lista.map(v => ({ ...v, sucursalNombre: nombres.get(String(v.sucursal)) || '' }));
}

module.exports = { resumen, dashboard, detalleVentas, porPeriodo, rango, TIPOS_DISTRIBUCION };

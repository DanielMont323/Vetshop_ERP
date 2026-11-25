// Consulta de existencias por sucursal / producto / lote, con estado:
//   vigente, por caducar (≤ 30 días), caducado y bajo mínimo.
// "Existencia" = lo vendible (capas no caducadas). Lo caducado se informa aparte.
const mongoose = require('mongoose');
const InventoryLayer = require('../models/InventoryLayer');
const InventoryMovement = require('../models/InventoryMovement');
const Producto = require('../models/Producto');
const Sucursal = require('../models/Sucursal');
const Usuario = require('../models/Usuario');
const { conAlcance, matchAlcance } = require('../helpers/alcance');
const { rangoDia, rangoDias, diasParaCaducar, estaCaducado, diaLocal } = require('../helpers/fechas');
const { filtroBusqueda } = require('./productos');

const DIAS_POR_CADUCAR = 30;
const DIA_MS = 86400000;
const aId = id => new mongoose.Types.ObjectId(String(id));

// Límite (exclusivo) de "por caducar": fin del día dentro de 30 días en Tepic (UTC-7 fijo, sin horario de verano)
function limitePorCaducar(ahora) {
  return new Date(rangoDia(ahora).inicio.getTime() + (DIAS_POR_CADUCAR + 1) * DIA_MS);
}

function estadoLote(caducidad, ahora) {
  if (!caducidad) return 'sin_caducidad';
  if (estaCaducado(caducidad, ahora)) return 'caducado';
  return caducidad < limitePorCaducar(ahora) ? 'por_caducar' : 'vigente';
}

async function sucursalesDelAlcance(alcance) {
  if (alcance.sucursalActiva) return Sucursal.find({ _id: alcance.sucursalActiva }).lean();
  const filtro = alcance.permitidas === 'todas' ? { activa: true } : { _id: { $in: alcance.permitidas } };
  return Sucursal.find(filtro).lean();
}

/**
 * Existencias por sucursal y producto.
 * Filtros: q (nombre, SKU o código), categoria, estado ('caducado' | 'por_caducar' | 'bajo_minimo' | 'sin_existencia').
 * Incluye los productos SIN existencia que tienen mínimo en la sucursal (para la alerta de bajo mínimo).
 */
async function listar(alcance, { q, categoria, estado, ahora = new Date() } = {}) {
  const filtroProductos = filtroBusqueda({ q, categoria });
  const productos = await Producto.find(filtroProductos).lean();
  const porId = new Map(productos.map(p => [String(p._id), p]));
  const sucursales = await sucursalesDelAlcance(alcance);
  const sucursalPorId = new Map(sucursales.map(s => [String(s._id), s]));
  const limite = limitePorCaducar(ahora);

  const filas = await InventoryLayer.aggregate([
    matchAlcance(alcance, { agotada: false, producto: { $in: productos.map(p => p._id) } }),
    {
      $group: {
        _id: { sucursal: '$sucursal', producto: '$producto' },
        total: { $sum: '$cantidadRestante' },
        caducado: { $sum: { $cond: [{ $and: [{ $ne: ['$caducidad', null] }, { $lt: ['$caducidad', ahora] }] }, '$cantidadRestante', 0] } },
        porCaducar: {
          $sum: { $cond: [{ $and: [{ $ne: ['$caducidad', null] }, { $gte: ['$caducidad', ahora] }, { $lt: ['$caducidad', limite] }] }, '$cantidadRestante', 0] }
        },
        proximaCaducidad: { $min: { $cond: [{ $and: [{ $ne: ['$caducidad', null] }, { $gte: ['$caducidad', ahora] }] }, '$caducidad', null] } },
        lotes: { $sum: 1 }
      }
    }
  ]);

  const clave = (s, p) => `${s}:${p}`;
  const vistos = new Set(filas.map(f => clave(f._id.sucursal, f._id.producto)));
  // Productos sin capas pero con mínimo en alguna sucursal del alcance → existencia 0
  for (const p of productos) {
    if (!p.activo) continue;
    for (const m of p.minimos || []) {
      if (m.cantidad > 0 && sucursalPorId.has(String(m.sucursal)) && !vistos.has(clave(m.sucursal, p._id))) {
        filas.push({ _id: { sucursal: m.sucursal, producto: p._id }, total: 0, caducado: 0, porCaducar: 0, proximaCaducidad: null, lotes: 0 });
      }
    }
  }

  const resultado = [];
  for (const f of filas) {
    const p = porId.get(String(f._id.producto));
    const s = sucursalPorId.get(String(f._id.sucursal));
    if (!p || !s) continue;
    const existencia = f.total - f.caducado;
    const minimo = (p.minimos || []).find(m => String(m.sucursal) === String(s._id))?.cantidad || 0;
    const alertas = [];
    if (f.caducado > 0) alertas.push('caducado');
    if (f.porCaducar > 0) alertas.push('por_caducar');
    if (minimo > 0 && existencia < minimo) alertas.push('bajo_minimo');
    if (existencia === 0) alertas.push('sin_existencia');
    if (estado && !alertas.includes(estado)) continue;
    resultado.push({
      sucursal: { id: s._id, nombre: s.nombre },
      producto: { id: p._id, sku: p.sku, nombre: p.nombre, unidad: p.unidad, categoria: p.categoria, requiereRefrigeracion: p.requiereRefrigeracion },
      existencia,
      caducado: f.caducado,
      porCaducar: f.porCaducar,
      minimo,
      proximaCaducidad: f.proximaCaducidad,
      lotes: f.lotes,
      alertas
    });
  }
  return resultado.sort((a, b) => a.producto.nombre.localeCompare(b.producto.nombre, 'es') || a.sucursal.nombre.localeCompare(b.sucursal.nombre, 'es'));
}

// Lotes con existencia de un producto, en orden FEFO, con su estado. El costo solo si verCostos.
async function lotes(alcance, productoId, { verCostos = false, ahora = new Date() } = {}) {
  const capas = await InventoryLayer.find(conAlcance({ producto: aId(productoId), agotada: false }, alcance))
    .sort({ sucursal: 1, ordenFefo: 1, _id: 1 }).lean();
  const nombres = new Map((await Sucursal.find({ _id: { $in: [...new Set(capas.map(c => String(c.sucursal)))] } }).lean()).map(s => [String(s._id), s.nombre]));
  return capas.map(c => ({
    id: c._id,
    sucursal: { id: c.sucursal, nombre: nombres.get(String(c.sucursal)) },
    lote: c.lote || null,
    caducidad: c.caducidad,
    estado: estadoLote(c.caducidad, ahora),
    diasParaCaducar: c.caducidad ? diasParaCaducar(c.caducidad, ahora) : null,
    cantidad: c.cantidadRestante,
    cantidadInicial: c.cantidadInicial,
    fechaEntrada: c.fechaEntrada,
    origen: c.origen,
    ...(verCostos && { costoUnitario: c.costoUnitario })
  }));
}

// Kárdex: movimientos de un producto (o de todos) en el alcance, del más reciente al más antiguo.
async function movimientos(alcance, { producto, desde, hasta, pagina = 1, limite = 50, verCostos = false } = {}) {
  const filtro = {};
  if (producto) filtro.producto = aId(producto);
  if (desde || hasta) {
    const { inicio, fin } = rangoDias(desde || '2000-01-01', hasta || diaLocal());
    filtro.fecha = { $gte: inicio, $lt: fin };
  }
  const consulta = conAlcance(filtro, alcance);
  const [lista, total] = await Promise.all([
    InventoryMovement.find(consulta).sort({ fecha: -1, _id: -1 }).skip((pagina - 1) * limite).limit(limite).lean(),
    InventoryMovement.countDocuments(consulta)
  ]);
  const ids = [...new Set(lista.flatMap(m => [m.usuario, m.autorizadoPor].filter(Boolean).map(String)))];
  const usuarios = new Map((await Usuario.find({ _id: { $in: ids } }).select('nombre').lean()).map(u => [String(u._id), u.nombre]));
  const productos = new Map((await Producto.find({ _id: { $in: [...new Set(lista.map(m => String(m.producto)))] } }).select('nombre unidad').lean()).map(p => [String(p._id), p]));
  return {
    datos: lista.map(m => ({
      id: m._id,
      fecha: m.fecha,
      tipo: m.tipo,
      producto: { id: m.producto, nombre: productos.get(String(m.producto))?.nombre, unidad: productos.get(String(m.producto))?.unidad },
      sucursal: m.sucursal,
      cantidad: m.cantidad,
      lotes: m.capas.map(c => ({ lote: c.lote || null, caducidad: c.caducidad, cantidad: c.cantidad })),
      motivo: m.motivo || null,
      nota: m.nota || null,
      referencia: m.referencia?.modelo ? m.referencia : null,
      usuario: usuarios.get(String(m.usuario)) || null,
      autorizadoPor: m.autorizadoPor ? usuarios.get(String(m.autorizadoPor)) || null : null,
      ...(verCostos && { costoTotal: m.costoTotal })
    })),
    total,
    pagina,
    limite
  };
}

module.exports = { listar, lotes, movimientos, estadoLote, DIAS_POR_CADUCAR };

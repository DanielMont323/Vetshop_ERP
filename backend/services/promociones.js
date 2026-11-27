// Promociones (dueño): alta, edición, activar/desactivar, y las vigentes para la caja.
const mongoose = require('mongoose');
const Promocion = require('../models/Promocion');
const Producto = require('../models/Producto');
const Sucursal = require('../models/Sucursal');
const { conTransaccion } = require('../helpers/transaccion');
const { solicitudInvalida, noEncontrado } = require('../helpers/errores');
const { rangoDias, diaLocal } = require('../helpers/fechas');
const auditoria = require('./auditoria');

const aId = id => new mongoose.Types.ObjectId(String(id));
const DIA_MS = 86400000;

const publica = (p, productos = new Map()) => {
  const prod = p.producto ? productos.get(String(p.producto)) : null;
  return {
    id: p._id,
    nombre: p.nombre,
    tipo: p.tipo,
    valor: p.valor,
    alcance: p.alcance,
    producto: prod ? { id: prod._id, sku: prod.sku, nombre: prod.nombre } : p.producto || null,
    categoria: p.categoria || null,
    lote: p.lote || null,
    sucursales: p.sucursales || [],
    // Días de Tepic (hasta es inclusivo para quien lo lee)
    desde: diaLocal(p.desde),
    hasta: diaLocal(new Date(p.hasta.getTime() - 1)),
    activa: p.activa,
    vigente: p.activa && p.desde <= new Date() && new Date() < p.hasta
  };
};

async function conProductos(lista) {
  const ids = [...new Set(lista.filter(p => p.producto).map(p => String(p.producto)))].map(aId);
  const productos = await Producto.find({ _id: { $in: ids } }, { sku: 1, nombre: 1 }).lean();
  const mapa = new Map(productos.map(p => [String(p._id), p]));
  return lista.map(p => publica(p, mapa));
}

async function listar({ estado } = {}) {
  const ahora = new Date();
  const filtro = {};
  if (estado === 'vigentes') Object.assign(filtro, { activa: true, desde: { $lte: ahora }, hasta: { $gt: ahora } });
  if (estado === 'proximas') Object.assign(filtro, { activa: true, desde: { $gt: ahora } });
  if (estado === 'terminadas') filtro.$or = [{ activa: false }, { hasta: { $lte: ahora } }];
  const lista = await Promocion.find(filtro).sort({ hasta: -1, createdAt: -1 }).limit(300).lean();
  return conProductos(lista);
}

// 'AAAA-MM-DD' (días de Tepic, ambos inclusive) → [inicio, fin) en UTC
function vigencia(desde, hasta) {
  const { inicio, fin } = rangoDias(desde, hasta);
  if (fin <= inicio) throw solicitudInvalida('La fecha final debe ser igual o posterior a la inicial');
  if ((fin - inicio) / DIA_MS > 366) throw solicitudInvalida('Una promoción dura como máximo un año');
  return { desde: inicio, hasta: fin };
}

async function validarReferencias(datos, session) {
  if (datos.producto && !(await Producto.exists({ _id: aId(datos.producto) }).session(session))) throw noEncontrado('Producto no encontrado');
  if (datos.sucursales?.length) {
    const n = await Sucursal.countDocuments({ _id: { $in: datos.sucursales.map(aId) } }).session(session);
    if (n !== new Set(datos.sucursales.map(String)).size) throw solicitudInvalida('Alguna sucursal no existe');
  }
}

async function guardar(doc, session) {
  try {
    await doc.save({ session });
  } catch (error) {
    if (error.name === 'ValidationError') throw solicitudInvalida(Object.values(error.errors)[0].message);
    throw error;
  }
}

async function crear(datos, actor) {
  return conTransaccion(async session => {
    await validarReferencias(datos, session);
    const doc = new Promocion({
      nombre: datos.nombre, tipo: datos.tipo, valor: datos.valor, alcance: datos.alcance,
      producto: datos.producto, categoria: datos.categoria, lote: datos.lote, sucursales: datos.sucursales || [],
      ...vigencia(datos.desde, datos.hasta), creadoPor: actor._id
    });
    await guardar(doc, session);
    const [despues] = await conProductos([doc.toObject()]);
    await auditoria.registrar({ usuario: actor._id, accion: 'promocion.crear', entidad: 'Promocion', entidadId: doc._id, despues }, session);
    return despues;
  });
}

const EDITABLES = ['nombre', 'valor', 'activa', 'sucursales'];

async function actualizar(id, cambios, actor) {
  return conTransaccion(async session => {
    const doc = await Promocion.findById(aId(id)).session(session);
    if (!doc) throw noEncontrado('Promoción no encontrada');
    const [antes] = await conProductos([doc.toObject()]);
    await validarReferencias(cambios, session);
    for (const c of EDITABLES) if (cambios[c] !== undefined) doc[c] = cambios[c];
    if (cambios.desde !== undefined || cambios.hasta !== undefined) {
      Object.assign(doc, vigencia(cambios.desde ?? antes.desde, cambios.hasta ?? antes.hasta));
    }
    await guardar(doc, session);
    const [despues] = await conProductos([doc.toObject()]);
    await auditoria.registrar({ usuario: actor._id, accion: 'promocion.actualizar', entidad: 'Promocion', entidadId: doc._id, antes, despues }, session);
    return despues;
  });
}

// Map(productoId → promociones vigentes que le aplican en la sucursal)
async function vigentesPara(productos, sucursal, fecha = new Date(), session) {
  const mapa = new Map(productos.map(p => [String(p._id), []]));
  if (productos.length === 0) return mapa;
  const promos = await Promocion.find({
    activa: true,
    desde: { $lte: fecha },
    hasta: { $gt: fecha },
    $and: [
      { $or: [{ producto: { $in: productos.map(p => p._id) } }, { categoria: { $in: [...new Set(productos.map(p => p.categoria))] } }] },
      { $or: [{ sucursales: { $size: 0 } }, { sucursales: aId(sucursal) }] }
    ]
  }).session(session || null).lean();
  for (const p of productos) {
    mapa.get(String(p._id)).push(...promos.filter(x => (x.producto ? x.producto.equals(p._id) : x.categoria === p.categoria)));
  }
  return mapa;
}

module.exports = { listar, crear, actualizar, vigentesPara };

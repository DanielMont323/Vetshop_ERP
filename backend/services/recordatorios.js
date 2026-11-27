// Recordatorios por WhatsApp (por enlace wa.me: la caja abre el chat con el texto y lo marca «avisado»).
//
//   hoy:       pendientes cuyo día de aviso ya llegó (incluye los atrasados)
//   proximos:  pendientes de los próximos 30 días
//   avisados:  ya avisados, pendientes de «hecho»
// «Hecho» en un recordatorio que se repite programa el siguiente desde hoy (p. ej. alimento en 30 días).
// Un recordatorio de alimento por producto no se duplica: si ya hay uno abierto del mismo cliente y producto, se reprograma.
const mongoose = require('mongoose');
const Recordatorio = require('../models/Recordatorio');
const Cliente = require('../models/Cliente');
const Mascota = require('../models/Mascota');
const Producto = require('../models/Producto');
const { conAlcance, sucursalDeEscritura } = require('../helpers/alcance');
const { solicitudInvalida, noEncontrado, conflicto } = require('../helpers/errores');
const { diaLocal } = require('../helpers/fechas');
const auditoria = require('./auditoria');

const aId = id => new mongoose.Types.ObjectId(String(id));
const DIAS_ANTES = { cita: 5, alimento: 3, desparasitante: 3, vacuna: 5, medicamento: 2, otro: 1 };
const ABIERTOS = ['pendiente', 'avisado'];

// Suma días a un 'AAAA-MM-DD' (aritmética de calendario, sin zonas)
function sumarDias(ymd, dias) {
  const [a, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

function publico(r, refs = {}) {
  const cliente = refs.clientes?.get(String(r.cliente));
  const mascota = r.mascota ? refs.mascotas?.get(String(r.mascota)) : null;
  return {
    id: r._id, sucursal: r.sucursal, tipo: r.tipo, descripcion: r.descripcion, fecha: r.fecha, diasAntes: r.diasAntes,
    fechaAviso: r.fechaAviso, repetirCadaDias: r.repetirCadaDias || null, estado: r.estado, producto: r.producto || null,
    avisadoEn: r.avisadoEn || null,
    cliente: cliente ? { id: cliente._id, nombre: cliente.nombre, whatsapp: cliente.whatsapp || '', telefono: cliente.telefono || '' } : { id: r.cliente },
    mascota: mascota ? { id: mascota._id, nombre: mascota.nombre, especie: mascota.especie } : null
  };
}

async function conReferencias(lista) {
  const ids = campo => [...new Set(lista.filter(r => r[campo]).map(r => String(r[campo])))].map(aId);
  const [clientes, mascotas] = await Promise.all([
    Cliente.find({ _id: { $in: ids('cliente') } }, { nombre: 1, whatsapp: 1, telefono: 1 }).lean(),
    Mascota.find({ _id: { $in: ids('mascota') } }, { nombre: 1, especie: 1 }).lean()
  ]);
  const refs = { clientes: new Map(clientes.map(c => [String(c._id), c])), mascotas: new Map(mascotas.map(m => [String(m._id), m])) };
  return lista.map(r => publico(r, refs));
}

async function listar(alcance, { vista = 'hoy', cliente } = {}) {
  const hoy = diaLocal();
  const filtro = {};
  if (cliente) filtro.cliente = aId(cliente);
  if (vista === 'hoy') Object.assign(filtro, { estado: 'pendiente', fechaAviso: { $lte: hoy } });
  else if (vista === 'proximos') Object.assign(filtro, { estado: 'pendiente', fechaAviso: { $gt: hoy, $lte: sumarDias(hoy, 30) } });
  else if (vista === 'avisados') filtro.estado = 'avisado';
  else if (vista === 'abiertos') filtro.estado = { $in: ABIERTOS };
  const orden = vista === 'avisados' ? { avisadoEn: -1 } : { fechaAviso: 1, fecha: 1 };
  const lista = await Recordatorio.find(conAlcance(filtro, alcance)).sort(orden).limit(500).lean();
  return conReferencias(lista);
}

async function validarRelaciones({ cliente, mascota, producto }) {
  const c = await Cliente.findById(aId(cliente)).lean();
  if (!c) throw noEncontrado('Cliente no encontrado');
  if (c.esPublicoGeneral) throw solicitudInvalida('Registra primero al cliente para programarle recordatorios');
  if (mascota) {
    const m = await Mascota.findById(aId(mascota)).lean();
    if (!m || !m.cliente.equals(c._id)) throw solicitudInvalida('La mascota no es de ese cliente');
  }
  if (producto && !(await Producto.exists({ _id: aId(producto) }))) throw noEncontrado('Producto no encontrado');
  return c;
}

async function guardar(doc) {
  try {
    await doc.save();
  } catch (error) {
    if (error.name === 'ValidationError') throw solicitudInvalida(Object.values(error.errors)[0].message);
    throw error;
  }
}

function aplicarFechas(doc, { fecha, diasAntes }) {
  if (fecha !== undefined) doc.fecha = fecha;
  if (diasAntes !== undefined) doc.diasAntes = diasAntes;
  if (doc.diasAntes === undefined || doc.diasAntes === null) doc.diasAntes = DIAS_ANTES[doc.tipo];
  diaLocalValido(doc.fecha);
  doc.fechaAviso = sumarDias(doc.fecha, -doc.diasAntes);
}

function diaLocalValido(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '') || sumarDias(ymd, 0) !== ymd) throw solicitudInvalida('Fecha inválida (AAAA-MM-DD)');
}

async function crear(alcance, actor, datos) {
  const sucursal = sucursalDeEscritura(alcance);
  await validarRelaciones(datos);
  // Alimento del mismo producto: se reprograma el que ya estaba abierto
  let doc = null;
  if (datos.tipo === 'alimento' && datos.producto) {
    doc = await Recordatorio.findOne({ sucursal, cliente: aId(datos.cliente), producto: aId(datos.producto), tipo: 'alimento', estado: { $in: ABIERTOS } });
  }
  const reprogramado = Boolean(doc);
  if (!doc) doc = new Recordatorio({ sucursal, cliente: datos.cliente, tipo: datos.tipo, producto: datos.producto, creadoPor: actor._id });
  Object.assign(doc, {
    descripcion: datos.descripcion, estado: 'pendiente', avisadoEn: undefined, avisadoPor: undefined,
    ...(datos.mascota !== undefined && { mascota: datos.mascota || undefined }),
    ...(datos.repetirCadaDias !== undefined && { repetirCadaDias: datos.repetirCadaDias || undefined })
  });
  aplicarFechas(doc, datos);
  await guardar(doc);
  await auditoria.registrar({ usuario: actor._id, accion: reprogramado ? 'recordatorio.reprogramar' : 'recordatorio.crear', entidad: 'Recordatorio', entidadId: doc._id, sucursal, despues: { tipo: doc.tipo, fecha: doc.fecha, descripcion: doc.descripcion } });
  const [r] = await conReferencias([doc.toObject()]);
  return { ...r, reprogramado };
}

async function cargar(alcance, id) {
  const doc = await Recordatorio.findOne(conAlcance({ _id: aId(id) }, alcance));
  if (!doc) throw noEncontrado('Recordatorio no encontrado');
  return doc;
}

async function actualizar(alcance, actor, id, cambios) {
  const doc = await cargar(alcance, id);
  if (!ABIERTOS.includes(doc.estado)) throw conflicto('El recordatorio ya está cerrado', 'RECORDATORIO_CERRADO');
  if (cambios.mascota !== undefined || cambios.producto !== undefined) {
    await validarRelaciones({ cliente: doc.cliente, mascota: cambios.mascota, producto: cambios.producto });
  }
  for (const c of ['descripcion', 'mascota', 'repetirCadaDias']) if (cambios[c] !== undefined) doc[c] = cambios[c] || undefined;
  if (cambios.fecha !== undefined || cambios.diasAntes !== undefined) {
    aplicarFechas(doc, cambios);
    doc.estado = 'pendiente'; // con otra fecha se vuelve a avisar
  }
  await guardar(doc);
  const [r] = await conReferencias([doc.toObject()]);
  return r;
}

async function marcarAvisado(alcance, actor, id) {
  const doc = await Recordatorio.findOneAndUpdate(
    conAlcance({ _id: aId(id), estado: 'pendiente' }, alcance),
    { $set: { estado: 'avisado', avisadoEn: new Date(), avisadoPor: actor._id } },
    { new: true }
  ).lean();
  if (!doc) throw conflicto('El recordatorio ya no está pendiente', 'RECORDATORIO_CERRADO');
  const [r] = await conReferencias([doc]);
  return r;
}

// Hecho (el cliente ya compró / ya fue a su cita). Si se repite, programa el siguiente desde hoy.
async function terminar(alcance, actor, id, { cancelar = false } = {}) {
  const doc = await cargar(alcance, id);
  if (!ABIERTOS.includes(doc.estado)) throw conflicto('El recordatorio ya está cerrado', 'RECORDATORIO_CERRADO');
  doc.estado = cancelar ? 'cancelado' : 'hecho';
  doc.terminadoEn = new Date();
  let siguiente = null;
  if (!cancelar && doc.repetirCadaDias) {
    siguiente = new Recordatorio({
      sucursal: doc.sucursal, cliente: doc.cliente, mascota: doc.mascota, tipo: doc.tipo, descripcion: doc.descripcion,
      producto: doc.producto, repetirCadaDias: doc.repetirCadaDias, diasAntes: doc.diasAntes, creadoPor: actor._id
    });
    aplicarFechas(siguiente, { fecha: sumarDias(diaLocal(), doc.repetirCadaDias) });
    await guardar(siguiente);
    doc.siguiente = siguiente._id;
  }
  await guardar(doc);
  await auditoria.registrar({ usuario: actor._id, accion: cancelar ? 'recordatorio.cancelar' : 'recordatorio.hecho', entidad: 'Recordatorio', entidadId: doc._id, sucursal: doc.sucursal });
  const lista = await conReferencias([doc.toObject(), ...(siguiente ? [siguiente.toObject()] : [])]);
  return { ...lista[0], siguiente: lista[1] || null };
}

module.exports = { listar, crear, actualizar, marcarAvisado, terminar, sumarDias, DIAS_ANTES };

// Recetas: captura, validación por el médico responsable (con su PIN), archivo, historial,
// y el surtido desde la caja (cantidad entregada ≤ prescrita, con los lotes entregados).
const mongoose = require('mongoose');
const Receta = require('../models/Receta');
const Producto = require('../models/Producto');
const { siguienteFolio } = require('../models/Contador');
const { conTransaccion } = require('../helpers/transaccion');
const { conAlcance, sucursalDeEscritura } = require('../helpers/alcance');
const { solicitudInvalida, noEncontrado, conflicto, sinPermiso, ErrorApp } = require('../helpers/errores');
const { deHoraLocal, diaLocal, rangoDias } = require('../helpers/fechas');
const { escaparRegex } = require('../helpers/texto');
const { baseATexto } = require('../helpers/cantidades');
const { verificarPin } = require('./autorizaciones');
const almacenamiento = require('./almacenamiento');
const auditoria = require('./auditoria');

const SERIE_RECETA = 'R';
const aId = id => new mongoose.Types.ObjectId(String(id));
const filtroEscritura = (alcance, filtro) => conAlcance(filtro, { ...alcance, sucursalActiva: sucursalDeEscritura(alcance) });

function fechaDeReceta(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) throw solicitudInvalida('La fecha de la receta debe ser AAAA-MM-DD');
  if (ymd > diaLocal()) throw solicitudInvalida('La fecha de la receta no puede ser futura');
  return deHoraLocal(Number(m[1]), Number(m[2]), Number(m[3]));
}

async function armar(datos, session) {
  const ids = [...new Set(datos.partidas.map(p => String(p.producto)))].map(aId);
  const productos = new Map((await Producto.find({ _id: { $in: ids } }).session(session).lean()).map(p => [String(p._id), p]));
  const partidas = datos.partidas.map((p, i) => {
    const producto = productos.get(String(p.producto));
    if (!producto) throw solicitudInvalida(`Medicamento ${i + 1}: producto no encontrado`);
    if (!producto.requiereReceta) throw solicitudInvalida(`${producto.nombre} no requiere receta`);
    if (!Number.isSafeInteger(p.cantidadPrescrita) || p.cantidadPrescrita <= 0) throw solicitudInvalida(`${producto.nombre}: cantidad prescrita inválida`);
    return {
      producto: producto._id, sku: producto.sku, nombre: producto.nombre, unidad: producto.unidad,
      esControlado: producto.esControlado, cantidadPrescrita: p.cantidadPrescrita, indicaciones: p.indicaciones
    };
  });
  return {
    fechaReceta: fechaDeReceta(datos.fechaReceta),
    medico: datos.medico,
    propietario: datos.propietario,
    paciente: datos.paciente,
    partidas,
    observaciones: datos.observaciones
  };
}

const publica = r => ({
  id: r._id,
  sucursal: r.sucursal,
  folio: r.folio,
  fechaReceta: r.fechaReceta,
  medico: r.medico,
  propietario: r.propietario,
  paciente: r.paciente,
  partidas: r.partidas.map(p => ({ ...p, pendiente: p.cantidadPrescrita - p.cantidadEntregada })),
  archivo: r.archivo?.clave ? { nombre: r.archivo.nombre, tipo: r.archivo.tipo, tamano: r.archivo.tamano } : null,
  observaciones: r.observaciones || '',
  estado: r.estado,
  validadaPor: r.validadaPorNombre || null,
  fechaValidacion: r.fechaValidacion || null,
  creada: r.createdAt
});

async function crear(alcance, actor, datos) {
  const sucursal = sucursalDeEscritura(alcance);
  return conTransaccion(async session => {
    const folio = await siguienteFolio(sucursal, SERIE_RECETA, session);
    const [receta] = await Receta.create([{ ...(await armar(datos, session)), sucursal, folio, usuario: actor._id }], { session });
    return publica(receta.toObject());
  });
}

async function actualizar(alcance, actor, id, datos) {
  return conTransaccion(async session => {
    const receta = await Receta.findOne(filtroEscritura(alcance, { _id: aId(id) })).session(session);
    if (!receta) throw noEncontrado('Receta no encontrada');
    if (receta.estado !== 'pendiente') throw conflicto('Solo se modifica una receta pendiente de validar', 'RECETA_NO_EDITABLE');
    receta.set(await armar(datos, session));
    await receta.save({ session });
    return publica(receta.toObject());
  });
}

async function obtener(alcance, id) {
  const r = await Receta.findOne(conAlcance({ _id: aId(id) }, alcance)).lean();
  if (!r) throw noEncontrado('Receta no encontrada');
  return publica(r);
}

// Historial filtrable: estado, rango de fechas de captura, producto, texto (médico, cédula, propietario, paciente)
async function listar(alcance, { estado, desde, hasta, producto, q, pagina = 1, limite = 50 } = {}) {
  const filtro = {};
  if (estado) filtro.estado = estado;
  if (producto) filtro['partidas.producto'] = aId(producto);
  if (desde || hasta) {
    const { inicio, fin } = rangoDias(desde || '2000-01-01', hasta || diaLocal());
    filtro.createdAt = { $gte: inicio, $lt: fin };
  }
  if (q && q.trim()) {
    const re = { $regex: escaparRegex(q.trim()), $options: 'i' };
    filtro.$or = [{ 'medico.nombre': re }, { 'medico.cedula': re }, { 'propietario.nombre': re }, { 'paciente.nombre': re }];
  }
  const consulta = conAlcance(filtro, alcance);
  const [lista, total] = await Promise.all([
    Receta.find(consulta).sort({ createdAt: -1, _id: -1 }).skip((pagina - 1) * limite).limit(limite).lean(),
    Receta.countDocuments(consulta)
  ]);
  return { datos: lista.map(publica), total, pagina, limite };
}

// Recetas validadas de la sucursal activa con cantidad pendiente de ese producto (para la caja)
async function disponibles(alcance, productoId) {
  const producto = aId(productoId);
  const lista = await Receta.find(filtroEscritura(alcance, { estado: 'validada', 'partidas.producto': producto }))
    .sort({ fechaValidacion: -1 }).limit(50).lean();
  return lista
    .map(publica)
    .map(r => ({ ...r, partida: r.partidas.find(p => p.producto.equals(producto)) }))
    .filter(r => r.partida.pendiente > 0);
}

// Validación: SOLO el médico responsable, con su PIN. Un controlado exige el archivo de la receta.
async function validar(alcance, actor, id, autorizacion) {
  const sucursal = sucursalDeEscritura(alcance);
  const medico = await verificarPin({ ...autorizacion, permiso: 'recetas:validar', sucursal });
  if (medico.rol !== 'medico_responsable') throw sinPermiso('Las recetas las valida el médico responsable');
  return conTransaccion(async session => {
    const receta = await Receta.findOne(filtroEscritura(alcance, { _id: aId(id) })).session(session);
    if (!receta) throw noEncontrado('Receta no encontrada');
    if (receta.estado !== 'pendiente') throw conflicto(`La receta ya está ${receta.estado}`, 'RECETA_NO_EDITABLE');
    if (receta.partidas.some(p => p.esControlado) && !receta.archivo?.clave) {
      throw conflicto('Incluye un medicamento controlado: adjunta la foto o escaneo de la receta antes de validarla', 'ARCHIVO_REQUERIDO');
    }
    receta.estado = 'validada';
    receta.validadaPor = medico.id;
    receta.validadaPorNombre = medico.nombre;
    receta.fechaValidacion = new Date();
    await receta.save({ session });
    await auditoria.registrar(
      { usuario: actor._id, autorizadoPor: medico.id, accion: 'receta.validar', entidad: 'Receta', entidadId: receta._id, sucursal, despues: { folio: receta.folio, medicamentos: receta.partidas.map(p => p.sku) } },
      session
    );
    return publica(receta.toObject());
  });
}

async function cancelar(alcance, actor, id, motivo) {
  return conTransaccion(async session => {
    const receta = await Receta.findOne(filtroEscritura(alcance, { _id: aId(id) })).session(session);
    if (!receta) throw noEncontrado('Receta no encontrada');
    if (!['pendiente', 'validada'].includes(receta.estado)) throw conflicto(`La receta ya está ${receta.estado}`, 'RECETA_NO_EDITABLE');
    if (receta.partidas.some(p => p.cantidadEntregada > 0)) throw conflicto('La receta ya se surtió en parte; cancela primero esas ventas', 'RECETA_CON_ENTREGAS');
    receta.estado = 'cancelada';
    receta.canceladaPor = actor._id;
    receta.motivoCancelacion = motivo;
    await receta.save({ session });
    await auditoria.registrar({ usuario: actor._id, accion: 'receta.cancelar', entidad: 'Receta', entidadId: receta._id, sucursal: receta.sucursal, motivo }, session);
    return publica(receta.toObject());
  });
}

async function subirArchivo(alcance, actor, id, buffer, { tipo, nombre }) {
  const receta = await Receta.findOne(filtroEscritura(alcance, { _id: aId(id) })).lean();
  if (!receta) throw noEncontrado('Receta no encontrada');
  if (!['pendiente', 'validada'].includes(receta.estado)) throw conflicto(`La receta ya está ${receta.estado}`, 'RECETA_NO_EDITABLE');
  const archivo = await almacenamiento.guardar(buffer, { tipo, nombre });
  await Receta.updateOne({ _id: receta._id, sucursal: receta.sucursal }, { $set: { archivo } });
  return { nombre: archivo.nombre, tipo: archivo.tipo, tamano: archivo.tamano };
}

async function leerArchivo(alcance, id) {
  const receta = await Receta.findOne(conAlcance({ _id: aId(id) }, alcance)).lean();
  if (!receta) throw noEncontrado('Receta no encontrada');
  if (!receta.archivo?.clave) throw noEncontrado('La receta no tiene archivo');
  return { buffer: await almacenamiento.leer(receta.archivo.clave), tipo: receta.archivo.tipo, nombre: receta.archivo.nombre };
}

/**
 * Surtido desde una venta (dentro de su transacción).
 * @param entregas [{ receta, producto, cantidad, lotes: [{lote, caducidad, cantidad}] }]
 */
async function surtirEnVenta({ sucursal, venta, entregas, fecha }, session) {
  const porReceta = new Map();
  for (const e of entregas) {
    const clave = String(e.receta);
    if (!porReceta.has(clave)) porReceta.set(clave, []);
    porReceta.get(clave).push(e);
  }
  for (const [recetaId, lista] of porReceta) {
    const receta = await Receta.findOne({ _id: aId(recetaId), sucursal }).session(session);
    if (!receta) throw noEncontrado('La receta indicada no existe en esta sucursal');
    if (receta.estado !== 'validada') {
      throw new ErrorApp(409, `La receta R-${receta.folio} está ${receta.estado}; solo se surte una receta validada`, 'RECETA_NO_VALIDA');
    }
    for (const e of lista) {
      const partida = receta.partidas.find(p => p.producto.equals(e.producto));
      if (!partida) throw new ErrorApp(409, `La receta R-${receta.folio} no incluye ese medicamento`, 'RECETA_NO_INCLUYE');
      const pendiente = partida.cantidadPrescrita - partida.cantidadEntregada;
      if (e.cantidad > pendiente) {
        throw new ErrorApp(409, `${partida.nombre}: la receta R-${receta.folio} solo permite surtir ${baseATexto(pendiente, partida.unidad)} más`, 'RECETA_EXCEDIDA');
      }
      partida.cantidadEntregada += e.cantidad;
      partida.entregas.push({ venta: venta.id, folio: venta.folio, cantidad: e.cantidad, lotes: e.lotes, fecha });
    }
    if (receta.partidas.every(p => p.cantidadEntregada === p.cantidadPrescrita)) receta.estado = 'surtida';
    await receta.save({ session });
  }
}

// Cancelación de venta: quita sus entregas de las recetas y las deja otra vez validadas
async function revertirEnVenta({ sucursal, ventaId }, session) {
  const venta = aId(ventaId);
  const recetas = await Receta.find({ sucursal, 'partidas.entregas.venta': venta }).session(session);
  for (const receta of recetas) {
    for (const partida of receta.partidas) {
      const deEstaVenta = partida.entregas.filter(e => e.venta.equals(venta));
      partida.cantidadEntregada -= deEstaVenta.reduce((s, e) => s + e.cantidad, 0);
      partida.entregas = partida.entregas.filter(e => !e.venta.equals(venta));
    }
    if (receta.estado === 'surtida') receta.estado = 'validada';
    await receta.save({ session });
  }
}

module.exports = {
  crear, actualizar, obtener, listar, disponibles, validar, cancelar, subirArchivo, leerArchivo,
  surtirEnVenta, revertirEnVenta, SERIE_RECETA
};

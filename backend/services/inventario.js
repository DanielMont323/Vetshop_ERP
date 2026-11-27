// Inventario por capas: entradas, consumo FEFO y reversión. Adaptado de estética canina
// (consumoFifo.js y revertirFifoVenta.js) con estos cambios:
//   - FEFO: se consume primero lo que caduca antes (no lo que entró primero), por sucursal.
//   - Nunca se consumen capas caducadas (salvo una salida dirigida a esa capa, p. ej. merma por caducidad).
//   - Sin producto.stock: las existencias se derivan de las capas.
//   - Descuento atómico de cada capa (condición cantidadRestante ≥ q) dentro de la transacción.
//   - Sin existencia suficiente se rechaza con un mensaje claro. NUNCA hay existencias negativas.
//
// Todas las funciones reciben `session` y deben llamarse dentro de conTransaccion().
const mongoose = require('mongoose');
const InventoryLayer = require('../models/InventoryLayer');
const InventoryMovement = require('../models/InventoryMovement');
const Producto = require('../models/Producto');
const { importePartida } = require('../helpers/dinero');
const { parsearCaducidad, estaCaducado, formatearLocal } = require('../helpers/fechas');
const { solicitudInvalida, noEncontrado, conflicto, ErrorApp } = require('../helpers/errores');
const { baseATexto } = require('../helpers/cantidades');

const aId = id => new mongoose.Types.ObjectId(String(id));

// Categorías que exigen lote y caducidad en cada entrada
const EXIGEN_LOTE = new Set(['medicamento', 'biologico']);
const EXIGEN_CADUCIDAD = new Set(['medicamento', 'biologico', 'alimento']);

// Tipo de movimiento según el origen de la capa
const TIPO_POR_ORIGEN = {
  inventario_inicial: 'entrada',
  compra: 'entrada',
  ajuste_entrada: 'ajuste',
  traspaso_entrada: 'traspaso_entrada'
};

const costoDe = (producto, cantidad, costoUnitario) =>
  importePartida({ precioUnitario: costoUnitario, cantidad, unidad: producto.unidad });

function exigirEnteroPositivo(valor, nombre) {
  if (!Number.isSafeInteger(valor) || valor <= 0) throw solicitudInvalida(`${nombre} debe ser un entero mayor que cero`);
}

async function cargarProducto(productoId, session) {
  const producto = await Producto.findById(productoId).session(session).lean();
  if (!producto) throw noEncontrado('Producto no encontrado');
  return producto;
}

// Caducidad capturada (texto MM/AAAA, DD/MM/AAAA, AAAA-MM-DD) o Date → Date | null
function normalizarCaducidad(caducidad) {
  if (caducidad === undefined || caducidad === null || caducidad === '') return null;
  if (caducidad instanceof Date) return caducidad;
  return parsearCaducidad(caducidad);
}

// Reglas de lote y caducidad de una entrada (también las usa el borrador de compra para avisar antes).
// Devuelve { lote, caducidad } normalizados.
function validarLoteYCaducidad(producto, { lote: loteTexto, caducidad: caducidadTexto }, { fecha = new Date(), permitirCaducado = false } = {}) {
  const lote = (loteTexto || '').trim() || undefined;
  const caducidad = normalizarCaducidad(caducidadTexto);
  if (EXIGEN_LOTE.has(producto.categoria) && !lote) throw solicitudInvalida(`${producto.nombre}: indica el lote`);
  if (EXIGEN_CADUCIDAD.has(producto.categoria) && !caducidad) throw solicitudInvalida(`${producto.nombre}: indica la caducidad`);
  if (caducidad && estaCaducado(caducidad, fecha) && !permitirCaducado) {
    throw solicitudInvalida(`${producto.nombre}: el lote ${lote || ''} ya está caducado (${formatearLocal(caducidad, 'dd/MM/yyyy')})`);
  }
  return { lote, caducidad };
}

/**
 * Entrada de inventario: crea una capa y su movimiento.
 * @param {object} datos
 *   sucursal, producto, cantidad (unidad base), costoUnitario (centavos por pieza/kg),
 *   lote, caducidad, origen ('inventario_inicial' | 'compra' | 'ajuste_entrada' | 'traspaso_entrada'),
 *   referencia { modelo, id, partida }, usuario, motivo, nota, autorizadoPor, fecha,
 *   permitirCaducado (solo inventario inicial: registrar lo que ya está caducado para darlo de baja)
 */
async function registrarEntrada(datos, session) {
  const { sucursal, cantidad, costoUnitario, origen, usuario, referencia, motivo, nota, autorizadoPor } = datos;
  const fecha = datos.fecha || new Date();
  exigirEnteroPositivo(cantidad, 'La cantidad');
  if (!Number.isSafeInteger(costoUnitario) || costoUnitario < 0) throw solicitudInvalida('El costo unitario debe estar en centavos enteros (≥ 0)');
  if (!TIPO_POR_ORIGEN[origen]) throw solicitudInvalida(`Origen de entrada inválido: ${origen}`);

  const producto = await cargarProducto(datos.producto, session);
  const { lote, caducidad } = validarLoteYCaducidad(producto, datos, {
    fecha,
    // Inventario inicial: para registrar lo que ya está caducado y darlo de baja. Traspaso: lo que caducó en el camino llegó y hay que registrarlo
    // Ajuste por conteo físico: un sobrante de un lote ya caducado se registra para darlo de baja después
    permitirCaducado: Boolean(datos.permitirCaducado && ['inventario_inicial', 'traspaso_entrada', 'ajuste_entrada'].includes(origen))
  });

  const [capa] = await InventoryLayer.create(
    [{
      producto: producto._id, sucursal, lote, caducidad, cantidadInicial: cantidad, cantidadRestante: cantidad,
      costoUnitario, origen, referencia, fechaEntrada: fecha, usuario
    }],
    { session }
  );
  const costo = costoDe(producto, cantidad, costoUnitario);
  const [movimiento] = await InventoryMovement.create(
    [{
      producto: producto._id, sucursal, tipo: TIPO_POR_ORIGEN[origen], cantidad,
      capas: [{ capa: capa._id, lote, caducidad, cantidad, costoUnitario, costo }],
      costoTotal: costo, referencia, motivo, nota, autorizadoPor, usuario, fecha
    }],
    { session }
  );
  return { capa, movimiento };
}

// Capas que se pueden consumir: con existencia y no caducadas, en orden FEFO
function capasVigentes(sucursal, productoId, ahora, session) {
  return InventoryLayer.find({
    sucursal,
    producto: productoId,
    agotada: false,
    cantidadRestante: { $gt: 0 },
    $or: [{ caducidad: null }, { caducidad: { $gte: ahora } }]
  })
    .sort({ ordenFefo: 1, _id: 1 })
    .session(session);
}

// Descuenta q de una capa de forma atómica. Si otra operación la consumió antes → 409.
async function descontarDeCapa(capa, q, session) {
  const actualizada = await InventoryLayer.findOneAndUpdate(
    { _id: capa._id, sucursal: capa.sucursal, cantidadRestante: { $gte: q } },
    [{
      $set: {
        cantidadRestante: { $subtract: ['$cantidadRestante', q] },
        agotada: { $eq: [{ $subtract: ['$cantidadRestante', q] }, 0] }
      }
    }],
    { new: true, session }
  );
  if (!actualizada) throw conflicto('La existencia cambió mientras se registraba la operación. Intenta de nuevo.', 'EXISTENCIA_CAMBIO');
  return actualizada;
}

function errorExistencia(producto, disponible, solicitado, caducado) {
  const u = producto.unidad === 'kg' ? 'kg' : 'pzas';
  const extra = caducado > 0 ? ` (además hay ${baseATexto(caducado, producto.unidad)} ${u} caducados que no se pueden vender)` : '';
  return new ErrorApp(
    409,
    `Existencia insuficiente de ${producto.nombre}: hay ${baseATexto(disponible, producto.unidad)} ${u}, se pidieron ${baseATexto(solicitado, producto.unidad)} ${u}${extra}.`,
    'EXISTENCIA_INSUFICIENTE',
    { producto: producto._id, disponible, solicitado, caducado }
  );
}

async function cantidadCaducada(sucursal, productoId, ahora, session) {
  const [r] = await InventoryLayer.aggregate([
    { $match: { sucursal, producto: productoId, agotada: false, caducidad: { $ne: null, $lt: ahora } } },
    { $group: { _id: null, total: { $sum: '$cantidadRestante' } } }
  ]).session(session);
  return r ? r.total : 0;
}

/**
 * Consumo FEFO de varias partidas (venta, traspaso, ajuste de salida).
 * Valida TODO antes de descontar nada; si algún producto no alcanza, no se toca ninguna capa.
 *
 * @param {object} datos
 *   sucursal, tipo ('venta' | 'traspaso_salida' | 'ajuste'), usuario, fecha, referencia { modelo, id },
 *   partidas: [{ producto, cantidad, partida?, lotePreferido? }], motivo, nota, autorizadoPor
 *   (lotePreferido: ese lote sale primero aunque no sea el que caduca antes — promociones por lote)
 * @returns {Promise<Array>} por partida: { partida, producto, cantidad, capas[], costoTotal, movimiento }
 */
async function consumirFefo(datos, session) {
  const { sucursal, tipo, usuario, referencia, motivo, nota, autorizadoPor } = datos;
  const fecha = datos.fecha || new Date();
  if (!['venta', 'traspaso_salida', 'ajuste'].includes(tipo)) throw new Error(`consumirFefo: tipo inválido ${tipo}`);
  if (!Array.isArray(datos.partidas) || datos.partidas.length === 0) throw solicitudInvalida('No hay partidas que descontar');

  // 1. Agrupar por producto (dos partidas del mismo producto comparten capas)
  const porProducto = new Map();
  datos.partidas.forEach((p, i) => {
    exigirEnteroPositivo(p.cantidad, 'La cantidad');
    const clave = String(p.producto);
    if (!porProducto.has(clave)) porProducto.set(clave, { total: 0, partidas: [], lotePreferido: null });
    const grupo = porProducto.get(clave);
    grupo.total += p.cantidad;
    if (p.lotePreferido && !grupo.lotePreferido) grupo.lotePreferido = p.lotePreferido;
    // La partida del lote en promoción toma primero de ese lote
    if (p.lotePreferido) grupo.partidas.unshift({ indice: p.partida ?? i, cantidad: p.cantidad });
    else grupo.partidas.push({ indice: p.partida ?? i, cantidad: p.cantidad });
  });

  // 2. Validar existencia vigente de TODOS antes de tocar nada
  const plan = [];
  for (const [productoId, grupo] of porProducto) {
    const producto = await cargarProducto(productoId, session);
    let capas = await capasVigentes(sucursal, producto._id, fecha, session);
    if (grupo.lotePreferido) capas = [...capas.filter(c => c.lote === grupo.lotePreferido), ...capas.filter(c => c.lote !== grupo.lotePreferido)];
    const disponible = capas.reduce((s, c) => s + c.cantidadRestante, 0);
    if (disponible < grupo.total) {
      throw errorExistencia(producto, disponible, grupo.total, await cantidadCaducada(sucursal, producto._id, fecha, session));
    }
    plan.push({ producto, capas, grupo });
  }

  // 3. Descontar capa por capa y asignar a cada partida en orden FEFO (sin prorratear: estética F6)
  const resultado = [];
  for (const { producto, capas, grupo } of plan) {
    const tomadas = [];
    let falta = grupo.total;
    for (const capa of capas) {
      if (falta === 0) break;
      const q = Math.min(falta, capa.cantidadRestante);
      await descontarDeCapa(capa, q, session);
      tomadas.push({ capa: capa._id, lote: capa.lote, caducidad: capa.caducidad, costoUnitario: capa.costoUnitario, restante: q });
      falta -= q;
    }

    for (const partida of grupo.partidas) {
      let porAsignar = partida.cantidad;
      const capasPartida = [];
      for (const t of tomadas) {
        if (porAsignar === 0) break;
        if (t.restante === 0) continue;
        const q = Math.min(porAsignar, t.restante);
        capasPartida.push({ capa: t.capa, lote: t.lote, caducidad: t.caducidad, cantidad: q, costoUnitario: t.costoUnitario, costo: costoDe(producto, q, t.costoUnitario) });
        t.restante -= q;
        porAsignar -= q;
      }
      const costoTotal = capasPartida.reduce((s, c) => s + c.costo, 0);
      const [movimiento] = await InventoryMovement.create(
        [{
          producto: producto._id, sucursal, tipo, cantidad: -partida.cantidad, capas: capasPartida, costoTotal,
          referencia: referencia ? { ...referencia, partida: partida.indice } : undefined,
          motivo, nota, autorizadoPor, usuario, fecha
        }],
        { session }
      );
      resultado.push({ partida: partida.indice, producto: producto._id, cantidad: partida.cantidad, capas: capasPartida, costoTotal, movimiento: movimiento._id });
    }
  }
  return resultado.sort((a, b) => a.partida - b.partida);
}

/**
 * Salida dirigida a UNA capa concreta (merma de un lote caducado, dañado…). Puede tomar de una capa
 * caducada: es justo la forma de darla de baja. Solo para ajustes autorizados.
 */
async function consumirDeCapa({ sucursal, capaId, producto: productoEsperado, cantidad, usuario, motivo, nota, autorizadoPor, referencia, fecha = new Date() }, session) {
  exigirEnteroPositivo(cantidad, 'La cantidad');
  const capa = await InventoryLayer.findOne({ _id: aId(capaId), sucursal }).session(session);
  if (!capa) throw noEncontrado('Lote no encontrado en esta sucursal');
  if (productoEsperado && String(capa.producto) !== String(productoEsperado)) throw solicitudInvalida('Ese lote es de otro producto');
  const producto = await cargarProducto(capa.producto, session);
  if (capa.cantidadRestante < cantidad) throw errorExistencia(producto, capa.cantidadRestante, cantidad, 0);
  await descontarDeCapa(capa, cantidad, session);
  const costo = costoDe(producto, cantidad, capa.costoUnitario);
  const [movimiento] = await InventoryMovement.create(
    [{
      producto: producto._id, sucursal, tipo: 'ajuste', cantidad: -cantidad,
      capas: [{ capa: capa._id, lote: capa.lote, caducidad: capa.caducidad, cantidad, costoUnitario: capa.costoUnitario, costo }],
      costoTotal: costo, referencia, motivo, nota, autorizadoPor, usuario, fecha
    }],
    { session }
  );
  return { movimiento, capa: capa._id, costoTotal: costo };
}

/**
 * Revierte las salidas de un documento (cancelación de venta, traspaso rechazado…): devuelve cada
 * cantidad a la capa EXACTA de la que salió y crea un movimiento contrario por cada original.
 * No modifica los originales. Un movimiento ya revertido no se revierte otra vez (índice único).
 */
async function revertirSalidas({ sucursal, referenciaId, usuario, motivo, nota, autorizadoPor, fecha = new Date() }, session) {
  const salidas = await InventoryMovement.find({
    sucursal,
    'referencia.id': aId(referenciaId),
    cantidad: { $lt: 0 }
  }).sort({ _id: 1 }).session(session);
  if (salidas.length === 0) return [];

  const yaRevertidos = await InventoryMovement.find({ sucursal, movimientoOriginal: { $in: salidas.map(s => s._id) } })
    .select('movimientoOriginal').session(session).lean();
  const revertidos = new Set(yaRevertidos.map(r => String(r.movimientoOriginal)));
  const pendientes = salidas.filter(s => !revertidos.has(String(s._id)));

  const resultado = [];
  for (const original of pendientes) {
    for (const c of original.capas) {
      const r = await InventoryLayer.updateOne(
        { _id: c.capa, sucursal, $expr: { $lte: [{ $add: ['$cantidadRestante', c.cantidad] }, '$cantidadInicial'] } },
        [{ $set: { cantidadRestante: { $add: ['$cantidadRestante', c.cantidad] }, agotada: false } }],
        { session }
      );
      if (r.modifiedCount !== 1) throw conflicto(`No se pudo devolver al lote ${c.lote || ''}: excedería su cantidad inicial`, 'REVERSION_INVALIDA');
    }
    const [movimiento] = await InventoryMovement.create(
      [{
        producto: original.producto, sucursal, tipo: 'cancelacion', cantidad: -original.cantidad,
        capas: original.capas.map(c => c.toObject()), costoTotal: original.costoTotal,
        referencia: original.referencia, movimientoOriginal: original._id,
        motivo, nota, autorizadoPor, usuario, fecha
      }],
      { session }
    );
    resultado.push(movimiento);
  }
  return resultado;
}

// ¿El producto tiene historial de inventario en cualquier sucursal? (para bloquear el cambio de unidad)
async function tieneInventario(productoId, session) {
  return Boolean(await InventoryLayer.exists({ producto: aId(productoId) }).setOptions({ sinAlcance: true }).session(session || null));
}

module.exports = {
  registrarEntrada, consumirFefo, consumirDeCapa, revertirSalidas, tieneInventario, validarLoteYCaducidad,
  EXIGEN_LOTE, EXIGEN_CADUCIDAD
};

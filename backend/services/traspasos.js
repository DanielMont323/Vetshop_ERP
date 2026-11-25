// Traspasos entre sucursales.
//   enviar:   desde la sucursal activa (origen); sale por FEFO (nunca caducados) en una transacción.
//   recibir:  en la sucursal destino; se captura lo que llegó de cada lote y entra con el mismo
//             lote, caducidad y costo. Llegar menos de lo enviado deja el traspaso "con diferencia".
//   autorizar diferencia: PIN del dueño (es mercancía perdida en el camino); queda en bitácora.
//   cancelar: solo en tránsito y desde el origen; la mercancía regresa a sus lotes exactos.
const mongoose = require('mongoose');
const Traspaso = require('../models/Traspaso');
const Sucursal = require('../models/Sucursal');
const Producto = require('../models/Producto');
const { siguienteFolio } = require('../models/Contador');
const { conTransaccion } = require('../helpers/transaccion');
const { conAlcance, conAlcanceMultiple, sucursalDeEscritura } = require('../helpers/alcance');
const { solicitudInvalida, noEncontrado, conflicto } = require('../helpers/errores');
const inventario = require('./inventario');
const { verificarPin } = require('./autorizaciones');
const auditoria = require('./auditoria');

const SERIE_TRASPASO = 'T';
const CAMPOS = ['origen', 'destino'];
const aId = id => new mongoose.Types.ObjectId(String(id));

function faltantes(traspaso) {
  return traspaso.partidas.flatMap(p => p.lotes
    .filter(l => (l.recibido ?? 0) < l.enviado)
    .map(l => ({ sku: p.sku, nombre: p.nombre, unidad: p.unidad, lote: l.lote || null, faltante: l.enviado - (l.recibido ?? 0) })));
}

const publico = t => ({
  id: t._id,
  folio: t.folio,
  origen: { id: t.origen, nombre: t.origenNombre },
  destino: { id: t.destino, nombre: t.destinoNombre },
  partidas: t.partidas,
  estado: t.estado,
  observaciones: t.observaciones || '',
  envio: t.envio,
  recepcion: t.recepcion?.fecha ? t.recepcion : null,
  diferencia: t.diferencia?.fecha ? t.diferencia : null,
  cancelacion: t.cancelacion?.fecha ? t.cancelacion : null,
  faltantes: ['con_diferencia', 'diferencia_autorizada'].includes(t.estado) ? faltantes(t) : []
});

// Sucursales a las que se puede enviar desde la activa
async function destinos(alcance) {
  const origen = sucursalDeEscritura(alcance);
  const lista = await Sucursal.find({ activa: true, _id: { $ne: origen } }).sort({ nombre: 1 }).lean();
  return lista.map(s => ({ id: s._id, nombre: s.nombre, tipo: s.tipo }));
}

async function enviar(alcance, actor, { destino: destinoId, partidas, observaciones }) {
  const origen = sucursalDeEscritura(alcance);
  const [sOrigen, sDestino] = await Promise.all([Sucursal.findById(origen).lean(), Sucursal.findById(destinoId).lean()]);
  if (!sDestino || !sDestino.activa) throw solicitudInvalida('La sucursal destino no existe o está desactivada');
  if (sDestino._id.equals(origen)) throw solicitudInvalida('El destino debe ser distinto del origen');

  return conTransaccion(async session => {
    const id = new mongoose.Types.ObjectId();
    const fecha = new Date();
    const consumo = await inventario.consumirFefo(
      {
        sucursal: origen, tipo: 'traspaso_salida', usuario: actor._id, fecha,
        referencia: { modelo: 'Traspaso', id },
        nota: `Traspaso a ${sDestino.nombre}`,
        partidas: partidas.map((p, i) => ({ producto: p.producto, cantidad: p.cantidad, partida: i }))
      },
      session
    );
    const productos = new Map((await Producto.find({ _id: { $in: partidas.map(p => aId(p.producto)) } }).session(session).lean()).map(p => [String(p._id), p]));
    const filas = consumo.map(c => {
      const p = productos.get(String(c.producto));
      return {
        producto: p._id, sku: p.sku, nombre: p.nombre, unidad: p.unidad, cantidad: c.cantidad,
        lotes: c.capas.map(l => ({ capaOrigen: l.capa, lote: l.lote, caducidad: l.caducidad, costoUnitario: l.costoUnitario, enviado: l.cantidad }))
      };
    });
    const [traspaso] = await Traspaso.create(
      [{
        _id: id, folio: await siguienteFolio(origen, SERIE_TRASPASO, session),
        origen, origenNombre: sOrigen.nombre, destino: sDestino._id, destinoNombre: sDestino.nombre,
        partidas: filas, observaciones, envio: { usuario: actor._id, usuarioNombre: actor.nombre, fecha }
      }],
      { session }
    );
    return publico(traspaso.toObject());
  });
}

/**
 * Recibir en el destino. `recibidos[i][j]` = cantidad que llegó del lote j de la partida i
 * (0 ≤ recibido ≤ enviado). Lo recibido entra con el mismo lote, caducidad y costo.
 */
async function recibir(alcance, actor, id, { recibidos, observaciones }) {
  const destino = sucursalDeEscritura(alcance);
  return conTransaccion(async session => {
    const traspaso = await Traspaso.findOne(conAlcance({ _id: aId(id) }, { sucursalActiva: destino }, 'destino')).session(session);
    if (!traspaso) throw noEncontrado('Traspaso no encontrado en esta sucursal (¿eres el destino?)');
    if (traspaso.estado !== 'en_transito') throw conflicto(`El traspaso ya está ${traspaso.estado.replace('_', ' ')}`, 'TRASPASO_NO_EN_TRANSITO');
    if (!Array.isArray(recibidos) || recibidos.length !== traspaso.partidas.length) throw solicitudInvalida('Captura lo recibido de cada partida');

    const fecha = new Date();
    traspaso.partidas.forEach((p, i) => {
      if (!Array.isArray(recibidos[i]) || recibidos[i].length !== p.lotes.length) throw solicitudInvalida(`${p.nombre}: captura lo recibido de cada lote`);
      p.lotes.forEach((l, j) => {
        const r = recibidos[i][j];
        if (!Number.isSafeInteger(r) || r < 0) throw solicitudInvalida(`${p.nombre}: cantidad recibida inválida`);
        if (r > l.enviado) throw solicitudInvalida(`${p.nombre}, lote ${l.lote || 's/l'}: no puede llegar más de lo enviado`);
        l.recibido = r;
      });
    });

    for (const [i, p] of traspaso.partidas.entries()) {
      for (const l of p.lotes) {
        if (l.recibido === 0) continue;
        const { capa } = await inventario.registrarEntrada(
          {
            sucursal: destino, producto: p.producto, cantidad: l.recibido, costoUnitario: l.costoUnitario,
            lote: l.lote, caducidad: l.caducidad, origen: 'traspaso_entrada', permitirCaducado: true,
            referencia: { modelo: 'Traspaso', id: traspaso._id, partida: i },
            nota: `Traspaso T-${traspaso.folio} de ${traspaso.origenNombre}`,
            usuario: actor._id, fecha
          },
          session
        );
        l.capaDestino = capa._id;
      }
    }

    const completo = traspaso.partidas.every(p => p.lotes.every(l => l.recibido === l.enviado));
    traspaso.estado = completo ? 'recibido' : 'con_diferencia';
    traspaso.recepcion = { usuario: actor._id, usuarioNombre: actor.nombre, fecha, observaciones };
    await traspaso.save({ session });
    if (!completo) {
      await auditoria.registrar(
        { usuario: actor._id, accion: 'traspaso.recibido_con_diferencia', entidad: 'Traspaso', entidadId: traspaso._id, sucursal: destino, despues: { faltantes: faltantes(traspaso) }, motivo: observaciones },
        session
      );
    }
    return publico(traspaso.toObject());
  });
}

// La mercancía que no llegó ya salió del origen y no entró al destino: el dueño la autoriza como pérdida
async function autorizarDiferencia(alcance, actor, id, { nota, autorizacion }) {
  const sucursal = sucursalDeEscritura(alcance);
  const autorizador = await verificarPin({ ...autorizacion, permiso: 'autorizar:ajuste_inventario', sucursal });
  return conTransaccion(async session => {
    const traspaso = await Traspaso.findOne(conAlcanceMultiple({ _id: aId(id) }, { ...alcance, sucursalActiva: sucursal }, CAMPOS)).session(session);
    if (!traspaso) throw noEncontrado('Traspaso no encontrado');
    if (traspaso.estado !== 'con_diferencia') throw conflicto('Ese traspaso no tiene diferencia por autorizar', 'SIN_DIFERENCIA');
    traspaso.estado = 'diferencia_autorizada';
    traspaso.diferencia = { autorizadoPor: autorizador.id, autorizadoPorNombre: autorizador.nombre, nota, fecha: new Date() };
    await traspaso.save({ session });
    await auditoria.registrar(
      { usuario: actor._id, autorizadoPor: autorizador.id, accion: 'traspaso.autorizar_diferencia', entidad: 'Traspaso', entidadId: traspaso._id, sucursal, motivo: nota, despues: { faltantes: faltantes(traspaso) } },
      session
    );
    return publico(traspaso.toObject());
  });
}

async function cancelar(alcance, actor, id, motivo) {
  const origen = sucursalDeEscritura(alcance);
  return conTransaccion(async session => {
    const traspaso = await Traspaso.findOne(conAlcance({ _id: aId(id) }, { sucursalActiva: origen }, 'origen')).session(session);
    if (!traspaso) throw noEncontrado('Traspaso no encontrado (solo lo cancela la sucursal que lo envió)');
    if (traspaso.estado !== 'en_transito') throw conflicto('Solo se cancela un traspaso en tránsito', 'TRASPASO_NO_EN_TRANSITO');
    const fecha = new Date();
    await inventario.revertirSalidas({ sucursal: origen, referenciaId: traspaso._id, usuario: actor._id, nota: `Cancelación traspaso T-${traspaso.folio}: ${motivo}`, fecha }, session);
    traspaso.estado = 'cancelado';
    traspaso.cancelacion = { usuario: actor._id, motivo, fecha };
    await traspaso.save({ session });
    await auditoria.registrar({ usuario: actor._id, accion: 'traspaso.cancelar', entidad: 'Traspaso', entidadId: traspaso._id, sucursal: origen, motivo }, session);
    return publico(traspaso.toObject());
  });
}

// direccion: 'enviados' (origen) | 'recibidos' (destino) | sin indicar: ambos
async function listar(alcance, { estado, direccion, pagina = 1, limite = 50 } = {}) {
  const filtroBase = estado ? { estado } : {};
  const filtro = direccion === 'enviados' ? conAlcance(filtroBase, alcance, 'origen')
    : direccion === 'recibidos' ? conAlcance(filtroBase, alcance, 'destino')
      : conAlcanceMultiple(filtroBase, alcance, CAMPOS);
  const [lista, total] = await Promise.all([
    Traspaso.find(filtro).sort({ createdAt: -1 }).skip((pagina - 1) * limite).limit(limite).lean(),
    Traspaso.countDocuments(filtro)
  ]);
  return { datos: lista.map(publico), total, pagina, limite };
}

async function obtener(alcance, id) {
  const t = await Traspaso.findOne(conAlcanceMultiple({ _id: aId(id) }, alcance, CAMPOS)).lean();
  if (!t) throw noEncontrado('Traspaso no encontrado');
  return publico(t);
}

module.exports = { destinos, enviar, recibir, autorizarDiferencia, cancelar, listar, obtener, SERIE_TRASPASO };

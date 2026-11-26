// Conteo físico de inventario por sucursal.
//
//   iniciar   → foto de existencias por lote (capas con existencia, incluidas las caducadas)
//   capturar  → CIEGA: quien cuenta no ve lo esperado. Se guarda también cuánto marcaba el sistema en ese
//               momento (esperadoCaptura), así lo que se vende DESPUÉS de contar un lote no se vuelve una
//               diferencia falsa.
//   revisión  → el dueño ve las diferencias (y puede pedir recontar renglones)
//   aplicar   → PIN del dueño: por cada diferencia, entrada o salida de ESE lote (motivo conteo_fisico), en
//               una sola transacción y con bitácora
// Mientras haya un conteo abierto en la sucursal, los ajustes manuales se bloquean (services/ajustes).
const mongoose = require('mongoose');
const ConteoFisico = require('../models/ConteoFisico');
const InventoryLayer = require('../models/InventoryLayer');
const Producto = require('../models/Producto');
const Sucursal = require('../models/Sucursal');
const { siguienteFolio } = require('../models/Contador');
const { conTransaccion } = require('../helpers/transaccion');
const { conAlcance, matchAlcance, sucursalDeEscritura } = require('../helpers/alcance');
const { importePartida, sumar } = require('../helpers/dinero');
const { solicitudInvalida, noEncontrado, conflicto, ErrorApp } = require('../helpers/errores');
const { tienePermiso } = require('../config/permisos');
const inventario = require('./inventario');
const { verificarPin } = require('./autorizaciones');
const auditoria = require('./auditoria');

const SERIE = 'CF';
const DIAS_SIN_CONTEO = 7;
const aId = id => new mongoose.Types.ObjectId(String(id));
const filtroEscritura = (alcance, filtro) => conAlcance(filtro, { ...alcance, sucursalActiva: sucursalDeEscritura(alcance) });
const valorDe = (r, cantidad) => importePartida({ precioUnitario: r.costoUnitario, cantidad: Math.abs(cantidad), unidad: r.unidad });

// ---------- Vista ----------

// Esperado para revisar: lo que marcaba el sistema al capturar; si no se capturó, lo que hay ahora
function calcular(r, actuales) {
  const esperado = r.esperadoFinal ?? r.esperadoCaptura ?? actuales?.get(String(r.capa)) ?? r.esperado;
  const contado = r.contado;
  const diferencia = r.diferencia ?? (contado === null || contado === undefined ? null : contado - esperado);
  return { esperado, diferencia, valor: diferencia ? valorDe(r, diferencia) * Math.sign(diferencia) : 0 };
}

function publico(c, { verEsperado, actuales } = {}) {
  const renglones = c.renglones.map(r => {
    const base = {
      id: r._id, capa: r.capa, producto: r.producto, sku: r.sku, codigoBarras: r.codigoBarras || null, nombre: r.nombre,
      categoria: r.categoria, unidad: r.unidad, lote: r.lote || '', caducidad: r.caducidad, contado: r.contado ?? null,
      fechaCaptura: r.fechaCaptura || null
    };
    return verEsperado ? { ...base, ...calcular(r, actuales), esperadoInicio: r.esperado, costoUnitario: r.costoUnitario } : base;
  });
  const contados = c.renglones.filter(r => r.contado !== null && r.contado !== undefined).length;
  const resumen = { renglones: c.renglones.length, contados, pendientes: c.renglones.length - contados };
  if (verEsperado) {
    const conDif = renglones.filter(r => r.diferencia);
    resumen.conDiferencia = conDif.length;
    resumen.faltante = sumar(conDif.filter(r => r.diferencia < 0).map(r => -r.valor));
    resumen.sobrante = sumar(conDif.filter(r => r.diferencia > 0).map(r => r.valor));
  }
  return {
    id: c._id, sucursal: c.sucursal, folio: `${SERIE}-${c.folio}`, categorias: c.categorias || [], estado: c.estado, nota: c.nota || '',
    inicio: c.inicio, revision: c.revision?.fecha ? c.revision : null,
    aplicacion: c.estado === 'aplicado' ? c.aplicacion : null, cancelacion: c.estado === 'cancelado' ? c.cancelacion : null,
    resumen, renglones
  };
}

const verEsperado = (actor, conteo) => conteo.estado !== 'en_captura' && tienePermiso(actor.rol, 'conteo_fisico:aplicar');

async function existenciasActuales(conteo, session) {
  const capas = await InventoryLayer.find({ sucursal: conteo.sucursal, _id: { $in: conteo.renglones.map(r => r.capa) } })
    .select('cantidadRestante').session(session || null).lean();
  return new Map(capas.map(k => [String(k._id), k.cantidadRestante]));
}

async function vista(actor, conteo, session) {
  const ver = verEsperado(actor, conteo);
  return publico(conteo, { verEsperado: ver, actuales: ver && conteo.estado === 'en_revision' ? await existenciasActuales(conteo, session) : null });
}

// ---------- Operaciones ----------

async function iniciar(alcance, actor, { categorias = [], nota } = {}) {
  const sucursal = sucursalDeEscritura(alcance);
  const capas = await InventoryLayer.find({ sucursal, agotada: false, cantidadRestante: { $gt: 0 } }).lean();
  const productos = new Map((await Producto.find({ _id: { $in: [...new Set(capas.map(k => String(k.producto)))].map(aId) } }).lean()).map(p => [String(p._id), p]));
  const renglones = capas
    .map(k => ({ k, p: productos.get(String(k.producto)) }))
    .filter(({ p }) => p && (!categorias.length || categorias.includes(p.categoria)))
    .sort((a, b) => a.p.nombre.localeCompare(b.p.nombre, 'es') || (a.k.caducidad || 0) - (b.k.caducidad || 0))
    .map(({ k, p }) => ({
      capa: k._id, producto: p._id, sku: p.sku, codigoBarras: p.codigoBarras, nombre: p.nombre, categoria: p.categoria, unidad: p.unidad,
      lote: k.lote, caducidad: k.caducidad, costoUnitario: k.costoUnitario, esperado: k.cantidadRestante
    }));
  if (!renglones.length) throw conflicto('No hay existencias que contar con esos filtros', 'SIN_EXISTENCIAS');
  try {
    const conteo = await conTransaccion(async session => {
      const folio = await siguienteFolio(sucursal, SERIE, session);
      const [c] = await ConteoFisico.create(
        [{ sucursal, folio, categorias, nota, inicio: { fecha: new Date(), usuario: actor._id, usuarioNombre: actor.nombre }, renglones }],
        { session }
      );
      await auditoria.registrar(
        { usuario: actor._id, accion: 'conteo.iniciar', entidad: 'ConteoFisico', entidadId: c._id, sucursal, despues: { folio: `${SERIE}-${folio}`, renglones: renglones.length, categorias } },
        session
      );
      return c;
    });
    return vista(actor, conteo.toObject());
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.sucursal && !error.keyPattern?.folio) {
      throw conflicto('Ya hay un conteo abierto en esta sucursal: termínalo o cancélalo', 'CONTEO_EN_CURSO');
    }
    throw error;
  }
}

async function cargar(alcance, id, session) {
  const c = await ConteoFisico.findOne(conAlcance({ _id: aId(id) }, alcance)).session(session || null).lean();
  if (!c) throw noEncontrado('Conteo no encontrado');
  return c;
}

async function obtener(alcance, actor, id) {
  return vista(actor, await cargar(alcance, id));
}

async function listar(alcance, { pagina = 1, limite = 30 } = {}) {
  const consulta = conAlcance({}, alcance);
  const [lista, total] = await Promise.all([
    ConteoFisico.find(consulta).sort({ createdAt: -1 }).skip((pagina - 1) * limite).limit(limite).select('-renglones.codigoBarras').lean(),
    ConteoFisico.countDocuments(consulta)
  ]);
  const nombres = new Map((await Sucursal.find({ _id: { $in: [...new Set(lista.map(c => String(c.sucursal)))].map(aId) } }).lean()).map(s => [String(s._id), s.nombre]));
  return {
    datos: lista.map(c => {
      const { renglones: _r, ...resto } = publico(c);
      return { ...resto, sucursal: { id: c.sucursal, nombre: nombres.get(String(c.sucursal)) || '' } };
    }),
    total, pagina, limite
  };
}

/** Capturar un renglón: modo 'sumar' (otra persona contó más del mismo lote) o 'reemplazar' (recontar). */
async function capturar(alcance, actor, id, { renglon, cantidad, modo = 'sumar' }) {
  if (!Number.isSafeInteger(cantidad) || cantidad < 0) throw solicitudInvalida('Cantidad: entero ≥ 0 (piezas o gramos)');
  const conteo = await ConteoFisico.findOne(filtroEscritura(alcance, { _id: aId(id) })).lean();
  if (!conteo) throw noEncontrado('Conteo no encontrado');
  if (!['en_captura', 'en_revision'].includes(conteo.estado)) throw conflicto('El conteo ya no admite capturas', 'CONTEO_CERRADO');
  const r = conteo.renglones.find(x => String(x._id) === String(renglon));
  if (!r) throw noEncontrado('Renglón no encontrado en este conteo');
  // Cuánto marca el sistema AHORA (no se le devuelve a quien cuenta)
  const capa = await InventoryLayer.findOne({ _id: r.capa, sucursal: conteo.sucursal }).select('cantidadRestante').lean();
  const set = { 'renglones.$[r].esperadoCaptura': capa?.cantidadRestante ?? 0, 'renglones.$[r].capturadoPor': actor._id, 'renglones.$[r].fechaCaptura': new Date() };
  const filtro = { _id: conteo._id, sucursal: conteo.sucursal, estado: { $in: ['en_captura', 'en_revision'] } };
  let actualizado;
  if (modo === 'sumar' && r.contado !== null && r.contado !== undefined) {
    actualizado = await ConteoFisico.findOneAndUpdate(
      { ...filtro, renglones: { $elemMatch: { _id: r._id, contado: { $ne: null } } } },
      { $inc: { 'renglones.$[r].contado': cantidad }, $set: set },
      { new: true, arrayFilters: [{ 'r._id': r._id }] }
    ).lean();
  }
  if (!actualizado) {
    actualizado = await ConteoFisico.findOneAndUpdate(filtro, { $set: { ...set, 'renglones.$[r].contado': cantidad } }, { new: true, arrayFilters: [{ 'r._id': r._id }] }).lean();
  }
  if (!actualizado) throw conflicto('El conteo ya no admite capturas', 'CONTEO_CERRADO');
  const nuevo = actualizado.renglones.find(x => String(x._id) === String(r._id));
  return { id: nuevo._id, contado: nuevo.contado, fechaCaptura: nuevo.fechaCaptura };
}

async function cambiarEstado(alcance, actor, id, de, a, extra = {}) {
  const c = await ConteoFisico.findOneAndUpdate(filtroEscritura(alcance, { _id: aId(id), estado: de }), { $set: { estado: a, ...extra } }, { new: true }).lean();
  if (!c) {
    const existe = await ConteoFisico.findOne(filtroEscritura(alcance, { _id: aId(id) })).lean();
    if (!existe) throw noEncontrado('Conteo no encontrado');
    throw conflicto(`El conteo está ${existe.estado.replace('_', ' ')}`, 'ESTADO_CONTEO');
  }
  return vista(actor, c);
}

const aRevision = (alcance, actor, id) => cambiarEstado(alcance, actor, id, 'en_captura', 'en_revision', { revision: { fecha: new Date(), usuario: actor._id } });
const aCaptura = (alcance, actor, id) => cambiarEstado(alcance, actor, id, 'en_revision', 'en_captura');

async function cancelar(alcance, actor, id, { motivo }) {
  const sucursal = sucursalDeEscritura(alcance);
  return conTransaccion(async session => {
    const c = await ConteoFisico.findOneAndUpdate(
      filtroEscritura(alcance, { _id: aId(id), abierto: true }),
      { $set: { estado: 'cancelado', abierto: false, cancelacion: { fecha: new Date(), motivo, usuario: actor._id } } },
      { new: true, session }
    ).lean();
    if (!c) throw conflicto('El conteo ya está cerrado', 'ESTADO_CONTEO');
    await auditoria.registrar({ usuario: actor._id, accion: 'conteo.cancelar', entidad: 'ConteoFisico', entidadId: c._id, sucursal, motivo }, session);
    return publico(c);
  });
}

/**
 * Aplicar: PIN del dueño. Diferencia = contado − esperado (al capturar). Faltante: salida de ese lote
 * (hasta lo que haya); sobrante: entrada al mismo lote y costo. Los no contados cuentan como 0 solo si se indica.
 */
async function aplicar(alcance, actor, id, { autorizacion, noContadosEnCero = false }) {
  const sucursal = sucursalDeEscritura(alcance);
  const autorizador = await verificarPin({ ...autorizacion, permiso: 'autorizar:ajuste_inventario', sucursal });
  const conteo = await conTransaccion(async session => {
    const fecha = new Date();
    const c = await ConteoFisico.findOne(filtroEscritura(alcance, { _id: aId(id) })).session(session).lean();
    if (!c) throw noEncontrado('Conteo no encontrado');
    if (c.estado !== 'en_revision') throw conflicto('Primero pasa el conteo a revisión', 'ESTADO_CONTEO');
    const sinContar = c.renglones.filter(r => r.contado === null || r.contado === undefined);
    if (sinContar.length && !noContadosEnCero) {
      throw new ErrorApp(409, `Faltan ${sinContar.length} renglones por contar (o indica que cuentan como cero)`, 'RENGLONES_SIN_CONTAR', { pendientes: sinContar.length });
    }
    const actuales = await existenciasActuales(c, session);
    const nota = `Conteo físico ${SERIE}-${c.folio}`;
    const comun = { sucursal, usuario: actor._id, motivo: 'conteo_fisico', nota, autorizadoPor: autorizador.id, referencia: { modelo: 'ConteoFisico', id: c._id }, fecha };
    const movimientos = [];
    let faltante = 0;
    let sobrante = 0;
    const renglones = [];
    for (const r of c.renglones) {
      const actual = actuales.get(String(r.capa)) ?? 0;
      const esperado = r.contado === null || r.contado === undefined ? actual : r.esperadoCaptura ?? actual;
      const contado = r.contado ?? 0;
      let diferencia = contado - esperado;
      if (diferencia < 0) {
        diferencia = -Math.min(-diferencia, actual); // no se puede sacar más de lo que queda en el lote
        if (diferencia < 0) {
          const m = await inventario.consumirDeCapa({ ...comun, capaId: r.capa, producto: r.producto, cantidad: -diferencia }, session);
          movimientos.push(m.movimiento._id);
          faltante += m.costoTotal;
        }
      } else if (diferencia > 0) {
        const m = await inventario.registrarEntrada(
          { ...comun, producto: r.producto, cantidad: diferencia, costoUnitario: r.costoUnitario, lote: r.lote, caducidad: r.caducidad, origen: 'ajuste_entrada', permitirCaducado: true },
          session
        );
        movimientos.push(m.movimiento._id);
        sobrante += m.movimiento.costoTotal;
      }
      renglones.push({ ...r, contado, esperadoFinal: esperado, diferencia });
    }
    const aplicado = await ConteoFisico.findOneAndUpdate(
      { _id: c._id, sucursal, estado: 'en_revision' },
      {
        $set: {
          estado: 'aplicado', abierto: false, renglones,
          aplicacion: { fecha, usuario: actor._id, autorizadoPor: autorizador.id, autorizadoPorNombre: autorizador.nombre, noContadosEnCero, movimientos, faltante, sobrante }
        }
      },
      { new: true, session }
    ).lean();
    if (!aplicado) throw conflicto('El conteo cambió mientras se aplicaba; intenta de nuevo', 'ESTADO_CONTEO');
    await auditoria.registrar(
      {
        usuario: actor._id, autorizadoPor: autorizador.id, accion: 'conteo.aplicar', entidad: 'ConteoFisico', entidadId: c._id, sucursal,
        despues: { folio: `${SERIE}-${c.folio}`, ajustes: movimientos.length, faltante, sobrante, noContadosEnCero }
      },
      session
    );
    return aplicado;
  });
  return vista(actor, conteo);
}

// ¿Hay un conteo abierto? (para bloquear ajustes manuales)
async function hayAbierto(sucursal, session) {
  return Boolean(await ConteoFisico.exists({ sucursal, abierto: true }).session(session || null));
}

/** Tablero: sucursales activas del alcance que llevan más de 7 días sin conteo aplicado (o nunca, desde su alta). */
async function sucursalesSinConteo(alcance, ahora = new Date()) {
  const filtroSuc = { activa: true };
  if (alcance.sucursalActiva) filtroSuc._id = alcance.sucursalActiva;
  else if (alcance.permitidas !== 'todas') filtroSuc._id = { $in: alcance.permitidas };
  const [sucursales, ultimos] = await Promise.all([
    Sucursal.find(filtroSuc).select('createdAt').lean(),
    ConteoFisico.aggregate([matchAlcance(alcance, { estado: 'aplicado' }), { $group: { _id: '$sucursal', ultimo: { $max: '$aplicacion.fecha' } } }])
  ]);
  const porSucursal = new Map(ultimos.map(u => [String(u._id), u.ultimo]));
  const limite = ahora.getTime() - DIAS_SIN_CONTEO * 86400000;
  return sucursales.filter(s => (porSucursal.get(String(s._id)) || s.createdAt).getTime() < limite).length;
}

module.exports = { iniciar, obtener, listar, capturar, aRevision, aCaptura, cancelar, aplicar, hayAbierto, sucursalesSinConteo, SERIE };

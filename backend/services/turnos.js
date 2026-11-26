// Turnos de caja y corte ciego.
//
//   esperado.efectivo      = fondo + Σ efectivo de las ventas cobradas − Σ cambio + abonos en efectivo − retiros − devoluciones en efectivo
//   esperado.tarjeta       = Σ tarjeta de las ventas cobradas + abonos con tarjeta − devoluciones con tarjeta
//   esperado.transferencia = Σ transferencia de las ventas cobradas + abonos por transferencia − devoluciones por transferencia
//
// La parte a CRÉDITO de una venta no es dinero: no entra al corte (queda en la cuenta del cliente).
// Los abonos de clientes recibidos en el turno sí entran.
//
// "Devoluciones" = ventas de turnos YA CERRADOS que se cancelaron mientras este turno estaba abierto
// (el dinero sale de esta caja). Las ventas canceladas del propio turno simplemente no cuentan.
const mongoose = require('mongoose');
const Turno = require('../models/Turno');
const { DENOMINACIONES } = Turno;
const Venta = require('../models/Venta');
const { conTransaccion } = require('../helpers/transaccion');
const { conAlcance, sucursalDeEscritura } = require('../helpers/alcance');
const { solicitudInvalida, noEncontrado, conflicto, sinPermiso, ErrorApp } = require('../helpers/errores');
const { rangoDias, diaLocal } = require('../helpers/fechas');
const { sumar } = require('../helpers/dinero');
const { verificarPin } = require('./autorizaciones');
const auditoria = require('./auditoria');
const AbonoCliente = require('../models/AbonoCliente');

const METODOS = ['efectivo', 'tarjeta', 'transferencia'];
const aId = id => new mongoose.Types.ObjectId(String(id));
const filtroEscritura = (alcance, filtro) => conAlcance(filtro, { ...alcance, sucursalActiva: sucursalDeEscritura(alcance) });

function totalDenominaciones(denominaciones = []) {
  for (const d of denominaciones) {
    if (!DENOMINACIONES.includes(d.denominacion)) throw solicitudInvalida(`Denominación inválida: ${d.denominacion}`);
    if (!Number.isSafeInteger(d.cantidad) || d.cantidad < 0) throw solicitudInvalida('La cantidad de billetes o monedas debe ser un entero ≥ 0');
  }
  const vistos = new Set(denominaciones.map(d => d.denominacion));
  if (vistos.size !== denominaciones.length) throw solicitudInvalida('Denominación repetida');
  return sumar(denominaciones.map(d => d.denominacion * d.cantidad));
}

// Σ por método de pago (efectivo ya neto de cambio)
function sumarPagos(ventas) {
  const r = { efectivo: 0, tarjeta: 0, transferencia: 0 };
  for (const v of ventas) {
    for (const p of v.pagos) if (p.metodo in r) r[p.metodo] += p.monto;
    r.efectivo -= v.cambio || 0;
  }
  return r;
}

async function esperadoDe(turno, session) {
  const [cobradas, canceladasPropias, devoluciones, abonos] = await Promise.all([
    Venta.find({ sucursal: turno.sucursal, turno: turno._id, estado: 'cobrada' }).select('pagos cambio').session(session || null).lean(),
    Venta.countDocuments({ sucursal: turno.sucursal, turno: turno._id, estado: 'cancelada' }).session(session || null),
    Venta.find({ sucursal: turno.sucursal, 'cancelacion.turno': turno._id }).select('pagos cambio').session(session || null).lean(),
    AbonoCliente.find({ turno: turno._id, estado: 'aplicado' }).select('metodo monto').session(session || null).lean()
  ]);
  const porAbonos = { efectivo: 0, tarjeta: 0, transferencia: 0 };
  for (const a of abonos) porAbonos[a.metodo] += a.monto;
  const ingresos = sumarPagos(cobradas);
  const salidas = sumarPagos(devoluciones);
  const retiros = sumar((turno.retiros || []).map(r => r.monto));
  return {
    esperado: {
      efectivo: turno.apertura.fondo + ingresos.efectivo + porAbonos.efectivo - salidas.efectivo - retiros,
      tarjeta: ingresos.tarjeta + porAbonos.tarjeta - salidas.tarjeta,
      transferencia: ingresos.transferencia + porAbonos.transferencia - salidas.transferencia
    },
    ventas: cobradas.length,
    abonos: abonos.length,
    abonosPorMetodo: porAbonos,
    canceladas: canceladasPropias,
    devoluciones: devoluciones.length,
    retiros
  };
}

// Vista del turno. Mientras está ABIERTO, el cajero no ve importes esperados (corte ciego).
async function publico(turno, { verEsperado }) {
  const base = {
    id: turno._id,
    sucursal: turno.sucursal,
    caja: turno.caja,
    cajero: { id: turno.cajero, nombre: turno.cajeroNombre },
    estado: turno.estado,
    apertura: turno.apertura,
    retiros: turno.retiros,
    conteo: turno.estado === 'abierto' ? null : turno.conteo,
    cierre: turno.estado === 'cerrado' ? turno.cierre : null
  };
  if (turno.estado === 'abierto') {
    const calculo = await esperadoDe(turno);
    base.ventas = calculo.ventas;
    if (verEsperado) base.esperado = calculo.esperado;
  }
  return base;
}

async function abrir(alcance, actor, { caja = 1, denominaciones, fondo }) {
  const sucursal = sucursalDeEscritura(alcance);
  const fondoContado = denominaciones?.length ? totalDenominaciones(denominaciones) : fondo;
  if (!Number.isSafeInteger(fondoContado) || fondoContado < 0) throw solicitudInvalida('Indica el fondo inicial (centavos enteros ≥ 0)');
  try {
    const turno = await Turno.create({
      sucursal, caja, cajero: actor._id, cajeroNombre: actor.nombre,
      apertura: { fecha: new Date(), fondo: fondoContado, denominaciones: denominaciones || [] }
    });
    return publico(turno.toObject(), { verEsperado: false });
  } catch (error) {
    if (error.code === 11000) {
      if (error.keyPattern?.cajero) throw conflicto('Ya tienes un turno abierto en esta sucursal', 'TURNO_YA_ABIERTO');
      throw conflicto(`La caja ${caja} ya está abierta por otro cajero`, 'CAJA_OCUPADA');
    }
    throw error;
  }
}

// Turno vigente (abierto o en corte) del usuario en la sucursal activa
async function actual(alcance, actor) {
  const turno = await Turno.findOne(filtroEscritura(alcance, { cajero: actor._id, vigente: true })).lean();
  return turno ? publico(turno, { verEsperado: false }) : null;
}

async function cargarPropio(alcance, actor, id, session, { permitirDueno = true } = {}) {
  const turno = await Turno.findOne(filtroEscritura(alcance, { _id: aId(id) })).session(session || null);
  if (!turno) throw noEncontrado('Turno no encontrado');
  const esDueno = actor.rol === 'dueno';
  if (!turno.cajero.equals(actor._id) && !(permitirDueno && esDueno)) throw sinPermiso('Ese turno es de otro cajero');
  return turno;
}

async function retirar(alcance, actor, id, { monto, motivo, autorizacion }) {
  const sucursal = sucursalDeEscritura(alcance);
  if (!Number.isSafeInteger(monto) || monto <= 0) throw solicitudInvalida('El retiro debe ser en centavos enteros > 0');
  const autorizador = await verificarPin({ ...autorizacion, permiso: 'autorizar:retiro_efectivo', sucursal });
  return conTransaccion(async session => {
    const turno = await cargarPropio(alcance, actor, id, session);
    if (turno.estado !== 'abierto') throw conflicto('El turno ya no está abierto', 'TURNO_NO_ABIERTO');
    const { esperado } = await esperadoDe(turno, session);
    if (monto > esperado.efectivo) throw conflicto('No hay tanto efectivo en la caja', 'EFECTIVO_INSUFICIENTE');
    const retiro = { monto, motivo, usuario: actor._id, autorizadoPor: autorizador.id, fecha: new Date() };
    await Turno.updateOne({ _id: turno._id, sucursal: turno.sucursal, estado: 'abierto' }, { $push: { retiros: retiro }, $set: { ultimoMovimiento: retiro.fecha } }, { session });
    await auditoria.registrar(
      { usuario: actor._id, autorizadoPor: autorizador.id, accion: 'turno.retiro', entidad: 'Turno', entidadId: turno._id, sucursal, despues: { monto }, motivo },
      session
    );
    return { monto, motivo, autorizadoPor: autorizador.nombre };
  });
}

/**
 * Conteo ciego: el cajero captura billetes/monedas, el total de la terminal y las transferencias
 * confirmadas. Se guarda y YA NO se puede recontar. Si todo cuadra, el turno se cierra; si no,
 * queda 'contado' hasta que el dueño autorice con justificación.
 */
async function registrarConteo(alcance, actor, id, { denominaciones, tarjeta, transferencia }) {
  const efectivo = totalDenominaciones(denominaciones);
  for (const [nombre, v] of [['tarjeta', tarjeta], ['transferencia', transferencia]]) {
    if (!Number.isSafeInteger(v) || v < 0) throw solicitudInvalida(`Captura el total de ${nombre} (centavos enteros ≥ 0)`);
  }
  return conTransaccion(async session => {
    const turno = await cargarPropio(alcance, actor, id, session, { permitirDueno: false });
    if (turno.estado !== 'abierto') throw conflicto('El conteo de este turno ya se registró', 'CONTEO_YA_REGISTRADO');
    const calculo = await esperadoDe(turno, session);
    const contado = { efectivo, tarjeta, transferencia };
    const diferencias = Object.fromEntries(METODOS.map(m => [m, contado[m] - calculo.esperado[m]]));
    const cuadra = METODOS.every(m => diferencias[m] === 0);
    const ahora = new Date();
    const cambios = {
      conteo: { fecha: ahora, denominaciones, contado, esperado: calculo.esperado, diferencias, ventas: calculo.ventas, canceladas: calculo.canceladas, abonos: calculo.abonos },
      estado: cuadra ? 'cerrado' : 'contado',
      ultimoMovimiento: ahora,
      ...(cuadra && { vigente: false, cierre: { fecha: ahora } })
    };
    const actualizado = await Turno.findOneAndUpdate({ _id: turno._id, sucursal: turno.sucursal, estado: 'abierto' }, { $set: cambios }, { new: true, session }).lean();
    if (!actualizado) throw conflicto('El conteo de este turno ya se registró', 'CONTEO_YA_REGISTRADO');
    await auditoria.registrar(
      { usuario: actor._id, accion: 'turno.conteo', entidad: 'Turno', entidadId: turno._id, sucursal: turno.sucursal, despues: { contado, esperado: calculo.esperado, diferencias } },
      session
    );
    return publico(actualizado, { verEsperado: true });
  });
}

// Cierre con diferencia: justificación obligatoria + PIN del dueño
async function cerrar(alcance, actor, id, { justificacion, autorizacion }) {
  const sucursal = sucursalDeEscritura(alcance);
  if (!justificacion || justificacion.trim().length < 5) throw solicitudInvalida('Explica la diferencia (mínimo 5 caracteres)');
  const autorizador = await verificarPin({ ...autorizacion, permiso: 'autorizar:diferencia_corte', sucursal });
  return conTransaccion(async session => {
    const turno = await cargarPropio(alcance, actor, id, session);
    if (turno.estado !== 'contado') throw conflicto(turno.estado === 'cerrado' ? 'El turno ya está cerrado' : 'Primero registra el conteo', 'TURNO_NO_CONTADO');
    const cierre = { fecha: new Date(), justificacion: justificacion.trim(), autorizadoPor: autorizador.id, autorizadoPorNombre: autorizador.nombre };
    const actualizado = await Turno.findOneAndUpdate(
      { _id: turno._id, sucursal: turno.sucursal, estado: 'contado' },
      { $set: { estado: 'cerrado', vigente: false, cierre } },
      { new: true, session }
    ).lean();
    await auditoria.registrar(
      { usuario: actor._id, autorizadoPor: autorizador.id, accion: 'turno.cerrar_con_diferencia', entidad: 'Turno', entidadId: turno._id, sucursal, motivo: cierre.justificacion, despues: { diferencias: turno.conteo.diferencias } },
      session
    );
    return publico(actualizado, { verEsperado: true });
  });
}

async function obtener(alcance, actor, id, { verTodos }) {
  const turno = await Turno.findOne(conAlcance({ _id: aId(id) }, alcance)).lean();
  if (!turno) throw noEncontrado('Turno no encontrado');
  if (!verTodos && !turno.cajero.equals(actor._id)) throw noEncontrado('Turno no encontrado');
  return publico(turno, { verEsperado: verTodos });
}

async function listar(alcance, actor, { desde, hasta, estado, pagina = 1, limite = 50 }, { verTodos }) {
  const filtro = {};
  if (!verTodos) filtro.cajero = actor._id;
  if (estado) filtro.estado = estado;
  if (desde || hasta) {
    const { inicio, fin } = rangoDias(desde || '2000-01-01', hasta || diaLocal());
    filtro['apertura.fecha'] = { $gte: inicio, $lt: fin };
  }
  const consulta = conAlcance(filtro, alcance);
  const [lista, total] = await Promise.all([
    Turno.find(consulta).sort({ 'apertura.fecha': -1 }).skip((pagina - 1) * limite).limit(limite).lean(),
    Turno.countDocuments(consulta)
  ]);
  return { datos: await Promise.all(lista.map(t => publico(t, { verEsperado: verTodos }))), total, pagina, limite };
}

// ---- Para el servicio de ventas (dentro de su transacción) ----

// Turno abierto del cajero; lo "toca" para que una venta y el conteo del corte no se crucen.
async function turnoParaVender(sucursal, cajeroId, fecha, session) {
  const turno = await Turno.findOneAndUpdate(
    { sucursal, cajero: cajeroId, estado: 'abierto' },
    { $set: { ultimoMovimiento: fecha } },
    { new: true, session }
  ).lean();
  if (!turno) {
    const enCorte = await Turno.exists({ sucursal, cajero: cajeroId, estado: 'contado' }).session(session);
    if (enCorte) throw new ErrorApp(409, 'Tu turno está en corte: espera a que el dueño lo cierre y abre uno nuevo', 'TURNO_EN_CORTE');
    throw new ErrorApp(409, 'Abre tu turno de caja antes de cobrar', 'TURNO_REQUERIDO');
  }
  return turno;
}

/**
 * Turno al que afecta cancelar una venta:
 *  - si el turno de la venta sigue abierto → ese (la venta simplemente deja de contar);
 *  - si está en corte → no se puede cancelar hasta cerrarlo;
 *  - si ya se cerró (o la venta no tiene turno) → el turno abierto de quien cancela, de donde sale el dinero.
 * Devuelve { turnoDevolucion } (null si el dinero sale del propio turno de la venta).
 */
async function turnoParaCancelar(venta, actorId, fecha, session) {
  if (venta.turno) {
    const propio = await Turno.findOneAndUpdate(
      { _id: venta.turno, sucursal: venta.sucursal, estado: 'abierto' },
      { $set: { ultimoMovimiento: fecha } },
      { session }
    );
    if (propio) return { turnoDevolucion: null };
    const enCorte = await Turno.exists({ _id: venta.turno, sucursal: venta.sucursal, estado: 'contado' }).session(session);
    if (enCorte) throw new ErrorApp(409, 'El turno de esa venta está en corte: ciérralo antes de cancelarla', 'TURNO_EN_CORTE');
  }
  const actual = await Turno.findOneAndUpdate(
    { sucursal: venta.sucursal, cajero: actorId, estado: 'abierto' },
    { $set: { ultimoMovimiento: fecha } },
    { new: true, session }
  ).lean();
  if (!actual) throw new ErrorApp(409, 'El turno de esa venta ya cerró: abre tu turno para devolver el dinero desde tu caja', 'TURNO_REQUERIDO');
  return { turnoDevolucion: actual._id };
}

// Corrección de forma de pago: solo mientras el turno de la venta siga abierto
async function exigirTurnoAbiertoDeVenta(venta, fecha, session) {
  const turno = venta.turno && (await Turno.findOneAndUpdate(
    { _id: venta.turno, sucursal: venta.sucursal, estado: 'abierto' },
    { $set: { ultimoMovimiento: fecha } },
    { session }
  ));
  if (!turno) throw conflicto('La forma de pago solo se corrige mientras el turno de la venta está abierto', 'TURNO_NO_ABIERTO');
}

module.exports = {
  abrir, actual, retirar, registrarConteo, cerrar, obtener, listar, esperadoDe, totalDenominaciones,
  turnoParaVender, turnoParaCancelar, exigirTurnoAbiertoDeVenta, METODOS
};

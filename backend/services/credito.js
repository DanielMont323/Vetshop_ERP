// Crédito de clientes: cargos por ventas a crédito, abonos, bonificación por pronto pago, estado de
// cuenta y cartera por antigüedad. Importes en centavos.
//
// La cuenta es del cliente (global): se puede pagar en cualquier sucursal. Por eso CargoCliente y
// AbonoCliente no llevan el plugin de alcance; todo se filtra por cliente. Lo que sí es por sucursal
// es el DINERO: un abono queda ligado al turno de quien lo recibe y entra a su corte.
//
// Concurrencia: cada venta a crédito y cada abono escribe `cliente.credito.ultimoMovimiento` dentro
// de su transacción, así dos operaciones del mismo cliente se serializan (el límite no se rebasa
// por dos ventas simultáneas y un cargo no se paga dos veces).
const mongoose = require('mongoose');
const Cliente = require('../models/Cliente');
const CargoCliente = require('../models/CargoCliente');
const AbonoCliente = require('../models/AbonoCliente');
const { SERIE_ABONO } = AbonoCliente;
const Turno = require('../models/Turno');
const { siguienteFolio } = require('../models/Contador');
const { conTransaccion } = require('../helpers/transaccion');
const { sucursalDeEscritura } = require('../helpers/alcance');
const { aplicarTasa, sumar } = require('../helpers/dinero');
const { finDeDiaTras, diasParaCaducar, rangoDias } = require('../helpers/fechas');
const { normalizar } = require('../helpers/texto');
const { solicitudInvalida, noEncontrado, conflicto, ErrorApp } = require('../helpers/errores');
const { verificarPin } = require('./autorizaciones');
const auditoria = require('./auditoria');

const aId = id => new mongoose.Types.ObjectId(String(id));

// ---------- Cálculos puros ----------

// Días que lleva vencido un cargo (0 o negativo = al corriente)
const diasVencido = (cargo, ahora = new Date()) => -diasParaCaducar(cargo.vencimiento, ahora);

// Bonificación que le tocaría a un cargo si se liquida en `fecha` (0 si no aplica)
function bonificacionPosible(cargo, fecha = new Date()) {
  const p = cargo.prontoPago || {};
  if (!p.tasa || !p.fechaLimite || cargo.bonificado > 0 || fecha > p.fechaLimite) return 0;
  return Math.min(aplicarTasa(cargo.importe, p.tasa), cargo.saldo);
}

// Cuánto hay que pagar hoy para liquidar el cargo (con la bonificación si aplica)
const paraLiquidar = (cargo, fecha = new Date()) => cargo.saldo - bonificacionPosible(cargo, fecha);

/**
 * Reparte un abono entre cargos (en el orden dado). Si con lo que queda se liquida un cargo dentro
 * del plazo de pronto pago, se le aplica la bonificación. Lo que sobre es un error: no se guardan
 * saldos a favor.
 */
function repartir(monto, cargos, fecha = new Date()) {
  let restante = monto;
  const aplicaciones = [];
  for (const c of cargos) {
    if (restante <= 0) break;
    const bonificacion = bonificacionPosible(c, fecha);
    const liquidar = c.saldo - bonificacion;
    if (bonificacion > 0 && restante >= liquidar) {
      aplicaciones.push({ cargo: c._id, folio: c.folio, monto: liquidar, bonificacion });
      restante -= liquidar;
    } else {
      const m = Math.min(restante, c.saldo);
      aplicaciones.push({ cargo: c._id, folio: c.folio, monto: m, bonificacion: 0 });
      restante -= m;
    }
  }
  if (restante > 0) {
    const maximo = sumar(cargos.map(c => paraLiquidar(c, fecha)));
    throw new ErrorApp(409, 'El abono es mayor que lo que debe el cliente', 'ABONO_EXCEDE_SALDO', { maximo });
  }
  return aplicaciones;
}

// ---------- Consultas ----------

async function cargosPendientes(clienteId, session) {
  return CargoCliente.find({ cliente: aId(clienteId), estado: 'pendiente' }).sort({ vencimiento: 1, fecha: 1 }).session(session || null).lean();
}

function resumir(cliente, pendientes, ahora = new Date()) {
  const saldo = sumar(pendientes.map(c => c.saldo));
  const vencido = sumar(pendientes.filter(c => diasVencido(c, ahora) > 0).map(c => c.saldo));
  const limite = cliente.credito?.limite || 0;
  return { saldo, vencido, limite, disponible: Math.max(0, limite - saldo) };
}

const condiciones = c => ({
  activo: Boolean(c.credito?.activo),
  limite: c.credito?.limite || 0,
  dias: c.credito?.dias ?? 30,
  bonificacionProntoPago: c.credito?.bonificacionProntoPago || 0,
  diasProntoPago: c.credito?.diasProntoPago ?? 8
});

/**
 * Revisión ANTES de cobrar (fuera de la transacción): ¿este cliente puede llevarse `importe` a crédito?
 * Devuelve { requiereAutorizacion, motivo, resumen }. Lanza si el cliente no tiene crédito.
 */
async function evaluar(cliente, importe, session) {
  if (cliente.esPublicoGeneral || !cliente.credito?.activo) {
    throw conflicto(`${cliente.nombre} no tiene crédito autorizado`, 'SIN_CREDITO');
  }
  const resumen = resumir(cliente, await cargosPendientes(cliente._id, session));
  const motivos = [];
  if (resumen.vencido > 0) motivos.push('tiene saldo vencido');
  if (resumen.saldo + importe > resumen.limite) motivos.push('rebasa su límite de crédito');
  return { requiereAutorizacion: motivos.length > 0, motivo: motivos.join(' y '), resumen };
}

// ---------- Dentro de la transacción de la venta ----------

/** Crea el cargo de la parte a crédito de una venta. `autorizado`: hubo PIN para rebasar límite/vencido. */
async function cargarEnVenta({ cliente, sucursal, ventaId, folio, importe, fecha, autorizado }, session) {
  const c = await Cliente.findOneAndUpdate({ _id: cliente._id }, { $set: { 'credito.ultimoMovimiento': fecha } }, { new: true, session }).lean();
  const ev = await evaluar(c, importe, session);
  if (ev.requiereAutorizacion && !autorizado) {
    throw new ErrorApp(409, `${c.nombre} ${ev.motivo}: se requiere autorización del dueño`, 'CREDITO_REQUIERE_AUTORIZACION', ev.resumen);
  }
  const cond = condiciones(c);
  const [cargo] = await CargoCliente.create(
    [{
      cliente: c._id, clienteNombre: c.nombre, sucursal, venta: ventaId, folio, fecha,
      vencimiento: finDeDiaTras(fecha, cond.dias),
      prontoPago: cond.bonificacionProntoPago > 0 ? { tasa: cond.bonificacionProntoPago, fechaLimite: finDeDiaTras(fecha, cond.diasProntoPago) } : { tasa: 0 },
      importe, saldo: importe
    }],
    { session }
  );
  return cargo;
}

/** Al cancelar una venta a crédito: su cargo se cancela, solo si no tiene abonos. */
async function cancelarEnVenta({ ventaId, usuario, fecha }, session) {
  const cargo = await CargoCliente.findOne({ venta: ventaId }).session(session).lean();
  if (!cargo) return null;
  if (cargo.abonado > 0 || cargo.bonificado > 0) {
    throw conflicto(`La venta ${cargo.folio} ya tiene abonos: cancela primero los abonos`, 'CARGO_CON_ABONOS');
  }
  await Cliente.updateOne({ _id: cargo.cliente }, { $set: { 'credito.ultimoMovimiento': fecha } }, { session });
  const r = await CargoCliente.updateOne(
    { _id: cargo._id, estado: 'pendiente', abonado: 0, bonificado: 0 },
    { $set: { estado: 'cancelado', saldo: 0, cancelacion: { fecha, usuario } } },
    { session }
  );
  if (r.modifiedCount !== 1) throw conflicto(`La venta ${cargo.folio} ya tiene abonos: cancela primero los abonos`, 'CARGO_CON_ABONOS');
  return cargo;
}

// ---------- Abonos ----------

const publicoAbono = a => ({
  id: a._id,
  serie: a.serie,
  folio: a.folio,
  cliente: { id: a.cliente, nombre: a.clienteNombre },
  sucursal: a.sucursal,
  turno: a.turno || null,
  fecha: a.fecha,
  metodo: a.metodo,
  referencia: a.referencia || '',
  monto: a.monto,
  bonificacion: a.bonificacion,
  aplicaciones: a.aplicaciones,
  usuario: { id: a.usuario, nombre: a.usuarioNombre },
  estado: a.estado,
  cancelacion: a.estado === 'cancelado' ? a.cancelacion : null
});

// Turno donde entra el dinero. Efectivo y tarjeta: obligatorio (van al corte). Transferencia: si lo hay.
async function turnoParaAbono(sucursal, actor, metodo, fecha, session) {
  const turno = await Turno.findOneAndUpdate(
    { sucursal, cajero: actor._id, estado: 'abierto' },
    { $set: { ultimoMovimiento: fecha } },
    { new: true, session }
  ).lean();
  if (turno || metodo === 'transferencia') return turno;
  const enCorte = await Turno.exists({ sucursal, cajero: actor._id, estado: 'contado' }).session(session);
  if (enCorte) throw new ErrorApp(409, 'Tu turno está en corte: espera a que el dueño lo cierre y abre uno nuevo', 'TURNO_EN_CORTE');
  throw new ErrorApp(409, 'Abre tu turno de caja para recibir abonos en efectivo o tarjeta', 'TURNO_REQUERIDO');
}

/**
 * Registrar un abono: { claveOperacion, cliente, monto, metodo, referencia, cargos? }.
 * `cargos` (opcional): ids de los cargos a pagar en ese orden; si no, del que vence primero.
 */
async function registrarAbono(alcance, actor, datos) {
  const sucursal = sucursalDeEscritura(alcance);
  const previo = await AbonoCliente.findOne({ claveOperacion: datos.claveOperacion }).lean();
  if (previo) return { abono: publicoAbono(previo), repetido: true };

  try {
    const abono = await conTransaccion(async session => {
      const fecha = new Date();
      const cliente = await Cliente.findOneAndUpdate({ _id: aId(datos.cliente) }, { $set: { 'credito.ultimoMovimiento': fecha } }, { new: true, session }).lean();
      if (!cliente) throw noEncontrado('Cliente no encontrado');

      let pendientes = await cargosPendientes(cliente._id, session);
      if (datos.cargos?.length) {
        const porId = new Map(pendientes.map(c => [String(c._id), c]));
        const elegidos = [...new Set(datos.cargos.map(String))].map(id => porId.get(id));
        if (elegidos.some(c => !c)) throw solicitudInvalida('Alguno de los cargos no está pendiente o no es de este cliente');
        pendientes = elegidos;
      }
      if (!pendientes.length) throw conflicto(`${cliente.nombre} no tiene saldo pendiente`, 'SIN_SALDO');
      const aplicaciones = repartir(datos.monto, pendientes, fecha);

      for (const ap of aplicaciones) {
        const total = ap.monto + ap.bonificacion;
        const cargo = await CargoCliente.findOneAndUpdate(
          { _id: ap.cargo, estado: 'pendiente', saldo: { $gte: total } },
          { $inc: { abonado: ap.monto, bonificado: ap.bonificacion, saldo: -total } },
          { new: true, session }
        );
        if (!cargo) throw conflicto('La cuenta del cliente cambió mientras se registraba el abono; intenta de nuevo', 'CUENTA_CAMBIO');
        if (cargo.saldo === 0) await CargoCliente.updateOne({ _id: cargo._id }, { $set: { estado: 'pagado' } }, { session });
      }

      const turno = await turnoParaAbono(sucursal, actor, datos.metodo, fecha, session);
      const folio = await siguienteFolio(sucursal, SERIE_ABONO, session);
      const bonificacion = sumar(aplicaciones.map(a => a.bonificacion));
      const [nuevo] = await AbonoCliente.create(
        [{
          cliente: cliente._id, clienteNombre: cliente.nombre, sucursal, serie: SERIE_ABONO, folio,
          turno: turno?._id || null, fecha, metodo: datos.metodo, referencia: datos.referencia,
          monto: datos.monto, bonificacion, aplicaciones,
          usuario: actor._id, usuarioNombre: actor.nombre, claveOperacion: datos.claveOperacion
        }],
        { session }
      );
      if (bonificacion > 0) {
        await auditoria.registrar(
          {
            usuario: actor._id, accion: 'credito.bonificacion_pronto_pago', entidad: 'AbonoCliente', entidadId: nuevo._id, sucursal,
            despues: { cliente: cliente.nombre, folio: `${SERIE_ABONO}-${folio}`, bonificacion, cargos: aplicaciones.filter(a => a.bonificacion > 0).map(a => a.folio) }
          },
          session
        );
      }
      return nuevo;
    });
    return { abono: publicoAbono(abono.toObject()), repetido: false };
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.claveOperacion) {
      const ya = await AbonoCliente.findOne({ claveOperacion: datos.claveOperacion }).lean();
      if (ya) return { abono: publicoAbono(ya), repetido: true };
    }
    throw error;
  }
}

/** Cancelar un abono (se capturó mal): PIN del dueño, en la sucursal donde se recibió y con su turno abierto. */
async function cancelarAbono(alcance, actor, id, { motivo, autorizacion }) {
  const sucursal = sucursalDeEscritura(alcance);
  const autorizador = await verificarPin({ ...autorizacion, permiso: 'autorizar:cancelacion', sucursal });
  return conTransaccion(async session => {
    const fecha = new Date();
    const abono = await AbonoCliente.findOne({ _id: aId(id), sucursal }).session(session).lean();
    if (!abono) throw noEncontrado('Abono no encontrado');
    if (abono.estado !== 'aplicado') throw conflicto('El abono ya está cancelado', 'ABONO_CANCELADO');
    if (abono.turno) {
      const abierto = await Turno.findOneAndUpdate({ _id: abono.turno, sucursal, estado: 'abierto' }, { $set: { ultimoMovimiento: fecha } }, { session });
      if (!abierto) throw conflicto('El turno en que se recibió el abono ya no está abierto: ya no se puede cancelar', 'TURNO_NO_ABIERTO');
    }
    await Cliente.updateOne({ _id: abono.cliente }, { $set: { 'credito.ultimoMovimiento': fecha } }, { session });
    for (const ap of abono.aplicaciones) {
      const total = ap.monto + ap.bonificacion;
      await CargoCliente.updateOne(
        { _id: ap.cargo },
        { $inc: { abonado: -ap.monto, bonificado: -ap.bonificacion, saldo: total }, $set: { estado: 'pendiente' } },
        { session }
      );
    }
    const actualizado = await AbonoCliente.findOneAndUpdate(
      { _id: abono._id, estado: 'aplicado' },
      { $set: { estado: 'cancelado', cancelacion: { fecha, motivo, usuario: actor._id, autorizadoPor: autorizador.id } } },
      { new: true, session }
    ).lean();
    if (!actualizado) throw conflicto('El abono ya está cancelado', 'ABONO_CANCELADO');
    await auditoria.registrar(
      {
        usuario: actor._id, autorizadoPor: autorizador.id, accion: 'credito.cancelar_abono', entidad: 'AbonoCliente', entidadId: abono._id, sucursal, motivo,
        antes: { estado: 'aplicado', monto: abono.monto, bonificacion: abono.bonificacion }, despues: { estado: 'cancelado' }
      },
      session
    );
    return publicoAbono(actualizado);
  });
}

async function obtenerAbono(id) {
  const a = await AbonoCliente.findById(aId(id)).lean();
  if (!a) throw noEncontrado('Abono no encontrado');
  return publicoAbono(a);
}

// ---------- Estado de cuenta y cartera ----------

const publicoCargo = (c, ahora) => ({
  id: c._id,
  folio: c.folio,
  venta: c.venta,
  sucursal: c.sucursal,
  fecha: c.fecha,
  vencimiento: c.vencimiento,
  importe: c.importe,
  abonado: c.abonado,
  bonificado: c.bonificado,
  saldo: c.saldo,
  estado: c.estado,
  diasVencido: c.estado === 'pendiente' ? Math.max(0, diasVencido(c, ahora)) : 0,
  prontoPago: c.prontoPago?.tasa ? { tasa: c.prontoPago.tasa, fechaLimite: c.prontoPago.fechaLimite } : null,
  bonificacionHoy: c.estado === 'pendiente' ? bonificacionPosible(c, ahora) : 0,
  paraLiquidar: c.estado === 'pendiente' ? paraLiquidar(c, ahora) : 0
});

/**
 * Estado de cuenta: condiciones, resumen, cargos pendientes y movimientos (cargos y abonos) con
 * saldo acumulado. `desde`/`hasta` (AAAA-MM-DD) limitan los movimientos; el saldo inicial suma lo anterior.
 */
async function estadoCuenta(clienteId, { desde, hasta } = {}, ahora = new Date()) {
  const cliente = await Cliente.findById(aId(clienteId)).lean();
  if (!cliente) throw noEncontrado('Cliente no encontrado');
  const [cargos, abonos] = await Promise.all([
    CargoCliente.find({ cliente: cliente._id }).sort({ fecha: 1 }).lean(),
    AbonoCliente.find({ cliente: cliente._id }).sort({ fecha: 1 }).lean()
  ]);
  const pendientes = cargos.filter(c => c.estado === 'pendiente').sort((a, b) => a.vencimiento - b.vencimiento);

  const todos = [
    ...cargos.map(c => ({ tipo: 'cargo', id: c._id, fecha: c.fecha, folio: c.folio, cargo: c.importe, abono: 0, bonificacion: 0, cancelado: c.estado === 'cancelado', vencimiento: c.vencimiento })),
    ...abonos.map(a => ({
      tipo: 'abono', id: a._id, fecha: a.fecha, folio: `${a.serie}-${a.folio}`, cargo: 0, abono: a.monto, bonificacion: a.bonificacion,
      cancelado: a.estado === 'cancelado', metodo: a.metodo, referencia: a.referencia || '', aplica: a.aplicaciones.map(x => x.folio)
    }))
  ].sort((a, b) => a.fecha - b.fecha);

  const rango = desde || hasta ? rangoDias(desde || '2000-01-01', hasta || new Date()) : null;
  let saldo = 0;
  let saldoInicial = 0;
  const movimientos = [];
  for (const m of todos) {
    if (!m.cancelado) saldo += m.cargo - m.abono - m.bonificacion;
    if (rango && m.fecha < rango.inicio) saldoInicial = saldo;
    else if (!rango || m.fecha < rango.fin) movimientos.push({ ...m, saldo });
  }

  return {
    cliente: { id: cliente._id, nombre: cliente.nombre, rfc: cliente.rfc || null, telefono: cliente.telefono || '', tipo: cliente.tipo },
    credito: condiciones(cliente),
    resumen: resumir(cliente, pendientes, ahora),
    pendientes: pendientes.map(c => publicoCargo(c, ahora)),
    saldoInicial,
    movimientos
  };
}

const TRAMOS = ['corriente', 'd1_30', 'd31_60', 'mas60'];
const tramo = dias => (dias <= 0 ? 'corriente' : dias <= 30 ? 'd1_30' : dias <= 60 ? 'd31_60' : 'mas60');

/** Cartera por antigüedad: un renglón por cliente con saldo, y totales. */
async function cartera({ q } = {}, ahora = new Date()) {
  const pendientes = await CargoCliente.find({ estado: 'pendiente' }).lean();
  const clientes = new Map(
    (await Cliente.find({ $or: [{ 'credito.activo': true }, { _id: { $in: [...new Set(pendientes.map(c => String(c.cliente)))].map(aId) } }] }).lean()).map(c => [String(c._id), c])
  );
  const filas = new Map();
  for (const c of clientes.values()) {
    filas.set(String(c._id), {
      cliente: { id: c._id, nombre: c.nombre, telefono: c.telefono || '' },
      credito: condiciones(c),
      saldo: 0, corriente: 0, d1_30: 0, d31_60: 0, mas60: 0, cargos: 0, vencimientoMasAntiguo: null
    });
  }
  for (const c of pendientes) {
    const f = filas.get(String(c.cliente));
    if (!f) continue;
    f.saldo += c.saldo;
    f[tramo(diasVencido(c, ahora))] += c.saldo;
    f.cargos += 1;
    if (!f.vencimientoMasAntiguo || c.vencimiento < f.vencimientoMasAntiguo) f.vencimientoMasAntiguo = c.vencimiento;
  }
  const texto = normalizar(q || '');
  const lista = [...filas.values()]
    .filter(f => !texto || normalizar(f.cliente.nombre).includes(texto))
    .map(f => ({ ...f, vencido: f.d1_30 + f.d31_60 + f.mas60, disponible: Math.max(0, f.credito.limite - f.saldo) }))
    .sort((a, b) => b.vencido - a.vencido || b.saldo - a.saldo || a.cliente.nombre.localeCompare(b.cliente.nombre, 'es'));
  const totales = Object.fromEntries(['saldo', ...TRAMOS, 'vencido'].map(k => [k, sumar(lista.map(f => f[k]))]));
  return { datos: lista, totales };
}

module.exports = {
  repartir, bonificacionPosible, paraLiquidar, diasVencido, evaluar, condiciones,
  cargarEnVenta, cancelarEnVenta, registrarAbono, cancelarAbono, obtenerAbono,
  estadoCuenta, cartera, TRAMOS
};

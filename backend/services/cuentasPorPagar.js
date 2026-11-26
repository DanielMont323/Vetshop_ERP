// Cuentas por pagar a proveedores: una por cada compra recibida; pagos (con abonos parciales) del dueño.
// Importes en centavos. Global (sin alcance por sucursal): los pagos se hacen de forma centralizada.
const mongoose = require('mongoose');
const CuentaPorPagar = require('../models/CuentaPorPagar');
const PagoProveedor = require('../models/PagoProveedor');
const Proveedor = require('../models/Proveedor');
const Compra = require('../models/Compra');
const Sucursal = require('../models/Sucursal');
const { conTransaccion } = require('../helpers/transaccion');
const { sumar } = require('../helpers/dinero');
const { diasParaCaducar, diaLocal, rangoDias, deHoraLocal } = require('../helpers/fechas');
const { normalizar } = require('../helpers/texto');
const { solicitudInvalida, noEncontrado, conflicto, ErrorApp } = require('../helpers/errores');
const auditoria = require('./auditoria');

const aId = id => new mongoose.Types.ObjectId(String(id));
const DIAS_AVISO = 7;

// ---------- Al recibir una compra (dentro de su transacción) ----------

function datosDeCompra(compra) {
  const contado = compra.condicionPago === 'contado';
  return {
    proveedor: compra.proveedor,
    proveedorNombre: compra.proveedorNombre,
    sucursal: compra.sucursal,
    compra: compra._id,
    folioFactura: compra.folioFactura,
    fechaFactura: compra.fechaFactura,
    condicionPago: compra.condicionPago,
    vencimiento: compra.vencimiento || compra.fechaFactura,
    total: compra.total,
    pagado: contado ? compra.total : 0,
    saldo: contado ? 0 : compra.total,
    estado: contado || compra.total === 0 ? 'pagada' : 'pendiente',
    pagadaAlRecibir: contado
  };
}

/** Crea la cuenta por pagar de una compra recibida (de contado queda ya pagada). */
async function registrarCompra(compra, session) {
  const [cuenta] = await CuentaPorPagar.create([datosDeCompra(compra)], { session });
  return cuenta;
}

/** Para bases con compras recibidas antes de este módulo: crea las cuentas que falten. Seguro de repetir. */
async function generarFaltantes() {
  const existentes = new Set((await CuentaPorPagar.distinct('compra')).map(String));
  const compras = await Compra.find({ estado: 'recibida', sucursal: { $exists: true } }).setOptions({ sinAlcance: true }).lean();
  const faltantes = compras.filter(c => !existentes.has(String(c._id)));
  if (faltantes.length) await CuentaPorPagar.insertMany(faltantes.map(datosDeCompra));
  return faltantes.length;
}

// ---------- Consultas ----------

const tramo = dias => (dias >= 0 ? 'corriente' : dias >= -30 ? 'd1_30' : dias >= -60 ? 'd31_60' : 'mas60');

const publicaCuenta = (c, ahora, sucursales) => {
  const dias = diasParaCaducar(c.vencimiento, ahora);
  return {
    id: c._id,
    proveedor: { id: c.proveedor, nombre: c.proveedorNombre },
    sucursal: { id: c.sucursal, nombre: sucursales?.get(String(c.sucursal)) || '' },
    compra: c.compra,
    folioFactura: c.folioFactura,
    fechaFactura: c.fechaFactura,
    condicionPago: c.condicionPago,
    vencimiento: c.vencimiento,
    total: c.total,
    pagado: c.pagado,
    saldo: c.saldo,
    estado: c.estado,
    pagadaAlRecibir: c.pagadaAlRecibir,
    diasParaVencer: c.estado === 'pendiente' ? dias : null
  };
};

async function nombresSucursales(cuentas) {
  const ids = [...new Set(cuentas.map(c => String(c.sucursal)))].map(aId);
  return new Map((await Sucursal.find({ _id: { $in: ids } }).lean()).map(s => [String(s._id), s.nombre]));
}

/**
 * Facturas (por defecto, las pendientes) con resumen: total pendiente, vencido, por vencer en 7 días
 * y un renglón por proveedor con su antigüedad.
 */
async function listar({ estado = 'pendiente', proveedor, q, desde, hasta } = {}, ahora = new Date()) {
  const filtro = {};
  if (estado !== 'todas') filtro.estado = estado;
  if (proveedor) filtro.proveedor = aId(proveedor);
  if (desde || hasta) {
    const r = rangoDias(desde || '2000-01-01', hasta || diaLocal(ahora));
    filtro.fechaFactura = { $gte: r.inicio, $lt: r.fin };
  }
  let cuentas = await CuentaPorPagar.find(filtro).sort(estado === 'pendiente' ? { vencimiento: 1, fechaFactura: 1 } : { fechaFactura: -1 }).limit(1000).lean();
  const texto = normalizar(q || '');
  if (texto) cuentas = cuentas.filter(c => normalizar(`${c.proveedorNombre} ${c.folioFactura}`).includes(texto));
  const sucursales = await nombresSucursales(cuentas);
  const datos = cuentas.map(c => publicaCuenta(c, ahora, sucursales));

  // Resumen siempre sobre TODO lo pendiente (no depende de los filtros)
  const pendientes = await CuentaPorPagar.find({ estado: 'pendiente' }).lean();
  const porProveedor = new Map();
  const resumen = { pendiente: 0, vencido: 0, venceSemana: 0, facturas: pendientes.length };
  for (const c of pendientes) {
    const dias = diasParaCaducar(c.vencimiento, ahora);
    resumen.pendiente += c.saldo;
    if (dias < 0) resumen.vencido += c.saldo;
    else if (dias <= DIAS_AVISO) resumen.venceSemana += c.saldo;
    const clave = String(c.proveedor);
    if (!porProveedor.has(clave)) {
      porProveedor.set(clave, { proveedor: { id: c.proveedor, nombre: c.proveedorNombre }, saldo: 0, corriente: 0, d1_30: 0, d31_60: 0, mas60: 0, facturas: 0, proximoVencimiento: null });
    }
    const p = porProveedor.get(clave);
    p.saldo += c.saldo;
    p[tramo(dias)] += c.saldo;
    p.facturas += 1;
    if (!p.proximoVencimiento || c.vencimiento < p.proximoVencimiento) p.proximoVencimiento = c.vencimiento;
  }
  const proveedores = [...porProveedor.values()]
    .map(p => ({ ...p, vencido: p.d1_30 + p.d31_60 + p.mas60 }))
    .sort((a, b) => b.vencido - a.vencido || a.proximoVencimiento - b.proximoVencimiento);
  return { datos, resumen, proveedores };
}

const publicoPago = p => ({
  id: p._id,
  proveedor: { id: p.proveedor, nombre: p.proveedorNombre },
  fecha: p.fecha,
  metodo: p.metodo,
  referencia: p.referencia || '',
  nota: p.nota || '',
  monto: p.monto,
  aplicaciones: p.aplicaciones,
  usuario: { id: p.usuario, nombre: p.usuarioNombre },
  estado: p.estado,
  cancelacion: p.estado === 'cancelado' ? p.cancelacion : null
});

async function listarPagos({ proveedor, desde, hasta } = {}, ahora = new Date()) {
  const filtro = {};
  if (proveedor) filtro.proveedor = aId(proveedor);
  if (desde || hasta) {
    const r = rangoDias(desde || '2000-01-01', hasta || diaLocal(ahora));
    filtro.fecha = { $gte: r.inicio, $lt: r.fin };
  }
  const pagos = await PagoProveedor.find(filtro).sort({ fecha: -1, _id: -1 }).limit(500).lean();
  return pagos.map(publicoPago);
}

// ---------- Pagos ----------

/** Reparte un pago entre facturas en el orden dado; lo que sobre es un error (no hay saldos a favor). */
function repartir(monto, cuentas) {
  let restante = monto;
  const aplicaciones = [];
  for (const c of cuentas) {
    if (restante <= 0) break;
    const m = Math.min(restante, c.saldo);
    aplicaciones.push({ cuenta: c._id, folioFactura: c.folioFactura, monto: m });
    restante -= m;
  }
  if (restante > 0) {
    throw new ErrorApp(409, 'El pago es mayor que lo que se le debe al proveedor', 'PAGO_EXCEDE_SALDO', { maximo: sumar(cuentas.map(c => c.saldo)) });
  }
  return aplicaciones;
}

// "AAAA-MM-DD" (hoy o antes) → instante; hoy = ahora
function fechaDePago(ymd, ahora) {
  if (!ymd || ymd === diaLocal(ahora)) return ahora;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw solicitudInvalida('Fecha del pago: AAAA-MM-DD');
  if (ymd > diaLocal(ahora)) throw solicitudInvalida('La fecha del pago no puede ser futura');
  return deHoraLocal(Number(m[1]), Number(m[2]), Number(m[3]), 12);
}

/**
 * Registrar un pago: { claveOperacion, proveedor, monto, metodo, referencia, nota, fecha?, cuentas? }.
 * `cuentas` (opcional): facturas a pagar en ese orden; si no, de la que vence primero.
 */
async function registrarPago(actor, datos, ahora = new Date()) {
  const previo = await PagoProveedor.findOne({ claveOperacion: datos.claveOperacion }).lean();
  if (previo) return { pago: publicoPago(previo), repetido: true };
  const fecha = fechaDePago(datos.fecha, ahora);
  try {
    const pago = await conTransaccion(async session => {
      const proveedor = await Proveedor.findById(aId(datos.proveedor)).session(session).lean();
      if (!proveedor) throw noEncontrado('Proveedor no encontrado');
      let pendientes = await CuentaPorPagar.find({ proveedor: proveedor._id, estado: 'pendiente' }).sort({ vencimiento: 1, fechaFactura: 1 }).session(session).lean();
      if (datos.cuentas?.length) {
        const porId = new Map(pendientes.map(c => [String(c._id), c]));
        const elegidas = [...new Set(datos.cuentas.map(String))].map(id => porId.get(id));
        if (elegidas.some(c => !c)) throw solicitudInvalida('Alguna factura no está pendiente o no es de este proveedor');
        pendientes = elegidas;
      }
      if (!pendientes.length) throw conflicto(`No hay facturas pendientes de ${proveedor.nombre}`, 'SIN_SALDO');
      const aplicaciones = repartir(datos.monto, pendientes);

      for (const ap of aplicaciones) {
        const cuenta = await CuentaPorPagar.findOneAndUpdate(
          { _id: ap.cuenta, estado: 'pendiente', saldo: { $gte: ap.monto } },
          { $inc: { pagado: ap.monto, saldo: -ap.monto } },
          { new: true, session }
        );
        if (!cuenta) throw conflicto('Las facturas cambiaron mientras se registraba el pago; intenta de nuevo', 'CUENTA_CAMBIO');
        if (cuenta.saldo === 0) await CuentaPorPagar.updateOne({ _id: cuenta._id }, { $set: { estado: 'pagada' } }, { session });
      }
      const [nuevo] = await PagoProveedor.create(
        [{
          proveedor: proveedor._id, proveedorNombre: proveedor.nombre, fecha, metodo: datos.metodo, referencia: datos.referencia, nota: datos.nota,
          monto: datos.monto, aplicaciones, usuario: actor._id, usuarioNombre: actor.nombre, claveOperacion: datos.claveOperacion
        }],
        { session }
      );
      await auditoria.registrar(
        {
          usuario: actor._id, accion: 'proveedor.pago', entidad: 'PagoProveedor', entidadId: nuevo._id,
          despues: { proveedor: proveedor.nombre, monto: datos.monto, metodo: datos.metodo, facturas: aplicaciones.map(a => a.folioFactura) }
        },
        session
      );
      return nuevo;
    });
    return { pago: publicoPago(pago.toObject()), repetido: false };
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.claveOperacion) {
      const ya = await PagoProveedor.findOne({ claveOperacion: datos.claveOperacion }).lean();
      if (ya) return { pago: publicoPago(ya), repetido: true };
    }
    throw error;
  }
}

/** Cancelar un pago (se registró mal): las facturas vuelven a quedar pendientes. Queda en bitácora. */
async function cancelarPago(actor, id, { motivo }) {
  return conTransaccion(async session => {
    const fecha = new Date();
    const pago = await PagoProveedor.findOneAndUpdate(
      { _id: aId(id), estado: 'aplicado' },
      { $set: { estado: 'cancelado', cancelacion: { fecha, motivo, usuario: actor._id } } },
      { new: true, session }
    ).lean();
    if (!pago) {
      if (!(await PagoProveedor.exists({ _id: aId(id) }))) throw noEncontrado('Pago no encontrado');
      throw conflicto('El pago ya está cancelado', 'PAGO_CANCELADO');
    }
    for (const ap of pago.aplicaciones) {
      await CuentaPorPagar.updateOne({ _id: ap.cuenta }, { $inc: { pagado: -ap.monto, saldo: ap.monto }, $set: { estado: 'pendiente' } }, { session });
    }
    await auditoria.registrar(
      {
        usuario: actor._id, accion: 'proveedor.cancelar_pago', entidad: 'PagoProveedor', entidadId: pago._id, motivo,
        antes: { estado: 'aplicado', monto: pago.monto, facturas: pago.aplicaciones.map(a => a.folioFactura) }, despues: { estado: 'cancelado' }
      },
      session
    );
    return publicoPago(pago);
  });
}

// Para el tablero: facturas vencidas y por vencer en los próximos 7 días
async function alertas(ahora = new Date()) {
  const pendientes = await CuentaPorPagar.find({ estado: 'pendiente' }).select('vencimiento').lean();
  let vencidas = 0;
  let porVencer = 0;
  for (const c of pendientes) {
    const dias = diasParaCaducar(c.vencimiento, ahora);
    if (dias < 0) vencidas += 1;
    else if (dias <= DIAS_AVISO) porVencer += 1;
  }
  return { facturasVencidas: vencidas, facturasPorVencer: porVencer };
}

module.exports = { registrarCompra, generarFaltantes, listar, listarPagos, registrarPago, cancelarPago, repartir, alertas, DIAS_AVISO };

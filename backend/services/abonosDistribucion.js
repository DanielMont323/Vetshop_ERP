// Abonos de clientes de distribución (Paso 24): qué ventas y facturas cubrió un abono, el saldo que queda
// (para el mensaje de WhatsApp) y el complemento de pago automático de las facturas PPD.
//
// El complemento se timbra DESPUÉS del abono (el abono ya quedó registrado aunque el PAC falle). Si falla,
// queda «error» en el abono y se puede reintentar. Un mismo abono no timbra dos veces la misma factura.
const mongoose = require('mongoose');
const AbonoCliente = require('../models/AbonoCliente');
const CargoCliente = require('../models/CargoCliente');
const Cliente = require('../models/Cliente');
const Venta = require('../models/Venta');
const Factura = require('../models/Factura');
const sat = require('../config/sat');
const { noEncontrado } = require('../helpers/errores');
const { sumar } = require('../helpers/dinero');

const aId = id => new mongoose.Types.ObjectId(String(id));
const enCualquierSucursal = { sucursal: { $exists: true } };

// Factura de cada cargo del abono (por la venta)
async function facturasDeAplicaciones(aplicaciones) {
  const cargos = await CargoCliente.find({ _id: { $in: aplicaciones.map(a => a.cargo) } }, { venta: 1 }).lean();
  const ventaDeCargo = new Map(cargos.map(c => [String(c._id), c.venta]));
  const ventas = await Venta.find({ _id: { $in: cargos.map(c => c.venta) }, ...enCualquierSucursal }, { factura: 1 }).lean();
  const facturaDeVenta = new Map(ventas.filter(v => v.factura).map(v => [String(v._id), v.factura]));
  const facturas = await Factura.find({ _id: { $in: [...facturaDeVenta.values()] }, ...enCualquierSucursal }).lean();
  const porId = new Map(facturas.map(f => [String(f._id), f]));
  return aplicaciones.map(a => {
    const venta = ventaDeCargo.get(String(a.cargo));
    const facturaId = venta && facturaDeVenta.get(String(venta));
    return { ...a, venta, factura: facturaId ? porId.get(String(facturaId)) : null };
  });
}

const facturaCorta = f => (f ? { id: f._id, folio: `${f.serie}-${f.folio}`, uuid: f.uuid || null, metodoPago: f.metodoPago, estado: f.estado, saldo: f.saldo ?? null } : null);

// Para el mensaje de WhatsApp y la pantalla: ventas cubiertas, sus facturas, complementos y el saldo que queda
async function detalle(abonoId) {
  const abono = await AbonoCliente.findById(aId(abonoId)).lean();
  if (!abono) throw noEncontrado('Abono no encontrado');
  const [aplicaciones, cliente, pendientes] = await Promise.all([
    facturasDeAplicaciones(abono.aplicaciones),
    Cliente.findById(abono.cliente, { nombre: 1, whatsapp: 1, telefono: 1 }).lean(),
    CargoCliente.find({ cliente: abono.cliente, estado: 'pendiente' }, { saldo: 1 }).lean()
  ]);
  return {
    abono: { id: abono._id, folio: `${abono.serie}-${abono.folio}`, fecha: abono.fecha, metodo: abono.metodo, monto: abono.monto, bonificacion: abono.bonificacion, estado: abono.estado },
    cliente: { id: cliente._id, nombre: cliente.nombre, whatsapp: cliente.whatsapp || '', telefono: cliente.telefono || '' },
    ventas: aplicaciones.map(a => ({ folio: a.folio, monto: a.monto, bonificacion: a.bonificacion, factura: facturaCorta(a.factura) })),
    complementos: (abono.complementos || []).map(c => ({ factura: c.factura, folioFactura: c.folioFactura, monto: c.monto, estado: c.estado, folio: c.folio || null, uuid: c.uuid || null, mensaje: c.mensaje || '' })),
    saldo: sumar(pendientes.map(c => c.saldo))
  };
}

// Timbra el complemento de pago de cada factura PPD que cubrió el abono (las que no tengan ya uno timbrado)
async function emitirComplementos(actor, abonoId) {
  const facturacion = require('./facturacion'); // evita la dependencia circular al cargar
  const abono = await AbonoCliente.findById(aId(abonoId)).lean();
  if (!abono || abono.estado !== 'aplicado') return [];
  const aplicaciones = await facturasDeAplicaciones(abono.aplicaciones);
  const porFactura = new Map();
  for (const a of aplicaciones) {
    const f = a.factura;
    if (!f || f.tipo !== 'I' || f.metodoPago !== 'PPD' || f.estado !== 'timbrada' || !(f.saldo > 0)) continue;
    const clave = String(f._id);
    if (!porFactura.has(clave)) porFactura.set(clave, { factura: f, monto: 0 });
    porFactura.get(clave).monto += a.monto;
  }
  const previos = abono.complementos || [];
  const resultados = [];
  for (const [clave, { factura, monto }] of porFactura) {
    if (previos.some(c => String(c.factura) === clave && c.estado === 'timbrado')) continue;
    const intento = previos.filter(c => String(c.factura) === clave).length + 1;
    const importe = Math.min(monto, factura.saldo);
    const base = { factura: factura._id, folioFactura: `${factura.serie}-${factura.folio}`, monto: importe };
    try {
      const { factura: cp } = await facturacion.complementoPago(
        { sucursalActiva: factura.sucursal, permitidas: 'todas', esDueno: true },
        actor,
        factura._id,
        { claveOperacion: `abono-${abono._id}-${clave}-${intento}`, monto: importe, formaPago: sat.FORMA_POR_METODO[abono.metodo] }
      );
      resultados.push({ ...base, estado: 'timbrado', complemento: cp.id, folio: `${cp.serie}-${cp.folio}`, uuid: cp.uuid });
    } catch (error) {
      resultados.push({ ...base, estado: 'error', mensaje: String(error.message).slice(0, 300) });
    }
  }
  if (resultados.length) await AbonoCliente.updateOne({ _id: abono._id }, { $push: { complementos: { $each: resultados } } });
  return resultados;
}

// ¿El abono tiene complementos de pago vigentes? (entonces no se puede cancelar sin cancelarlos antes)
async function complementosVigentes(abono) {
  const ids = (abono.complementos || []).filter(c => c.estado === 'timbrado' && c.complemento).map(c => c.complemento);
  if (!ids.length) return [];
  return Factura.find({ _id: { $in: ids }, estado: 'timbrada', ...enCualquierSucursal }, { serie: 1, folio: 1 }).lean();
}

module.exports = { detalle, emitirComplementos, complementosVigentes };

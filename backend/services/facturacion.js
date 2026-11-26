// Facturación CFDI 4.0: factura a cliente desde ventas, factura global de público en general, autofactura,
// notas de crédito, complementos de pago, cancelación, XML y representación impresa.
//
// Flujo de emisión (igual para todos los tipos):
//   1. Transacción: folio, factura «pendiente» y reserva (ventas marcadas con la factura, saldo de la PPD…).
//   2. Llamada al PAC (fuera de la transacción: no se puede deshacer una llamada externa).
//   3. Éxito → «timbrada» con UUID y XML guardado. Error → otra transacción libera la reserva y la factura queda
//      en «error» con el mensaje del PAC (el folio no se reutiliza).
const mongoose = require('mongoose');
const Factura = require('../models/Factura');
const Venta = require('../models/Venta');
const Cliente = require('../models/Cliente');
const Producto = require('../models/Producto');
const Sucursal = require('../models/Sucursal');
const IntentoAutofactura = require('../models/IntentoAutofactura');
const { siguienteFolio } = require('../models/Contador');
const { conTransaccion } = require('../helpers/transaccion');
const { conAlcance, sucursalDeEscritura } = require('../helpers/alcance');
const { rangoDias, rangoDia, diaLocal } = require('../helpers/fechas');
const { sumar, dividirRedondeado } = require('../helpers/dinero');
const { solicitudInvalida, noEncontrado, conflicto, ErrorApp, demasiadosIntentos } = require('../helpers/errores');
const sat = require('../config/sat');
const pac = require('./pac');
const almacenamiento = require('./almacenamiento');
const { verificarPin } = require('./autorizaciones');
const auditoria = require('./auditoria');

const aId = id => new mongoose.Types.ObjectId(String(id));
const SERIES = { I: 'F', E: 'NC', P: 'CP' };
const MAX_INTENTOS_AUTOFACTURA = 10;

// ---------- Vista ----------

const publica = f => ({
  id: f._id, sucursal: f.sucursal, tipo: f.tipo, modalidad: f.modalidad, serie: f.serie, folio: f.folio, folioCompleto: `${f.serie}-${f.folio}`,
  receptor: f.receptor, ventas: f.ventas || [], global: f.global?.periodicidad ? f.global : null, conceptos: f.conceptos,
  subtotal: f.subtotal, iva: f.iva, total: f.total, formaPago: f.formaPago, metodoPago: f.metodoPago,
  relacionados: f.relacionados?.uuids?.length ? f.relacionados : null, pago: f.tipo === 'P' ? f.pago : null,
  saldo: f.saldo ?? null, parcialidades: f.parcialidades || 0, acreditado: f.acreditado || 0,
  estado: f.estado, uuid: f.uuid || null, pac: f.pac?.proveedor || null, fechaTimbrado: f.fechaTimbrado || null, error: f.error || null,
  cancelacion: f.estado === 'cancelada' ? f.cancelacion : null, creada: f.createdAt
});

// ---------- Armado de conceptos ----------

async function clavesDe(productoIds) {
  const lista = await Producto.find({ _id: { $in: [...new Set(productoIds.map(String))].map(aId) } }).select('claveSat claveUnidadSat unidad').lean();
  return new Map(lista.map(p => [String(p._id), p]));
}

// Un concepto por partida de venta (factura a cliente / autofactura)
async function conceptosDeVentas(ventas) {
  const claves = await clavesDe(ventas.flatMap(v => v.partidas.map(p => p.producto)));
  return ventas.flatMap(v =>
    v.partidas.map(p => {
      const prod = claves.get(String(p.producto)) || {};
      return {
        claveSat: prod.claveSat || sat.CLAVE_SIN_CATALOGO,
        claveUnidad: prod.claveUnidadSat || sat.UNIDAD_POR_UNIDAD[p.unidad],
        noIdentificacion: p.sku,
        descripcion: p.nombre,
        cantidad: p.unidad === 'kg' ? p.cantidad / 1000 : p.cantidad,
        importe: p.importe - p.iva,
        iva: p.iva,
        tasaIva: p.tasaIva
      };
    })
  );
}

// Global: un concepto por ticket (y por tasa de IVA), como pide el SAT
function conceptosGlobales(ventas) {
  return ventas.flatMap(v => {
    const porTasa = new Map();
    for (const p of v.partidas) {
      const t = porTasa.get(p.tasaIva) || { importe: 0, iva: 0 };
      t.importe += p.importe - p.iva;
      t.iva += p.iva;
      porTasa.set(p.tasaIva, t);
    }
    return [...porTasa.entries()].map(([tasaIva, t]) => ({
      claveSat: sat.CLAVE_SIN_CATALOGO, claveUnidad: 'ACT', noIdentificacion: `${v.serie}-${v.folio}`, descripcion: 'Venta', cantidad: 1, importe: t.importe, iva: t.iva, tasaIva
    }));
  });
}

const totalesDe = conceptos => {
  const subtotal = sumar(conceptos.map(c => c.importe));
  const iva = sumar(conceptos.map(c => c.iva));
  return { subtotal, iva, total: subtotal + iva };
};

// Forma de pago: la de mayor monto (efectivo sin el cambio). Con parte a crédito: PPD y «99 Por definir».
function formaYMetodo(ventas) {
  if (ventas.some(v => v.pagos.some(p => p.metodo === 'credito'))) return { formaPago: '99', metodoPago: 'PPD' };
  const montos = { efectivo: 0, tarjeta: 0, transferencia: 0 };
  for (const v of ventas) {
    for (const p of v.pagos) montos[p.metodo] += p.monto;
    montos.efectivo -= v.cambio || 0;
  }
  const metodo = Object.entries(montos).sort((a, b) => b[1] - a[1])[0][0];
  return { formaPago: sat.FORMA_POR_METODO[metodo], metodoPago: 'PUE' };
}

function receptorDe(cliente, { usoCfdi, email } = {}) {
  const f = cliente.fiscal || {};
  const faltan = [!cliente.rfc && 'RFC', !f.razonSocial && 'razón social', !f.regimen && 'régimen fiscal', !f.codigoPostal && 'código postal'].filter(Boolean);
  if (faltan.length) throw new ErrorApp(409, `Faltan datos fiscales de ${cliente.nombre}: ${faltan.join(', ')}`, 'FALTAN_DATOS_FISCALES', { faltan });
  if (!sat.regimenValidoPara(cliente.rfc, f.regimen)) throw solicitudInvalida(`El régimen ${f.regimen} no corresponde al RFC ${cliente.rfc}`);
  return { cliente: cliente._id, rfc: cliente.rfc, razonSocial: f.razonSocial, regimen: f.regimen, codigoPostal: f.codigoPostal, usoCfdi: usoCfdi || f.usoCfdi || 'G03', email: email || cliente.email || undefined };
}

const publicoGeneral = () => ({ rfc: sat.RFC_PUBLICO_GENERAL, razonSocial: 'PUBLICO EN GENERAL', regimen: '616', codigoPostal: pac.emisor().lugarExpedicion, usoCfdi: 'S01' });

// ---------- Emisión (común) ----------

/**
 * @param d { sucursal, actor, claveOperacion, tipo, modalidad, receptor, ventas, conceptos, formaPago, metodoPago,
 *            global, relacionados, pago, saldo, reservar(session, factura), liberar(session, factura) }
 */
async function emitir(d) {
  const previa = await Factura.findOne({ sucursal: d.sucursal, claveOperacion: d.claveOperacion }).lean();
  if (previa) {
    if (previa.estado === 'error') throw new ErrorApp(422, previa.error, 'PAC_RECHAZO');
    return { factura: publica(previa), repetida: true };
  }
  const totales = d.pago ? { subtotal: 0, iva: 0, total: 0 } : totalesDe(d.conceptos);
  const serie = SERIES[d.tipo];

  let factura;
  try {
    factura = await conTransaccion(async session => {
      const folio = await siguienteFolio(d.sucursal, serie, session);
      const [f] = await Factura.create(
        [{
          sucursal: d.sucursal, tipo: d.tipo, modalidad: d.modalidad, serie, folio, receptor: d.receptor, ventas: d.ventas || [], global: d.global,
          conceptos: d.conceptos || [], ...totales, formaPago: d.formaPago, metodoPago: d.metodoPago, relacionados: d.relacionados, pago: d.pago,
          ...(d.metodoPago === 'PPD' && d.tipo === 'I' && { saldo: totales.total }),
          usuario: d.actor?._id, claveOperacion: d.claveOperacion
        }],
        { session }
      );
      if (d.ventas?.length) {
        const r = await Venta.updateMany({ _id: { $in: d.ventas }, sucursal: d.sucursal, estado: 'cobrada', factura: null }, { $set: { factura: f._id } }, { session });
        if (r.modifiedCount !== d.ventas.length) throw conflicto('Alguna venta ya fue facturada o cancelada; vuelve a cargar la lista', 'VENTAS_NO_FACTURABLES');
      }
      if (d.reservar) await d.reservar(session, f);
      return f.toObject();
    });
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.claveOperacion) return emitir(d);
    throw error;
  }

  let timbre;
  try {
    timbre = await pac.proveedor().timbrar(factura, { emisor: pac.emisor() });
  } catch (error) {
    await conTransaccion(async session => {
      if (factura.ventas.length) await Venta.updateMany({ _id: { $in: factura.ventas }, sucursal: factura.sucursal, factura: factura._id }, { $set: { factura: null } }, { session });
      if (d.liberar) await d.liberar(session, factura);
      await Factura.updateOne({ _id: factura._id, sucursal: factura.sucursal }, { $set: { estado: 'error', error: error.message } }, { session });
    });
    throw error.codigo ? error : new ErrorApp(502, `No se pudo timbrar: ${error.message}`, 'PAC_ERROR');
  }

  const xmlClave = await almacenamiento.guardarGenerado(timbre.xml, { extension: 'xml', prefijo: 'facturas' });
  const timbrada = await Factura.findOneAndUpdate(
    { _id: factura._id, sucursal: factura.sucursal },
    { $set: { estado: 'timbrada', uuid: timbre.uuid, pac: { proveedor: pac.proveedor().nombre, id: timbre.pacId }, fechaTimbrado: timbre.fechaTimbrado, xmlClave } },
    { new: true }
  ).lean();
  // La autofactura no tiene usuario: queda registrada en la propia factura (modalidad «autofactura»)
  if (d.actor) {
    await auditoria.registrar({
      usuario: d.actor._id, accion: `factura.emitir_${d.modalidad}`, entidad: 'Factura', entidadId: factura._id, sucursal: factura.sucursal,
      despues: { folio: `${serie}-${factura.folio}`, uuid: timbre.uuid, rfc: d.receptor.rfc, total: totales.total, ventas: factura.ventas.length }
    });
  }
  return { factura: publica(timbrada), repetida: false };
}

// ---------- Tipos de factura ----------

async function cargarVentas(sucursal, ids) {
  const ventas = await Venta.find({ _id: { $in: [...new Set(ids.map(String))].map(aId) }, sucursal }).lean();
  if (ventas.length !== new Set(ids.map(String)).size) throw noEncontrado('Alguna venta no existe en esta sucursal');
  const malas = ventas.filter(v => v.estado !== 'cobrada' || v.factura);
  if (malas.length) throw conflicto(`No se pueden facturar: ${malas.map(v => `${v.serie}-${v.folio}`).join(', ')} (canceladas o ya facturadas)`, 'VENTAS_NO_FACTURABLES');
  return ventas;
}

/** Factura a un cliente con una o varias ventas de la sucursal (cobradas y sin facturar). */
async function facturarCliente(alcance, actor, { claveOperacion, cliente: clienteId, ventas: ids, usoCfdi, email }) {
  const sucursal = sucursalDeEscritura(alcance);
  const cliente = await Cliente.findById(aId(clienteId)).lean();
  if (!cliente) throw noEncontrado('Cliente no encontrado');
  if (cliente.esPublicoGeneral) throw solicitudInvalida('A «Público en general» se le factura con la factura global');
  const receptor = receptorDe(cliente, { usoCfdi, email });
  const ventas = await cargarVentas(sucursal, ids);
  return emitir({
    sucursal, actor, claveOperacion, tipo: 'I', modalidad: 'cliente', receptor, ventas: ventas.map(v => v._id),
    conceptos: await conceptosDeVentas(ventas), ...formaYMetodo(ventas)
  });
}

/** Factura global de público en general: ventas cobradas sin factura del periodo. */
async function facturarGlobal(alcance, actor, { claveOperacion, periodicidad, desde, hasta }) {
  const sucursal = sucursalDeEscritura(alcance);
  const r = rangoDias(desde, hasta);
  if (desde.slice(0, 7) !== hasta.slice(0, 7)) throw solicitudInvalida('La factura global es de un solo mes');
  if (hasta >= diaLocal()) throw solicitudInvalida('La factura global se emite de días ya cerrados (hasta ayer)');
  const ventas = await Venta.find({ sucursal, estado: 'cobrada', factura: null, fecha: { $gte: r.inicio, $lt: r.fin } }).sort({ folio: 1 }).lean();
  if (!ventas.length) throw conflicto('No hay ventas sin facturar en ese periodo', 'SIN_VENTAS');
  // Las ventas a crédito se facturan al cliente (PPD), no en la global
  const contado = ventas.filter(v => !v.pagos.some(p => p.metodo === 'credito'));
  if (!contado.length) throw conflicto('Las ventas del periodo son a crédito: factúralas a su cliente', 'SIN_VENTAS');
  return emitir({
    sucursal, actor, claveOperacion, tipo: 'I', modalidad: 'global', receptor: publicoGeneral(), ventas: contado.map(v => v._id),
    conceptos: conceptosGlobales(contado), ...formaYMetodo(contado),
    global: { periodicidad: sat.PERIODICIDADES[periodicidad], meses: desde.slice(5, 7), anio: Number(desde.slice(0, 4)) }
  });
}

/**
 * Autofactura (página pública): el cliente da sucursal, folio del ticket y total, y sus datos fiscales.
 * Solo dentro del mes de la venta. Límite de intentos por IP.
 */
async function autofacturar(ip, datos, ahora = new Date()) {
  const fallidos = await IntentoAutofactura.countDocuments({ ip, exito: false });
  if (fallidos >= MAX_INTENTOS_AUTOFACTURA) throw demasiadosIntentos('Demasiados intentos. Espera 15 minutos o pide tu factura en la tienda.');
  const fallo = async mensaje => {
    await IntentoAutofactura.create({ ip });
    throw noEncontrado(mensaje);
  };
  const m = /^(?:V-)?(\d{1,9})$/i.exec(String(datos.folio || '').trim());
  if (!m) return fallo('No encontramos un ticket con esos datos');
  const venta = await Venta.findOne({ sucursal: aId(datos.sucursal), serie: 'V', folio: Number(m[1]) }).lean();
  if (!venta || venta.total !== datos.total || venta.estado !== 'cobrada') return fallo('No encontramos un ticket con esos datos');
  if (diaLocal(venta.fecha).slice(0, 7) !== diaLocal(ahora).slice(0, 7)) throw conflicto('Solo se puede facturar dentro del mes de la compra; pide tu factura en la tienda', 'FUERA_DE_MES');
  if (venta.factura) throw conflicto('Ese ticket ya está facturado', 'VENTA_FACTURADA');
  if (venta.pagos.some(p => p.metodo === 'credito')) throw conflicto('Las ventas a crédito se facturan en la tienda', 'VENTA_A_CREDITO');
  const rfc = String(datos.rfc).trim().toUpperCase();
  if (rfc === sat.RFC_PUBLICO_GENERAL) throw solicitudInvalida('Para facturar escribe tu RFC');
  if (!sat.regimenValidoPara(rfc, datos.regimen)) throw solicitudInvalida(`El régimen ${datos.regimen} no corresponde al RFC ${rfc}`);
  const receptor = { rfc, razonSocial: String(datos.razonSocial).trim().toUpperCase(), regimen: datos.regimen, codigoPostal: datos.codigoPostal, usoCfdi: datos.usoCfdi || 'G03', email: datos.email };
  const r = await emitir({
    sucursal: venta.sucursal, actor: null, claveOperacion: `auto-${venta._id}-${rfc}`, tipo: 'I', modalidad: 'autofactura', receptor, ventas: [venta._id],
    conceptos: await conceptosDeVentas([venta]), ...formaYMetodo([venta])
  });
  await IntentoAutofactura.create({ ip, exito: true });
  return r;
}

/** Nota de crédito (egreso) relacionada a una factura de ingreso timbrada. monto con IVA. */
async function notaCredito(alcance, actor, id, { claveOperacion, monto, descripcion }) {
  const sucursal = sucursalDeEscritura(alcance);
  const original = await Factura.findOne({ _id: aId(id), sucursal }).lean();
  if (!original) throw noEncontrado('Factura no encontrada');
  if (original.tipo !== 'I' || original.estado !== 'timbrada') throw conflicto('Solo se emite nota de crédito de una factura de ingreso vigente', 'FACTURA_NO_VALIDA');
  if (original.modalidad === 'global') throw conflicto('No se emiten notas de crédito a la factura global', 'FACTURA_NO_VALIDA');
  const disponible = original.total - (original.acreditado || 0);
  if (!Number.isSafeInteger(monto) || monto <= 0 || monto > disponible) throw solicitudInvalida(`El monto debe ser de 1 centavo a ${disponible} centavos`);
  const base = original.total ? dividirRedondeado(monto * original.subtotal, original.total) : monto;
  const tasa = original.subtotal ? Math.round(((original.iva * 10000) / original.subtotal) / 100) * 100 : 0;
  return emitir({
    sucursal, actor, claveOperacion, tipo: 'E', modalidad: 'nota_credito', receptor: { ...original.receptor, usoCfdi: 'G02' },
    conceptos: [{ claveSat: '84111506', claveUnidad: 'ACT', descripcion: descripcion || 'Devolución, descuento o bonificación', cantidad: 1, importe: base, iva: monto - base, tasaIva: tasa }],
    formaPago: original.formaPago === '99' ? '15' : original.formaPago, metodoPago: 'PUE',
    relacionados: { tipoRelacion: '01', uuids: [original.uuid], facturas: [original._id] },
    reservar: async session => {
      const r = await Factura.updateOne({ _id: original._id, sucursal, estado: 'timbrada', acreditado: original.acreditado || 0 }, { $inc: { acreditado: monto } }, { session });
      if (r.modifiedCount !== 1) throw conflicto('La factura cambió; intenta de nuevo', 'FACTURA_CAMBIO');
    },
    liberar: async session => Factura.updateOne({ _id: original._id, sucursal }, { $inc: { acreditado: -monto } }, { session })
  });
}

/** Complemento de pago de una factura PPD (venta a crédito): parcialidad, saldo anterior e insoluto. */
async function complementoPago(alcance, actor, id, { claveOperacion, monto, formaPago, fecha }) {
  const sucursal = sucursalDeEscritura(alcance);
  const original = await Factura.findOne({ _id: aId(id), sucursal }).lean();
  if (!original) throw noEncontrado('Factura no encontrada');
  if (original.tipo !== 'I' || original.metodoPago !== 'PPD' || original.estado !== 'timbrada') throw conflicto('Solo las facturas PPD vigentes llevan complemento de pago', 'FACTURA_NO_VALIDA');
  if (!Number.isSafeInteger(monto) || monto <= 0 || monto > original.saldo) throw solicitudInvalida(`El pago debe ser de 1 centavo a ${original.saldo} centavos (saldo)`);
  if (!sat.FORMAS_PAGO[formaPago] || formaPago === '99') throw solicitudInvalida('Forma de pago inválida para el complemento');
  const fechaPago = fecha ? rangoDia(fecha).inicio : new Date();
  const documento = { factura: original._id, uuid: original.uuid, parcialidad: (original.parcialidades || 0) + 1, saldoAnterior: original.saldo, importePagado: monto, saldoInsoluto: original.saldo - monto };
  return emitir({
    sucursal, actor, claveOperacion, tipo: 'P', modalidad: 'pago', receptor: { ...original.receptor, usoCfdi: 'CP01' },
    conceptos: [{ claveSat: '84111506', claveUnidad: 'ACT', descripcion: 'Pago', cantidad: 1, importe: 0, iva: 0, tasaIva: 0 }],
    formaPago: formaPago, metodoPago: 'PUE', pago: { fecha: fechaPago, formaPago, monto, documentos: [documento] },
    reservar: async session => {
      const r = await Factura.updateOne({ _id: original._id, sucursal, estado: 'timbrada', saldo: original.saldo }, { $inc: { saldo: -monto, parcialidades: 1 } }, { session });
      if (r.modifiedCount !== 1) throw conflicto('La factura cambió; intenta de nuevo', 'FACTURA_CAMBIO');
    },
    liberar: async session => Factura.updateOne({ _id: original._id, sucursal }, { $inc: { saldo: monto, parcialidades: -1 } }, { session })
  });
}

// ---------- Cancelación ----------

async function cancelar(alcance, actor, id, { motivo, sustitucion, autorizacion }) {
  const sucursal = sucursalDeEscritura(alcance);
  if (!sat.MOTIVOS_CANCELACION[motivo]) throw solicitudInvalida('Motivo de cancelación del SAT inválido');
  if (motivo === '01' && !sustitucion) throw solicitudInvalida('Con el motivo 01 indica el UUID de la factura que la sustituye');
  const autorizador = await verificarPin({ ...autorizacion, permiso: 'facturacion:cancelar', sucursal });
  const f = await Factura.findOne({ _id: aId(id), sucursal }).lean();
  if (!f) throw noEncontrado('Factura no encontrada');
  if (f.estado !== 'timbrada') throw conflicto('Solo se cancelan facturas timbradas', 'FACTURA_NO_VALIDA');
  if (f.tipo === 'I' && ((f.parcialidades || 0) > 0 || (f.acreditado || 0) > 0)) {
    throw conflicto('Tiene complementos de pago o notas de crédito: cancélalos primero', 'FACTURA_CON_RELACIONADOS');
  }
  const r = await pac.proveedor().cancelar(f, { motivo, sustitucion });
  if (!r.aceptada) throw new ErrorApp(502, 'El SAT no aceptó la cancelación; intenta más tarde', 'CANCELACION_RECHAZADA');
  return conTransaccion(async session => {
    const fecha = new Date();
    const cancelada = await Factura.findOneAndUpdate(
      { _id: f._id, sucursal, estado: 'timbrada' },
      { $set: { estado: 'cancelada', cancelacion: { motivo, sustitucion, fecha, usuario: actor._id, autorizadoPor: autorizador.id } } },
      { new: true, session }
    ).lean();
    if (!cancelada) throw conflicto('La factura ya no está vigente', 'FACTURA_NO_VALIDA');
    // Las ventas quedan libres para volver a facturarse
    if (f.ventas?.length) await Venta.updateMany({ _id: { $in: f.ventas }, sucursal, factura: f._id }, { $set: { factura: null } }, { session });
    // Nota de crédito o complemento cancelados: se devuelve lo que habían descontado de la factura original
    if (f.tipo === 'E') await Factura.updateOne({ _id: f.relacionados.facturas[0], sucursal }, { $inc: { acreditado: -f.total } }, { session });
    if (f.tipo === 'P') {
      for (const d of f.pago.documentos) await Factura.updateOne({ _id: d.factura, sucursal }, { $inc: { saldo: d.importePagado, parcialidades: -1 } }, { session });
    }
    await auditoria.registrar(
      {
        usuario: actor._id, autorizadoPor: autorizador.id, accion: 'factura.cancelar', entidad: 'Factura', entidadId: f._id, sucursal,
        motivo: `${motivo} ${sat.MOTIVOS_CANCELACION[motivo]}`, antes: { estado: 'timbrada', uuid: f.uuid, total: f.total }, despues: { estado: 'cancelada', sustitucion }
      },
      session
    );
    return publica(cancelada);
  });
}

// ---------- Consultas ----------

async function listar(alcance, { desde, hasta, tipo, estado, q, pagina = 1, limite = 50 } = {}) {
  const filtro = {};
  if (desde || hasta) {
    const r = rangoDias(desde || '2000-01-01', hasta || diaLocal());
    filtro.createdAt = { $gte: r.inicio, $lt: r.fin };
  }
  if (tipo) filtro.tipo = tipo;
  if (estado) filtro.estado = estado;
  if (q) {
    const texto = String(q).trim().toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filtro.$or = [{ 'receptor.rfc': { $regex: texto } }, { 'receptor.razonSocial': { $regex: texto } }, { uuid: { $regex: texto } }];
  }
  const consulta = conAlcance(filtro, alcance);
  const [lista, total] = await Promise.all([
    Factura.find(consulta).sort({ createdAt: -1 }).skip((pagina - 1) * limite).limit(limite).select('-conceptos').lean(),
    Factura.countDocuments(consulta)
  ]);
  return { datos: lista.map(publica), total, pagina, limite };
}

async function obtener(alcance, id) {
  const f = await Factura.findOne(conAlcance({ _id: aId(id) }, alcance)).lean();
  if (!f) throw noEncontrado('Factura no encontrada');
  const ventas = f.ventas?.length ? await Venta.find({ _id: { $in: f.ventas }, sucursal: f.sucursal }).select('serie folio total fecha').lean() : [];
  return { ...publica(f), ventasDetalle: ventas.map(v => ({ id: v._id, folio: `${v.serie}-${v.folio}`, total: v.total, fecha: v.fecha })) };
}

// Ventas que se pueden facturar a un cliente (cobradas, sin factura) de la sucursal, de más reciente a más antigua
async function ventasFacturables(alcance, { desde, hasta, folio } = {}) {
  const sucursal = sucursalDeEscritura(alcance);
  const filtro = { sucursal, estado: 'cobrada', factura: null };
  if (folio) filtro.folio = folio;
  else {
    const r = rangoDias(desde || diaLocal(new Date(Date.now() - 30 * 86400000)), hasta || diaLocal());
    filtro.fecha = { $gte: r.inicio, $lt: r.fin };
  }
  const lista = await Venta.find(filtro).sort({ fecha: -1 }).limit(200).select('serie folio total fecha clienteNombre cliente pagos').lean();
  return lista.map(v => ({ id: v._id, folio: `${v.serie}-${v.folio}`, total: v.total, fecha: v.fecha, cliente: { id: v.cliente, nombre: v.clienteNombre }, aCredito: v.pagos.some(p => p.metodo === 'credito') }));
}

async function xml(alcance, id) {
  const f = await Factura.findOne(conAlcance({ _id: aId(id) }, alcance)).lean();
  if (!f?.xmlClave) throw noEncontrado('XML no disponible');
  return { nombre: `${f.serie}-${f.folio}_${f.uuid}.xml`, contenido: await almacenamiento.leer(f.xmlClave) };
}

// Representación impresa: PDF del PAC si lo da; si no (simulado), HTML del sistema
async function representacion(alcance, id) {
  const f = await Factura.findOne(conAlcance({ _id: aId(id) }, alcance)).lean();
  if (!f || !f.uuid) throw noEncontrado('Factura no encontrada');
  const delPac = f.pac?.proveedor && f.pac.proveedor !== 'simulado' ? await pac.proveedor().representacion(f) : null;
  if (delPac) return delPac;
  const sucursal = await Sucursal.findById(f.sucursal).lean();
  const { htmlFactura } = require('../helpers/facturaHtml');
  return { tipo: 'text/html', contenido: htmlFactura(publica(f), { emisor: pac.emisor(), sucursal: sucursal?.nombre || '' }) };
}

// Autofactura: descarga con el UUID como comprobante de que es el dueño de la factura
async function documentoPublico(id, uuid, tipo) {
  const f = await Factura.findOne({ _id: aId(id), sucursal: { $exists: true }, uuid: String(uuid).toUpperCase() }).lean();
  if (!f) throw noEncontrado('Factura no encontrada');
  const alcance = { sucursalActiva: f.sucursal };
  return tipo === 'xml' ? xml(alcance, id) : representacion(alcance, id);
}

async function sucursalesAutofactura() {
  return (await Sucursal.find({ activa: true, tipo: 'tienda' }).select('nombre').sort({ nombre: 1 }).lean()).map(s => ({ id: s._id, nombre: s.nombre }));
}

module.exports = {
  facturarCliente, facturarGlobal, autofacturar, notaCredito, complementoPago, cancelar,
  listar, obtener, ventasFacturables, xml, representacion, documentoPublico, sucursalesAutofactura,
  conceptosGlobales, formaYMetodo
};

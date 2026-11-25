// Recepción de mercancía. Una compra se captura como BORRADOR (editable) y al CONFIRMARLA se crean,
// en una sola transacción, la capa y el movimiento de entrada de cada partida.
const mongoose = require('mongoose');
const Compra = require('../models/Compra');
const Proveedor = require('../models/Proveedor');
const Producto = require('../models/Producto');
const { PUNTOS_BASE_IVA } = Producto;
const { conTransaccion } = require('../helpers/transaccion');
const { conAlcance, sucursalDeEscritura } = require('../helpers/alcance');
const { solicitudInvalida, noEncontrado, conflicto } = require('../helpers/errores');
const { importePartida, aplicarTasa, sumar } = require('../helpers/dinero');
const { deHoraLocal, diaLocal, rangoDias } = require('../helpers/fechas');
const inventario = require('./inventario');
const auditoria = require('./auditoria');

const TEMPERATURA_MIN = 2;
const TEMPERATURA_MAX = 8;
const aId = id => new mongoose.Types.ObjectId(String(id));

// "AAAA-MM-DD" (día en Tepic) → instante UTC del inicio de ese día
function fechaDeFactura(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) throw solicitudInvalida('La fecha de la factura debe ser AAAA-MM-DD');
  const fecha = deHoraLocal(Number(m[1]), Number(m[2]), Number(m[3]));
  if (ymd > diaLocal()) throw solicitudInvalida('La fecha de la factura no puede ser futura');
  return fecha;
}

// Vencimiento: fin del día (Tepic) de fechaFactura + días de crédito
function calcularVencimiento(fechaFactura, dias) {
  const [a, m, d] = diaLocal(fechaFactura).split('-').map(Number);
  const dia = new Date(Date.UTC(a, m - 1, d + dias));
  return deHoraLocal(dia.getUTCFullYear(), dia.getUTCMonth() + 1, dia.getUTCDate(), 23, 59, 59, 999);
}

// Valida y calcula todo lo que se guarda (copias del producto, importes, IVA, vencimiento)
async function armar(datos, session) {
  const proveedor = await Proveedor.findById(datos.proveedor).session(session).lean();
  if (!proveedor) throw noEncontrado('Proveedor no encontrado');
  if (!proveedor.activo) throw solicitudInvalida('El proveedor está desactivado');

  const ids = [...new Set(datos.partidas.map(p => String(p.producto)))];
  const productos = new Map((await Producto.find({ _id: { $in: ids.map(aId) } }).session(session).lean()).map(p => [String(p._id), p]));

  const partidas = datos.partidas.map((p, i) => {
    const producto = productos.get(String(p.producto));
    if (!producto) throw solicitudInvalida(`Partida ${i + 1}: producto no encontrado`);
    if (!producto.activo) throw solicitudInvalida(`Partida ${i + 1}: ${producto.nombre} está desactivado`);
    const { lote, caducidad } = inventario.validarLoteYCaducidad(producto, p);
    const importe = importePartida({ precioUnitario: p.costoUnitario, cantidad: p.cantidad, unidad: producto.unidad });
    const tasaIva = PUNTOS_BASE_IVA[producto.iva];
    const temperatura = p.temperaturaLlegada ?? undefined;
    return {
      producto: producto._id, sku: producto.sku, nombre: producto.nombre, unidad: producto.unidad, tasaIva,
      cantidad: p.cantidad, costoUnitario: p.costoUnitario, importe, iva: aplicarTasa(importe, tasaIva),
      lote, caducidad, temperaturaLlegada: temperatura,
      fueraDeRango: Boolean(producto.requiereRefrigeracion && temperatura !== undefined && (temperatura < TEMPERATURA_MIN || temperatura > TEMPERATURA_MAX))
    };
  });

  const fechaFactura = fechaDeFactura(datos.fechaFactura);
  const credito = datos.condicionPago === 'credito';
  const diasCredito = credito ? datos.diasCredito ?? proveedor.diasCredito : 0;
  const subtotal = sumar(partidas.map(p => p.importe));
  const iva = sumar(partidas.map(p => p.iva));
  return {
    proveedor: proveedor._id,
    proveedorNombre: proveedor.nombre,
    folioFactura: datos.folioFactura,
    fechaFactura,
    condicionPago: datos.condicionPago,
    diasCredito,
    vencimiento: credito ? calcularVencimiento(fechaFactura, diasCredito) : null,
    partidas,
    subtotal,
    iva,
    total: subtotal + iva,
    observaciones: datos.observaciones
  };
}

const publica = c => ({
  id: c._id,
  sucursal: c.sucursal,
  proveedor: { id: c.proveedor, nombre: c.proveedorNombre },
  folioFactura: c.folioFactura,
  fechaFactura: c.fechaFactura,
  condicionPago: c.condicionPago,
  diasCredito: c.diasCredito,
  vencimiento: c.vencimiento,
  partidas: c.partidas,
  subtotal: c.subtotal,
  iva: c.iva,
  total: c.total,
  estado: c.estado,
  observaciones: c.observaciones || '',
  fechaRecepcion: c.fechaRecepcion || null,
  creada: c.createdAt
});

// Filtro para ESCRIBIR: solo en la sucursal activa
const filtroEscritura = (alcance, filtro) => conAlcance(filtro, { ...alcance, sucursalActiva: sucursalDeEscritura(alcance) });

async function crear(alcance, actor, datos) {
  const sucursal = sucursalDeEscritura(alcance);
  return conTransaccion(async session => {
    const [compra] = await Compra.create([{ ...(await armar(datos, session)), sucursal, usuario: actor._id }], { session });
    return publica(compra);
  });
}

async function actualizar(alcance, actor, id, datos) {
  return conTransaccion(async session => {
    const compra = await Compra.findOne(filtroEscritura(alcance, { _id: aId(id) })).session(session);
    if (!compra) throw noEncontrado('Compra no encontrada');
    if (compra.estado !== 'borrador') throw conflicto(`La compra ya está ${compra.estado}; no se puede modificar`, 'COMPRA_NO_EDITABLE');
    compra.set(await armar(datos, session));
    await compra.save({ session });
    return publica(compra);
  });
}

async function listar(alcance, { estado, proveedor, desde, hasta, pagina = 1, limite = 50 } = {}) {
  const filtro = {};
  if (estado) filtro.estado = estado;
  if (proveedor) filtro.proveedor = aId(proveedor);
  if (desde || hasta) {
    const { inicio, fin } = rangoDias(desde || '2000-01-01', hasta || diaLocal());
    filtro.fechaFactura = { $gte: inicio, $lt: fin };
  }
  const consulta = conAlcance(filtro, alcance);
  const [lista, total] = await Promise.all([
    Compra.find(consulta).sort({ fechaFactura: -1, _id: -1 }).skip((pagina - 1) * limite).limit(limite).lean(),
    Compra.countDocuments(consulta)
  ]);
  return {
    datos: lista.map(c => {
      const { partidas, ...resto } = publica(c);
      return { ...resto, numPartidas: partidas.length, alertaTemperatura: partidas.some(p => p.fueraDeRango) };
    }),
    total,
    pagina,
    limite
  };
}

async function obtener(alcance, id) {
  const compra = await Compra.findOne(conAlcance({ _id: aId(id) }, alcance)).lean();
  if (!compra) throw noEncontrado('Compra no encontrada');
  return publica(compra);
}

// Confirma la recepción: crea capas y movimientos de entrada de TODAS las partidas, o de ninguna.
async function confirmar(alcance, actor, id) {
  return conTransaccion(async session => {
    const ahora = new Date();
    // Cambio de estado atómico: dos confirmaciones simultáneas no pueden crear capas dos veces
    const compra = await Compra.findOneAndUpdate(
      filtroEscritura(alcance, { _id: aId(id), estado: 'borrador' }),
      { $set: { estado: 'recibida', recibidoPor: actor._id, fechaRecepcion: ahora } },
      { new: true, session }
    );
    if (!compra) {
      const existe = await Compra.findOne(filtroEscritura(alcance, { _id: aId(id) })).session(session).lean();
      if (!existe) throw noEncontrado('Compra no encontrada');
      throw conflicto(`La compra ya está ${existe.estado}`, 'COMPRA_NO_EDITABLE');
    }

    const capas = {};
    for (const [i, p] of compra.partidas.entries()) {
      const { capa } = await inventario.registrarEntrada(
        {
          sucursal: compra.sucursal, producto: p.producto, cantidad: p.cantidad, costoUnitario: p.costoUnitario,
          lote: p.lote, caducidad: p.caducidad, origen: 'compra',
          referencia: { modelo: 'Compra', id: compra._id, partida: i },
          usuario: actor._id, fecha: ahora
        },
        session
      );
      capas[`partidas.${i}.capa`] = capa._id;
    }
    await Compra.updateOne({ _id: compra._id, sucursal: compra.sucursal }, { $set: capas }, { session });

    await auditoria.registrar(
      {
        usuario: actor._id, accion: 'compra.recibir', entidad: 'Compra', entidadId: compra._id, sucursal: compra.sucursal,
        despues: { proveedor: compra.proveedorNombre, folioFactura: compra.folioFactura, total: compra.total, partidas: compra.partidas.length }
      },
      session
    );
    return publica(await Compra.findOne({ _id: compra._id, sucursal: compra.sucursal }).session(session).lean());
  });
}

async function cancelar(alcance, actor, id, motivo) {
  return conTransaccion(async session => {
    const compra = await Compra.findOneAndUpdate(
      filtroEscritura(alcance, { _id: aId(id), estado: 'borrador' }),
      { $set: { estado: 'cancelada', vigente: false, canceladoPor: actor._id, fechaCancelacion: new Date() } },
      { new: true, session }
    );
    if (!compra) {
      const existe = await Compra.findOne(filtroEscritura(alcance, { _id: aId(id) })).session(session).lean();
      if (!existe) throw noEncontrado('Compra no encontrada');
      throw conflicto(`Solo se cancela un borrador; esta compra está ${existe.estado}`, 'COMPRA_NO_EDITABLE');
    }
    await auditoria.registrar(
      { usuario: actor._id, accion: 'compra.cancelar', entidad: 'Compra', entidadId: compra._id, sucursal: compra.sucursal, motivo, despues: { folioFactura: compra.folioFactura } },
      session
    );
    return publica(compra);
  });
}

module.exports = { crear, actualizar, listar, obtener, confirmar, cancelar, calcularVencimiento, TEMPERATURA_MIN, TEMPERATURA_MAX };

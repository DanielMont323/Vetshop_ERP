// Pedidos a proveedores (Paso 25): alta (a mano o desde compras sugeridas), envío, cancelación y lo que falta por
// surtir. La mercancía entra con una Compra recibida contra el pedido (ver aplicarRecepcion).
const mongoose = require('mongoose');
const PedidoProveedor = require('../models/PedidoProveedor');
const Proveedor = require('../models/Proveedor');
const Producto = require('../models/Producto');
const { siguienteFolio } = require('../models/Contador');
const { conTransaccion } = require('../helpers/transaccion');
const { conAlcance, sucursalDeEscritura } = require('../helpers/alcance');
const { solicitudInvalida, noEncontrado, conflicto } = require('../helpers/errores');
const { importePartida, sumar } = require('../helpers/dinero');
const auditoria = require('./auditoria');

const aId = id => new mongoose.Types.ObjectId(String(id));
const { SERIE_PEDIDO } = PedidoProveedor;
const ABIERTOS = ['enviado', 'parcial'];

const pendienteDe = p => Math.max(0, p.cantidad - (p.recibido || 0));

const publico = p => ({
  id: p._id, sucursal: p.sucursal, folio: `${p.serie}-${p.folio}`, numero: p.folio,
  proveedor: { id: p.proveedor, nombre: p.proveedorNombre },
  partidas: p.partidas.map(x => ({ ...x, pendiente: pendienteDe(x) })),
  totalEstimado: p.totalEstimado, notas: p.notas || '', origen: p.origen, estado: p.estado,
  enviadoEn: p.enviadoEn || null, recibidoEn: p.recibidoEn || null, compras: p.compras || [], creado: p.createdAt
});

async function armar(datos, session) {
  const proveedor = await Proveedor.findById(aId(datos.proveedor)).session(session).lean();
  if (!proveedor) throw noEncontrado('Proveedor no encontrado');
  if (!proveedor.activo) throw solicitudInvalida('El proveedor está desactivado');
  const ids = [...new Set(datos.partidas.map(p => String(p.producto)))];
  if (ids.length !== datos.partidas.length) throw solicitudInvalida('Hay un producto repetido en el pedido');
  const productos = new Map((await Producto.find({ _id: { $in: ids.map(aId) } }).session(session).lean()).map(p => [String(p._id), p]));
  const partidas = datos.partidas.map((p, i) => {
    const prod = productos.get(String(p.producto));
    if (!prod) throw solicitudInvalida(`Partida ${i + 1}: producto no encontrado`);
    return {
      producto: prod._id, sku: prod.sku, nombre: prod.nombre, presentacion: prod.presentacion || undefined, unidad: prod.unidad,
      cantidad: p.cantidad, ...(p.costoEstimado !== undefined && p.costoEstimado !== null && { costoEstimado: p.costoEstimado })
    };
  });
  const totalEstimado = sumar(partidas.map(p => (p.costoEstimado ? importePartida({ precioUnitario: p.costoEstimado, cantidad: p.cantidad, unidad: p.unidad }) : 0)));
  return { proveedor: proveedor._id, proveedorNombre: proveedor.nombre, partidas, totalEstimado, notas: datos.notas };
}

async function listar(alcance, { estado, proveedor } = {}) {
  const filtro = {};
  if (estado === 'abiertos') filtro.estado = { $in: ['borrador', ...ABIERTOS] };
  else if (estado) filtro.estado = estado;
  if (proveedor) filtro.proveedor = aId(proveedor);
  const lista = await PedidoProveedor.find(conAlcance(filtro, alcance)).sort({ createdAt: -1 }).limit(200).lean();
  return lista.map(publico);
}

async function cargar(alcance, id, session) {
  const p = await PedidoProveedor.findOne(conAlcance({ _id: aId(id) }, alcance)).session(session || null);
  if (!p) throw noEncontrado('Pedido no encontrado');
  return p;
}

async function obtener(alcance, id) {
  return publico((await cargar(alcance, id)).toObject());
}

async function crear(alcance, actor, datos) {
  const sucursal = sucursalDeEscritura(alcance);
  return conTransaccion(async session => {
    const folio = await siguienteFolio(sucursal, SERIE_PEDIDO, session);
    const [p] = await PedidoProveedor.create([{ ...(await armar(datos, session)), sucursal, folio, origen: datos.origen || 'manual', usuario: actor._id }], { session });
    await auditoria.registrar({ usuario: actor._id, accion: 'pedido.crear', entidad: 'PedidoProveedor', entidadId: p._id, sucursal, despues: { folio: `${SERIE_PEDIDO}-${folio}`, proveedor: p.proveedorNombre, partidas: p.partidas.length } }, session);
    return publico(p.toObject());
  });
}

async function actualizar(alcance, actor, id, datos) {
  sucursalDeEscritura(alcance);
  return conTransaccion(async session => {
    const p = await cargar(alcance, id, session);
    if (p.estado !== 'borrador') throw conflicto(`El pedido ya está ${p.estado}; no se puede modificar`, 'PEDIDO_NO_EDITABLE');
    p.set(await armar(datos, session));
    await p.save({ session });
    return publico(p.toObject());
  });
}

async function enviar(alcance, actor, id) {
  sucursalDeEscritura(alcance);
  const p = await PedidoProveedor.findOneAndUpdate(
    conAlcance({ _id: aId(id), estado: 'borrador' }, alcance),
    { $set: { estado: 'enviado', enviadoEn: new Date() } },
    { new: true }
  ).lean();
  if (!p) {
    const existe = await cargar(alcance, id);
    throw conflicto(`El pedido ya está ${existe.estado}`, 'PEDIDO_NO_EDITABLE');
  }
  await auditoria.registrar({ usuario: actor._id, accion: 'pedido.enviar', entidad: 'PedidoProveedor', entidadId: p._id, sucursal: p.sucursal });
  return publico(p);
}

async function cancelar(alcance, actor, id, motivo) {
  sucursalDeEscritura(alcance);
  const p = await PedidoProveedor.findOneAndUpdate(
    conAlcance({ _id: aId(id), estado: { $in: ['borrador', ...ABIERTOS] } }, alcance),
    { $set: { estado: 'cancelado', cancelacion: { fecha: new Date(), motivo, usuario: actor._id } } },
    { new: true }
  ).lean();
  if (!p) {
    const existe = await cargar(alcance, id);
    throw conflicto(`El pedido ya está ${existe.estado}`, 'PEDIDO_NO_EDITABLE');
  }
  await auditoria.registrar({ usuario: actor._id, accion: 'pedido.cancelar', entidad: 'PedidoProveedor', entidadId: p._id, sucursal: p.sucursal, motivo });
  return publico(p);
}

// Al crear o editar una compra contra un pedido: mismo proveedor y sucursal, y el pedido abierto
async function validarParaCompra(sucursal, pedidoId, proveedorId, session) {
  const p = await PedidoProveedor.findOne({ _id: aId(pedidoId), sucursal }).session(session).lean();
  if (!p) throw noEncontrado('Pedido no encontrado en esta sucursal');
  if (!ABIERTOS.includes(p.estado)) throw conflicto(`El pedido ${p.serie}-${p.folio} está ${p.estado}: solo se recibe contra pedidos enviados`, 'PEDIDO_NO_ABIERTO');
  if (!p.proveedor.equals(proveedorId)) throw solicitudInvalida(`El pedido ${p.serie}-${p.folio} es de ${p.proveedorNombre}`);
  return p;
}

// Compra confirmada contra el pedido: suma lo recibido por producto y deja el pedido parcial o recibido
async function aplicarRecepcion(compra, session) {
  const p = await PedidoProveedor.findOne({ _id: compra.pedido, sucursal: compra.sucursal }).session(session);
  if (!p) return;
  if (!ABIERTOS.includes(p.estado)) throw conflicto(`El pedido ${p.serie}-${p.folio} ya está ${p.estado}`, 'PEDIDO_NO_ABIERTO');
  const recibido = new Map();
  for (const x of compra.partidas) recibido.set(String(x.producto), (recibido.get(String(x.producto)) || 0) + x.cantidad);
  for (const x of p.partidas) x.recibido = (x.recibido || 0) + (recibido.get(String(x.producto)) || 0);
  const completo = p.partidas.every(x => pendienteDe(x) === 0);
  p.estado = completo ? 'recibido' : 'parcial';
  if (completo) p.recibidoEn = new Date();
  p.compras.push(compra._id);
  await p.save({ session });
}

// Lo que falta por surtir de los pedidos abiertos de la sucursal (para «en camino» de compras sugeridas)
async function pendientesPorProducto(sucursal) {
  const pedidos = await PedidoProveedor.find({ sucursal, estado: { $in: ABIERTOS } }).select('partidas').lean();
  const r = new Map();
  for (const p of pedidos) for (const x of p.partidas) r.set(String(x.producto), (r.get(String(x.producto)) || 0) + pendienteDe(x));
  return r;
}

module.exports = { listar, obtener, crear, actualizar, enviar, cancelar, validarParaCompra, aplicarRecepcion, pendientesPorProducto, publico };

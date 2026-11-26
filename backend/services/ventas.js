// Punto de venta: cobrar, consultar y cancelar ventas, y ventas en espera.
//
// Cobrar (una transacción): precio según la lista del cliente (lo decide el SERVIDOR, nunca la caja),
// descuentos con PIN del dueño, pagos mixtos con cambio en efectivo, consumo FEFO con lotes y costo
// copiados en cada partida, folio por sucursal sin huecos. Un reintento con la misma claveOperacion
// devuelve la venta ya cobrada en lugar de cobrar dos veces.
const mongoose = require('mongoose');
const Venta = require('../models/Venta');
const VentaEnEspera = require('../models/VentaEnEspera');
const Producto = require('../models/Producto');
const Cliente = require('../models/Cliente');
const { siguienteFolio } = require('../models/Contador');
const { conTransaccion } = require('../helpers/transaccion');
const { conAlcance, sucursalDeEscritura } = require('../helpers/alcance');
const { solicitudInvalida, noEncontrado, conflicto, sinPermiso, ErrorApp } = require('../helpers/errores');
const { rangoDia, rangoDias, diaLocal } = require('../helpers/fechas');
const { calcularPartida, totales, calcularPagos } = require('./calculoVenta');
const { resolverPrecio } = require('./precios');
const { publicoGeneral } = require('./clientes');
const inventario = require('./inventario');
const recetas = require('./recetas');
const turnos = require('./turnos');
const { verificarPin } = require('./autorizaciones');
const auditoria = require('./auditoria');
const credito = require('./credito');
const { tienePermiso } = require('../config/permisos');

const SERIE_VENTA = 'V';
const MAX_PARTIDAS = 100;
const aId = id => new mongoose.Types.ObjectId(String(id));
const filtroEscritura = (alcance, filtro) => conAlcance(filtro, { ...alcance, sucursalActiva: sucursalDeEscritura(alcance) });

async function cargarCliente(clienteId, session) {
  if (!clienteId) return publicoGeneral(session);
  const cliente = await Cliente.findById(clienteId).session(session).lean();
  if (!cliente) throw noEncontrado('Cliente no encontrado');
  if (!cliente.activo) throw solicitudInvalida(`El cliente ${cliente.nombre} está desactivado`);
  return cliente;
}

// Calcula las partidas con precios del servidor. No toca inventario.
async function armarPartidas(entradas, listaPrecios, session) {
  if (!Array.isArray(entradas) || entradas.length === 0) throw solicitudInvalida('La venta no tiene productos');
  if (entradas.length > MAX_PARTIDAS) throw solicitudInvalida(`Máximo ${MAX_PARTIDAS} partidas por venta`);
  const ids = [...new Set(entradas.map(e => String(e.producto)))].map(aId);
  const productos = new Map((await Producto.find({ _id: { $in: ids } }).session(session).lean()).map(p => [String(p._id), p]));
  const partidas = [];
  for (const e of entradas) {
    const producto = productos.get(String(e.producto));
    if (!producto) throw noEncontrado('Producto no encontrado');
    if (!producto.activo) throw solicitudInvalida(`${producto.nombre} está desactivado`);
    const precio = await resolverPrecio(producto._id, listaPrecios, session);
    if (!precio) throw conflicto(`${producto.nombre} no tiene precio de venta`, 'SIN_PRECIO');
    const partida = calcularPartida({ producto, cantidad: e.cantidad, precio, descuentoPorcentaje: e.descuentoPorcentaje, descuentoMonto: e.descuentoMonto });
    if (e.receta) partida.receta = aId(e.receta);
    partidas.push(partida);
  }
  // Un producto con receta solo se cobra ligado a una receta validada (se verifica al surtirla)
  const sinReceta = partidas.filter(p => p.requiereReceta && !p.receta);
  if (sinReceta.length) {
    throw new ErrorApp(409, `Requiere receta validada: ${sinReceta.map(p => p.nombre).join(', ')}`, 'RECETA_REQUERIDA', { productos: sinReceta.map(p => p.producto) });
  }
  return partidas;
}

const publica = v => ({
  id: v._id,
  sucursal: v.sucursal,
  serie: v.serie,
  folio: v.folio,
  caja: v.caja,
  turno: v.turno || null,
  cajero: { id: v.cajero, nombre: v.cajeroNombre },
  cliente: { id: v.cliente, nombre: v.clienteNombre },
  listaPrecios: v.listaPrecios,
  partidas: v.partidas,
  subtotal: v.subtotal,
  descuento: v.descuento,
  total: v.total,
  iva: v.iva,
  costo: v.costo,
  pagos: v.pagos,
  cambio: v.cambio,
  estado: v.estado,
  cancelacion: v.estado === 'cancelada' ? v.cancelacion : null,
  cambiosFormaPago: v.cambiosFormaPago || [],
  aCredito: (v.pagos || []).filter(p => p.metodo === 'credito').reduce((s, p) => s + p.monto, 0),
  fecha: v.fecha
});

// Sin costos para quien no debe verlos (el cajero)
function sinCostos(venta) {
  const { costo: _c, partidas, ...resto } = venta;
  return { ...resto, partidas: partidas.map(({ costo: _x, lotes, ...p }) => ({ ...p, lotes: lotes.map(({ costoUnitario: _u, costo: _k, ...l }) => l) })) };
}

async function cobrar(alcance, actor, datos, { verCostos = false } = {}) {
  const sucursal = sucursalDeEscritura(alcance);
  const formatear = v => (verCostos ? publica(v) : sinCostos(publica(v)));

  // Reintento de la misma operación: devolver la venta ya cobrada
  const previa = await Venta.findOne({ sucursal, claveOperacion: datos.claveOperacion }).lean();
  if (previa) return { venta: formatear(previa), repetida: true };

  // Precálculo fuera de la transacción para validar y pedir el PIN solo si hace falta
  const clientePrevio = await cargarCliente(datos.cliente);
  const partidasPrevias = await armarPartidas(datos.partidas, clientePrevio.listaPrecios);
  let autorizador = null;
  if (partidasPrevias.some(p => p.descuento > 0)) {
    if (!datos.autorizacion?.usuario) throw new ErrorApp(403, 'Los descuentos requieren autorización del dueño (usuario y PIN)', 'AUTORIZACION_REQUERIDA');
    autorizador = await verificarPin({ ...datos.autorizacion, permiso: 'autorizar:descuento', sucursal });
  }

  // Parte a crédito: el cliente debe tenerlo; si rebasa el límite o tiene saldo vencido, PIN del dueño
  const montoCredito = (datos.pagos || []).filter(p => p.metodo === 'credito').reduce((s, p) => s + p.monto, 0);
  let autorizadorCredito = null;
  if (montoCredito > 0) {
    if (!tienePermiso(actor.rol, 'credito:vender')) throw sinPermiso('No tienes permiso para vender a crédito');
    const ev = await credito.evaluar(clientePrevio, montoCredito);
    if (ev.requiereAutorizacion) {
      if (!datos.autorizacionCredito?.usuario) {
        throw new ErrorApp(409, `${clientePrevio.nombre} ${ev.motivo}: se requiere autorización del dueño`, 'CREDITO_REQUIERE_AUTORIZACION', ev.resumen);
      }
      autorizadorCredito = await verificarPin({ ...datos.autorizacionCredito, permiso: 'autorizar:credito_excedido', sucursal });
    }
  }

  try {
    const venta = await conTransaccion(async session => {
      const cliente = await cargarCliente(datos.cliente, session);
      const partidas = await armarPartidas(datos.partidas, cliente.listaPrecios, session);
      const sumas = totales(partidas);
      const { cambio } = calcularPagos(sumas.total, datos.pagos);
      const ventaId = new mongoose.Types.ObjectId();
      const fecha = new Date();
      // Toda venta pertenece al turno abierto de quien cobra (y la caja es la de ese turno)
      const turno = await turnos.turnoParaVender(sucursal, actor._id, fecha, session);

      const consumo = await inventario.consumirFefo(
        {
          sucursal, tipo: 'venta', usuario: actor._id, fecha,
          referencia: { modelo: 'Venta', id: ventaId },
          partidas: partidas.map((p, i) => ({ producto: p.producto, cantidad: p.cantidad, partida: i }))
        },
        session
      );
      for (const c of consumo) {
        partidas[c.partida].lotes = c.capas;
        partidas[c.partida].costo = c.costoTotal;
      }

      const folio = await siguienteFolio(sucursal, SERIE_VENTA, session);

      if (montoCredito > 0) {
        await credito.cargarEnVenta(
          { cliente, sucursal, ventaId, folio: `${SERIE_VENTA}-${folio}`, importe: montoCredito, fecha, autorizado: Boolean(autorizadorCredito) },
          session
        );
      }

      // Recetas: suma lo entregado (≤ prescrito) con los lotes que salieron
      const entregas = partidas
        .filter(p => p.receta)
        .map(p => ({ receta: p.receta, producto: p.producto, cantidad: p.cantidad, lotes: p.lotes.map(l => ({ lote: l.lote, caducidad: l.caducidad, cantidad: l.cantidad })) }));
      if (entregas.length) {
        await recetas.surtirEnVenta({ sucursal, venta: { id: ventaId, folio: `${SERIE_VENTA}-${folio}` }, entregas, fecha }, session);
      }

      if (datos.esperaId) {
        await VentaEnEspera.deleteOne({ _id: aId(datos.esperaId), sucursal }, { session });
      }

      const [nueva] = await Venta.create(
        [{
          _id: ventaId, sucursal, serie: SERIE_VENTA, folio,
          caja: turno.caja, turno: turno._id, cajero: actor._id, cajeroNombre: actor.nombre,
          cliente: cliente._id, clienteNombre: cliente.nombre, listaPrecios: cliente.listaPrecios,
          partidas, ...sumas, costo: partidas.reduce((s, p) => s + p.costo, 0),
          pagos: datos.pagos, cambio, autorizacionDescuento: autorizador?.id, autorizacionCredito: autorizadorCredito?.id,
          claveOperacion: datos.claveOperacion, fecha
        }],
        { session }
      );
      if (autorizador) {
        await auditoria.registrar(
          {
            usuario: actor._id, autorizadoPor: autorizador.id, accion: 'venta.descuento', entidad: 'Venta', entidadId: ventaId, sucursal,
            despues: { folio: nueva.folio, descuento: sumas.descuento, partidas: partidas.filter(p => p.descuento > 0).map(p => ({ sku: p.sku, descuento: p.descuento })) }
          },
          session
        );
      }
      if (autorizadorCredito) {
        await auditoria.registrar(
          {
            usuario: actor._id, autorizadoPor: autorizadorCredito.id, accion: 'venta.credito_excedido', entidad: 'Venta', entidadId: ventaId, sucursal,
            despues: { folio: nueva.folio, cliente: cliente.nombre, aCredito: montoCredito }
          },
          session
        );
      }
      return nueva;
    });
    return { venta: formatear(venta.toObject()), repetida: false };
  } catch (error) {
    // Dos reintentos simultáneos con la misma clave: el segundo choca con el índice único
    if (error.code === 11000 && error.keyPattern?.claveOperacion) {
      const ya = await Venta.findOne({ sucursal, claveOperacion: datos.claveOperacion }).lean();
      if (ya) return { venta: formatear(ya), repetida: true };
    }
    throw error;
  }
}

async function obtener(alcance, actor, id, { verTodas, verCostos }) {
  const venta = await Venta.findOne(conAlcance({ _id: aId(id) }, alcance)).lean();
  if (!venta) throw noEncontrado('Venta no encontrada');
  if (!verTodas) {
    const { inicio, fin } = rangoDia();
    if (!venta.cajero.equals(actor._id) || venta.fecha < inicio || venta.fecha >= fin) throw noEncontrado('Venta no encontrada');
  }
  return verCostos ? publica(venta) : sinCostos(publica(venta));
}

// Quien no tiene ventas:ver_todas solo ve SUS ventas de HOY
async function listar(alcance, actor, { desde, hasta, estado, folio, pagina = 1, limite = 50 }, { verTodas, verCostos }) {
  const filtro = {};
  if (verTodas) {
    const { inicio, fin } = rangoDias(desde || diaLocal(), hasta || desde || diaLocal());
    filtro.fecha = { $gte: inicio, $lt: fin };
  } else {
    const { inicio, fin } = rangoDia();
    filtro.fecha = { $gte: inicio, $lt: fin };
    filtro.cajero = actor._id;
  }
  if (estado) filtro.estado = estado;
  if (folio) filtro.folio = folio;
  const consulta = conAlcance(filtro, alcance);
  const [lista, total] = await Promise.all([
    Venta.find(consulta).sort({ fecha: -1, _id: -1 }).skip((pagina - 1) * limite).limit(limite).lean(),
    Venta.countDocuments(consulta)
  ]);
  return {
    datos: lista.map(v => {
      const { partidas, pagos, ...resto } = verCostos ? publica(v) : sinCostos(publica(v));
      return { ...resto, numPartidas: partidas.length, metodos: [...new Set(pagos.map(p => p.metodo))] };
    }),
    total,
    pagina,
    limite
  };
}

// Cancelar: solo con PIN del dueño. Devuelve la mercancía a los lotes exactos de los que salió.
async function cancelar(alcance, actor, id, { motivo, autorizacion }) {
  const sucursal = sucursalDeEscritura(alcance);
  const autorizador = await verificarPin({ ...autorizacion, permiso: 'autorizar:cancelacion', sucursal });
  return conTransaccion(async session => {
    const fecha = new Date();
    const actual = await Venta.findOne(filtroEscritura(alcance, { _id: aId(id) })).session(session).lean();
    if (!actual) throw noEncontrado('Venta no encontrada');
    if (actual.estado !== 'cobrada') throw conflicto('La venta ya está cancelada', 'VENTA_CANCELADA');
    // De qué caja sale el dinero: del turno de la venta si sigue abierto, o del turno abierto de quien cancela
    const { turnoDevolucion } = await turnos.turnoParaCancelar(actual, actor._id, fecha, session);
    const venta = await Venta.findOneAndUpdate(
      { _id: actual._id, sucursal: actual.sucursal, estado: 'cobrada' },
      { $set: { estado: 'cancelada', cancelacion: { usuario: actor._id, autorizadoPor: autorizador.id, motivo, fecha, ...(turnoDevolucion && { turno: turnoDevolucion }) } } },
      { new: true, session }
    );
    if (!venta) throw conflicto('La venta ya está cancelada', 'VENTA_CANCELADA');
    // La parte a crédito: se cancela su cargo (si ya tiene abonos, la venta no se puede cancelar)
    if (venta.pagos.some(p => p.metodo === 'credito')) await credito.cancelarEnVenta({ ventaId: venta._id, usuario: actor._id, fecha }, session);
    await inventario.revertirSalidas({ sucursal, referenciaId: venta._id, usuario: actor._id, nota: `Cancelación venta ${venta.serie}-${venta.folio}: ${motivo}`, autorizadoPor: autorizador.id, fecha }, session);
    // Lo surtido de recetas vuelve a quedar pendiente
    await recetas.revertirEnVenta({ sucursal, ventaId: venta._id }, session);
    await auditoria.registrar(
      {
        usuario: actor._id, autorizadoPor: autorizador.id, accion: 'venta.cancelar', entidad: 'Venta', entidadId: venta._id, sucursal, motivo,
        antes: { estado: 'cobrada', folio: venta.folio, total: venta.total }, despues: { estado: 'cancelada' }
      },
      session
    );
    return publica(venta.toObject());
  });
}

// ---- Ventas en espera ----
async function guardarEspera(alcance, actor, { cliente, nota, partidas }) {
  const sucursal = sucursalDeEscritura(alcance);
  if (!partidas?.length) throw solicitudInvalida('No hay productos que guardar');
  const espera = await VentaEnEspera.create({ sucursal, cajero: actor._id, cliente, nota, partidas });
  return { id: espera._id, cliente: espera.cliente, nota: espera.nota, partidas: espera.partidas, creada: espera.createdAt };
}

async function listarEspera(alcance) {
  const lista = await VentaEnEspera.find(conAlcance({}, alcance)).sort({ createdAt: -1 }).limit(50).lean();
  return lista.map(e => ({ id: e._id, cajero: e.cajero, cliente: e.cliente, nota: e.nota || '', partidas: e.partidas, creada: e.createdAt }));
}

async function eliminarEspera(alcance, id) {
  const r = await VentaEnEspera.deleteOne(filtroEscritura(alcance, { _id: aId(id) }));
  if (r.deletedCount === 0) throw noEncontrado('Venta en espera no encontrada');
}

// Corregir la forma de pago (p. ej. se registró efectivo y era tarjeta): PIN del dueño, motivo,
// y solo mientras el turno de la venta siga abierto. Queda el historial en la venta y en la bitácora.
async function cambiarFormaPago(alcance, actor, id, { pagos, motivo, autorizacion }) {
  const sucursal = sucursalDeEscritura(alcance);
  const autorizador = await verificarPin({ ...autorizacion, permiso: 'autorizar:cambio_forma_pago', sucursal });
  return conTransaccion(async session => {
    const fecha = new Date();
    const venta = await Venta.findOne(filtroEscritura(alcance, { _id: aId(id) })).session(session).lean();
    if (!venta) throw noEncontrado('Venta no encontrada');
    if (venta.estado !== 'cobrada') throw conflicto('La venta está cancelada', 'VENTA_CANCELADA');
    if ([...venta.pagos, ...pagos].some(p => p.metodo === 'credito')) {
      throw conflicto('Una venta con parte a crédito no se corrige: cancélala y vuelve a cobrarla', 'VENTA_A_CREDITO');
    }
    await turnos.exigirTurnoAbiertoDeVenta(venta, fecha, session);
    const { cambio } = calcularPagos(venta.total, pagos);
    const actualizada = await Venta.findOneAndUpdate(
      { _id: venta._id, sucursal: venta.sucursal, estado: 'cobrada' },
      {
        $set: { pagos, cambio },
        $push: { cambiosFormaPago: { antes: venta.pagos, cambioAntes: venta.cambio, motivo, usuario: actor._id, autorizadoPor: autorizador.id, fecha } }
      },
      { new: true, session }
    ).lean();
    await auditoria.registrar(
      {
        usuario: actor._id, autorizadoPor: autorizador.id, accion: 'venta.cambiar_forma_pago', entidad: 'Venta', entidadId: venta._id, sucursal, motivo,
        antes: { pagos: venta.pagos, cambio: venta.cambio }, despues: { pagos, cambio }
      },
      session
    );
    return publica(actualizada);
  });
}

module.exports = { cobrar, obtener, listar, cancelar, cambiarFormaPago, guardarEspera, listarEspera, eliminarEspera, SERIE_VENTA };

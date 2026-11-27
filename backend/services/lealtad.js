// Programa de lealtad (Paso 22). Solo clientes registrados de público (no «Público en general» ni distribuidores).
//
// 1. Costales de alimento premium: cada costal suma 1. El costal 5 lleva 5 %, el 10 lleva 10 % y el 15 lleva 15 %
//    de descuento (sobre su precio); después del 15 el ciclo vuelve a empezar.
// 2. Puntos por compra: según lo que se paga (sin contar lo pagado con puntos):
//      hasta $500 → 5 %,  de $500.01 a $1,500 → 10 %,  más de $1,500 → 15 %
//    puntos = ese porcentaje en pesos, redondeado hacia abajo ($400 × 5 % = 20 puntos).
//    Cada punto vale `valorPunto` centavos (10 = $0.10) y se usan como forma de pago en la caja.
const Cliente = require('../models/Cliente');
const MovimientoLealtad = require('../models/MovimientoLealtad');
const { aplicarTasa } = require('../helpers/dinero');
const { desglosarIva } = require('./calculoVenta');
const { solicitudInvalida, conflicto } = require('../helpers/errores');

const TIPOS_ELEGIBLES = ['publico'];

const elegible = (cliente, config) => Boolean(config?.activa && cliente && !cliente.esPublicoGeneral && TIPOS_ELEGIBLES.includes(cliente.tipo));
const cicloDe = config => Math.max(...config.premiosCostal.map(p => p.numero));
const saldoDe = cliente => ({ puntos: cliente.lealtad?.puntos || 0, costales: cliente.lealtad?.costales || 0 });

// Aplica los premios de costal a las partidas (las modifica). Devuelve cuántos costales sumó y la posición final.
function aplicarCostales(partidas, cliente, config) {
  const ciclo = cicloDe(config);
  let posicion = saldoDe(cliente).costales;
  let costales = 0;
  for (const p of partidas) {
    if (!p || !p.alimentoPremium) continue;
    let premio = 0;
    const premios = [];
    for (let u = 0; u < p.cantidad; u += 1) {
      posicion += 1;
      const regla = config.premiosCostal.find(r => r.numero === posicion);
      if (regla) {
        premio += aplicarTasa(p.precioUnitario, regla.porcentaje);
        premios.push(regla.numero);
      }
      if (posicion >= ciclo) posicion = 0;
    }
    costales += p.cantidad;
    p.costalesLealtad = p.cantidad;
    if (premio > 0) {
      const descuento = Math.min(p.bruto, p.descuento + premio);
      p.descuentoLealtad = descuento - p.descuento;
      p.premiosCostal = premios;
      p.descuento = descuento;
      p.importe = p.bruto - descuento;
      p.iva = desglosarIva(p.importe, p.tasaIva);
    }
  }
  return { costales, costalesDespues: posicion };
}

function puntosPorCompra(base, config) {
  if (base <= 0) return 0;
  const escalon = config.escalones.find(e => e.hasta === null || e.hasta === undefined || base <= e.hasta);
  return Math.floor((base * escalon.porcentaje) / 1000000);
}

// Puntos que hay que descontar por pagar `monto` centavos con puntos (se redondea hacia arriba)
const puntosParaMonto = (monto, config) => Math.ceil(monto / config.valorPunto);

// Validación previa al cobro (fuera de la transacción)
function validarCanje(cliente, config, montoPuntos) {
  if (montoPuntos <= 0) return 0;
  if (!elegible(cliente, config)) throw solicitudInvalida('Este cliente no participa en el programa de lealtad');
  const usar = puntosParaMonto(montoPuntos, config);
  if (usar > saldoDe(cliente).puntos) {
    throw conflicto(`${cliente.nombre} tiene ${saldoDe(cliente).puntos} puntos y se necesitan ${usar}`, 'PUNTOS_INSUFICIENTES');
  }
  return usar;
}

// Dentro de la transacción de la venta: mueve el saldo del cliente y deja el historial
async function registrarEnVenta({ cliente, config, venta, sucursal, usuario, fecha, total, montoPuntos, costales, costalesDespues }, session) {
  const usados = montoPuntos > 0 ? puntosParaMonto(montoPuntos, config) : 0;
  const ganados = puntosPorCompra(total - montoPuntos, config);
  if (!usados && !ganados && !costales) return null;
  const actualizado = await Cliente.findOneAndUpdate(
    { _id: cliente._id, ...(usados > 0 && { 'lealtad.puntos': { $gte: usados } }) },
    { $inc: { 'lealtad.puntos': ganados - usados }, $set: { 'lealtad.costales': costalesDespues } },
    { new: true, session }
  ).lean();
  if (!actualizado) throw conflicto('Los puntos del cliente cambiaron; vuelve a intentar', 'PUNTOS_INSUFICIENTES');
  const saldo = saldoDe(actualizado);
  const comun = { cliente: cliente._id, sucursal, venta: venta.id, folio: venta.folio, usuario, fecha, costalesCiclo: saldo.costales };
  const movimientos = [];
  if (usados) movimientos.push({ ...comun, tipo: 'canje', puntos: -usados, saldoPuntos: saldo.puntos - ganados });
  if (ganados || costales) movimientos.push({ ...comun, tipo: 'acumulo', puntos: ganados, costales, saldoPuntos: saldo.puntos });
  await MovimientoLealtad.create(movimientos, { session, ordered: true });
  return { puntosGanados: ganados, puntosUsados: usados, costales, costalesDespues, saldoPuntos: saldo.puntos };
}

// Venta cancelada: devuelve los puntos usados, quita los ganados y regresa los costales del ciclo
async function revertirEnVenta({ venta, config, usuario, fecha }, session) {
  const l = venta.lealtad;
  if (!l || (!l.puntosGanados && !l.puntosUsados && !l.costales)) return;
  const ciclo = cicloDe(config);
  const cliente = await Cliente.findById(venta.cliente).session(session).lean();
  const costales = (((saldoDe(cliente).costales - (l.costales || 0)) % ciclo) + ciclo) % ciclo;
  const delta = (l.puntosUsados || 0) - (l.puntosGanados || 0);
  const actualizado = await Cliente.findOneAndUpdate(
    { _id: cliente._id },
    { $inc: { 'lealtad.puntos': delta }, $set: { 'lealtad.costales': costales } },
    { new: true, session }
  ).lean();
  await MovimientoLealtad.create(
    [{
      cliente: cliente._id, sucursal: venta.sucursal, venta: venta._id, folio: `${venta.serie}-${venta.folio}`, tipo: 'cancelacion',
      puntos: delta, costales: -(l.costales || 0), saldoPuntos: actualizado.lealtad.puntos, costalesCiclo: costales, usuario, fecha
    }],
    { session }
  );
}

async function movimientos(clienteId, limite = 50) {
  const lista = await MovimientoLealtad.find({ cliente: clienteId }).sort({ fecha: -1 }).limit(limite).lean();
  return lista.map(m => ({ id: m._id, tipo: m.tipo, puntos: m.puntos, costales: m.costales, saldoPuntos: m.saldoPuntos, costalesCiclo: m.costalesCiclo, folio: m.folio || null, nota: m.nota || '', fecha: m.fecha }));
}

module.exports = { elegible, aplicarCostales, puntosPorCompra, puntosParaMonto, validarCanje, registrarEnVenta, revertirEnVenta, movimientos, saldoDe, cicloDe, TIPOS_ELEGIBLES };

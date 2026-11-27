// Precio al que se vende una partida: el MÁS BAJO entre
//   - el de la lista del cliente (o público, de respaldo),
//   - la escala de mayoreo por cantidad del producto («desde N piezas → $X»),
//   - las promociones vigentes (por producto, por categoría o por lote).
// Lo decide el servidor; la caja solo muestra la cotización.
const mongoose = require('mongoose');
const InventoryLayer = require('../models/InventoryLayer');
const { aplicarTasa, importePartida } = require('../helpers/dinero');

// Escala que aplica a la cantidad (la de mayor «desde» que no la rebase)
function escalaPara(producto, cantidad) {
  return (producto.escalas || []).filter(e => cantidad >= e.desde).sort((a, b) => b.desde - a.desde)[0] || null;
}

function precioPromocion(promo, precioLista) {
  return promo.tipo === 'precio' ? promo.valor : precioLista - aplicarTasa(precioLista, promo.valor);
}

/**
 * @param base       { precio, lista } de la lista de precios
 * @param promos     promociones vigentes que le aplican al producto
 * @param stockLote  Map(lote → existencia vigente en la sucursal), para las promociones por lote
 * @returns { precio, lista, origen, precioLista, escalaDesde?, promocion? }
 */
function mejorPrecio({ producto, cantidad, base, promos = [], stockLote = new Map() }) {
  let mejor = { precio: base.precio, lista: base.lista, origen: 'lista', precioLista: base.precio };
  const escala = escalaPara(producto, cantidad);
  if (escala && escala.precio < mejor.precio) mejor = { ...mejor, precio: escala.precio, origen: 'escala', escalaDesde: escala.desde };
  for (const promo of promos) {
    if (promo.alcance === 'lote' && (stockLote.get(promo.lote) || 0) < cantidad) continue;
    const precio = precioPromocion(promo, base.precio);
    if (precio < mejor.precio) {
      const { escalaDesde: _e, ...resto } = mejor;
      mejor = { ...resto, precio, origen: 'promocion', promocion: { id: promo._id, nombre: promo.nombre, ...(promo.lote && { lote: promo.lote }) } };
    }
  }
  return mejor;
}

// Existencia vigente (no caducada) por lote, solo de los lotes que tienen promoción
async function existenciaDeLotes(sucursal, productoId, lotes, fecha = new Date(), session) {
  if (!lotes.length) return new Map();
  const filas = await InventoryLayer.aggregate([
    {
      $match: {
        sucursal: new mongoose.Types.ObjectId(String(sucursal)), producto: productoId, lote: { $in: lotes },
        agotada: false, cantidadRestante: { $gt: 0 }, $or: [{ caducidad: null }, { caducidad: { $gte: fecha } }]
      }
    },
    { $group: { _id: '$lote', total: { $sum: '$cantidadRestante' } } }
  ]).session(session || null);
  return new Map(filas.map(f => [f._id, f.total]));
}

// Lo que el cliente se ahorra frente al precio de lista (para reportes)
function ahorro(producto, cantidad, mejor) {
  if (mejor.origen === 'lista') return 0;
  const unidad = { unidad: producto.unidad, cantidad };
  return importePartida({ precioUnitario: mejor.precioLista, ...unidad }) - importePartida({ precioUnitario: mejor.precio, ...unidad });
}

module.exports = { mejorPrecio, escalaPara, existenciaDeLotes, ahorro, precioPromocion };

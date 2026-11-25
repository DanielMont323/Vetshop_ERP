// Contador de folios por sucursal y serie. Se incrementa DENTRO de la transacción de la venta:
// si la venta se revierte, el folio también, así que no quedan huecos.
// Fase 2 (modo sin conexión): la serie incluirá la caja (p. ej. 'V-C1') para que dos cajas
// desconectadas nunca generen el mismo folio. Ver docs/PLAN-FASE-1.md.
const mongoose = require('mongoose');
const { alcanceSucursal } = require('./plugins/alcanceSucursal');

const contadorSchema = new mongoose.Schema({
  sucursal: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal', required: true },
  serie: { type: String, required: true },
  ultimo: { type: Number, required: true, default: 0 }
});

contadorSchema.index({ sucursal: 1, serie: 1 }, { unique: true });
contadorSchema.plugin(alcanceSucursal);

const Contador = mongoose.model('Contador', contadorSchema, 'contadores');

// Siguiente folio de la serie en la sucursal (1, 2, 3…)
async function siguienteFolio(sucursal, serie, session) {
  const c = await Contador.findOneAndUpdate({ sucursal, serie }, { $inc: { ultimo: 1 } }, { new: true, upsert: true, session });
  return c.ultimo;
}

module.exports = Contador;
module.exports.siguienteFolio = siguienteFolio;

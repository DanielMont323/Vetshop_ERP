// Meta de venta mensual de una sucursal o de un vendedor dentro de una sucursal (por sucursal: plugin de alcance).
//   periodo: 'AAAA-MM' (mes en hora de Tepic); vendedor null = meta de la sucursal completa.
//   monto en centavos (venta con IVA); tickets opcional.
const mongoose = require('mongoose');
const { alcanceSucursal } = require('./plugins/alcanceSucursal');

const RE_PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/;

const metaSchema = new mongoose.Schema(
  {
    sucursal: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal', required: true },
    periodo: { type: String, required: true, match: [RE_PERIODO, 'Periodo: AAAA-MM'] },
    vendedor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', default: null },
    monto: { type: Number, required: true, min: 1, validate: { validator: Number.isSafeInteger, message: 'Centavos enteros' } },
    tickets: { type: Number, min: 0, validate: { validator: v => v === undefined || v === null || Number.isSafeInteger(v), message: 'Entero' } },
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true }
  },
  { timestamps: true }
);

metaSchema.index({ sucursal: 1, periodo: 1, vendedor: 1 }, { unique: true });
metaSchema.index({ periodo: 1, sucursal: 1 });

metaSchema.plugin(alcanceSucursal);

module.exports = mongoose.model('Meta', metaSchema, 'metas');
module.exports.RE_PERIODO = RE_PERIODO;

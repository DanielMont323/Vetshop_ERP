// Configuración general del negocio (un solo documento, clave 'general'). La edita el dueño.
//   caja.conceptosGasto:  conceptos para los gastos de caja (mandadito, garrafón…)
//   caja.topeGastoSinPin: centavos que un cajero puede sacar en gastos por turno sin PIN del dueño
const mongoose = require('mongoose');

const CONCEPTOS_GASTO = ['Mandadito', 'Garrafón de agua', 'Papelería', 'Limpieza', 'Otro'];

const configuracionSchema = new mongoose.Schema(
  {
    clave: { type: String, required: true, default: 'general' },
    caja: {
      conceptosGasto: {
        type: [{ type: String, trim: true, maxlength: 40 }],
        default: () => [...CONCEPTOS_GASTO],
        validate: { validator: l => l.length >= 1 && l.length <= 20 && new Set(l.map(c => c.toLowerCase())).size === l.length, message: 'De 1 a 20 conceptos, sin repetir' }
      },
      topeGastoSinPin: { type: Number, min: 0, default: 30000, validate: { validator: Number.isSafeInteger, message: 'Centavos enteros' } }
    }
  },
  { timestamps: true }
);

configuracionSchema.index({ clave: 1 }, { unique: true });

module.exports = mongoose.model('Configuracion', configuracionSchema, 'configuracion');
module.exports.CONCEPTOS_GASTO = CONCEPTOS_GASTO;

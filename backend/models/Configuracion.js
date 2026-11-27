// Configuración general del negocio (un solo documento, clave 'general'). La edita el dueño.
//   caja.conceptosGasto:  conceptos para los gastos de caja (mandadito, garrafón…)
//   caja.topeGastoSinPin: centavos que un cajero puede sacar en gastos por turno sin PIN del dueño
const mongoose = require('mongoose');

const CONCEPTOS_GASTO = ['Mandadito', 'Garrafón de agua', 'Papelería', 'Limpieza', 'Otro'];

// Motivos de descuento en la caja: cada uno con su % máximo (puntos base) y si pide PIN del dueño.
// Por defecto todos piden PIN (como antes); el dueño decide cuáles no.
const MOTIVOS_DESCUENTO = [
  { nombre: 'Cliente frecuente', maximo: 1000, requierePin: true },
  { nombre: 'Recomendación', maximo: 1000, requierePin: true },
  { nombre: 'Empaque dañado', maximo: 1500, requierePin: true },
  { nombre: 'Otro', maximo: 10000, requierePin: true }
];

const motivoSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true, trim: true, maxlength: 40 },
    maximo: { type: Number, required: true, min: 1, max: 10000, validate: { validator: Number.isSafeInteger, message: 'Porcentaje en puntos base' } },
    requierePin: { type: Boolean, default: true }
  },
  { _id: false }
);

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
    },
    descuentos: {
      motivos: {
        type: [motivoSchema],
        default: () => MOTIVOS_DESCUENTO.map(m => ({ ...m })),
        validate: { validator: l => l.length >= 1 && l.length <= 20 && new Set(l.map(m => m.nombre.toLowerCase())).size === l.length, message: 'De 1 a 20 motivos de descuento, sin repetir' }
      }
    }
  },
  { timestamps: true }
);

configuracionSchema.index({ clave: 1 }, { unique: true });

module.exports = mongoose.model('Configuracion', configuracionSchema, 'configuracion');
module.exports.CONCEPTOS_GASTO = CONCEPTOS_GASTO;
module.exports.MOTIVOS_DESCUENTO = MOTIVOS_DESCUENTO;

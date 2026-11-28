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

// Programa de lealtad. Porcentajes en puntos base; montos en centavos.
const ESCALONES_PUNTOS = [{ hasta: 50000, porcentaje: 500 }, { hasta: 150000, porcentaje: 1000 }, { hasta: null, porcentaje: 1500 }];
const PREMIOS_COSTAL = [{ numero: 5, porcentaje: 500 }, { numero: 10, porcentaje: 1000 }, { numero: 15, porcentaje: 1500 }];
const pb = { type: Number, required: true, min: 0, max: 10000, validate: { validator: Number.isSafeInteger, message: 'Puntos base enteros' } };

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
    lealtad: {
      activa: { type: Boolean, default: true },
      valorPunto: { type: Number, min: 1, max: 10000, default: 10, validate: { validator: Number.isSafeInteger, message: 'Centavos enteros' } }, // 10 = $0.10
      escalones: {
        type: [new mongoose.Schema({ hasta: { type: Number, default: null }, porcentaje: pb }, { _id: false })],
        default: () => ESCALONES_PUNTOS.map(e => ({ ...e }))
      },
      premiosCostal: {
        type: [new mongoose.Schema({ numero: { type: Number, required: true, min: 1, max: 100 }, porcentaje: pb }, { _id: false })],
        default: () => PREMIOS_COSTAL.map(p => ({ ...p }))
      }
    },
    // Marcas de las notas y tickets (los logos van en la colección logos)
    marcas: {
      negocio: {
        nombre: { type: String, trim: true, maxlength: 80, default: 'Vet Shop' },
        lema: { type: String, trim: true, maxlength: 120, default: 'Impulsando el cuidado que ellos merecen' },
        rfc: { type: String, trim: true, maxlength: 13, default: '' },
        direccion: { type: String, trim: true, maxlength: 300, default: '' },
        telefono: { type: String, trim: true, maxlength: 30, default: '' }
      },
      mostrador: {
        nombre: { type: String, trim: true, maxlength: 80, default: 'Huellitas Vetshop' },
        lema: { type: String, trim: true, maxlength: 120, default: '' },
        rfc: { type: String, trim: true, maxlength: 13, default: '' },
        direccion: { type: String, trim: true, maxlength: 300, default: '' },
        telefono: { type: String, trim: true, maxlength: 30, default: '' }
      }
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
module.exports.ESCALONES_PUNTOS = ESCALONES_PUNTOS;
module.exports.PREMIOS_COSTAL = PREMIOS_COSTAL;

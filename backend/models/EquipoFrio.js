// Equipo de refrigeración de una sucursal (refrigerador o congelador) con su rango permitido en °C.
// Por sucursal: lleva el plugin de alcance.
const mongoose = require('mongoose');
const { alcanceSucursal } = require('./plugins/alcanceSucursal');

const TIPOS_EQUIPO = ['refrigerador', 'congelador'];
const grados = { type: Number, min: -40, max: 60, validate: { validator: v => v === undefined || Math.round(v * 10) === v * 10, message: 'Temperatura con máximo un decimal' } };

const equipoSchema = new mongoose.Schema(
  {
    sucursal: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal', required: true },
    nombre: { type: String, required: [true, 'El nombre es obligatorio'], trim: true, maxlength: 60 },
    tipo: { type: String, enum: TIPOS_EQUIPO, default: 'refrigerador' },
    minimo: { ...grados, default: 2 },
    maximo: { ...grados, default: 8 },
    lecturasPorDia: { type: Number, min: 1, max: 12, default: 2, validate: { validator: Number.isSafeInteger, message: 'Entero' } },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true }
);

equipoSchema.index({ sucursal: 1, nombre: 1 }, { unique: true, collation: { locale: 'es', strength: 1 } });
equipoSchema.path('maximo').validate(function (v) {
  return v > this.minimo;
}, 'El máximo debe ser mayor que el mínimo');

equipoSchema.plugin(alcanceSucursal);

module.exports = mongoose.model('EquipoFrio', equipoSchema, 'equipos_frio');
Object.assign(module.exports, { TIPOS_EQUIPO });

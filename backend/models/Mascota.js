// Mascota de un cliente (global, como el cliente). Huellitas no da consulta: es para el directorio y los recordatorios.
const mongoose = require('mongoose');

const ESPECIES = ['perro', 'gato', 'ave', 'roedor', 'reptil', 'otro'];

const mascotaSchema = new mongoose.Schema(
  {
    cliente: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', required: true },
    nombre: { type: String, required: [true, 'El nombre es obligatorio'], trim: true, maxlength: 60 },
    especie: { type: String, enum: { values: ESPECIES, message: 'Especie inválida' }, required: true },
    raza: { type: String, trim: true, maxlength: 60 },
    sexo: { type: String, enum: ['macho', 'hembra', ''], default: '' },
    nacimiento: { type: String, match: [/^\d{4}-\d{2}-\d{2}$/, 'Nacimiento: AAAA-MM-DD'] }, // día (sin hora)
    peso: { type: Number, min: 0, validate: { validator: v => v === undefined || v === null || Number.isSafeInteger(v), message: 'Peso en gramos enteros' } },
    notas: { type: String, trim: true, maxlength: 300 },
    activa: { type: Boolean, default: true }
  },
  { timestamps: true }
);

mascotaSchema.index({ cliente: 1, activa: 1 });

mascotaSchema.pre('validate', function () {
  if (this.nacimiento === '') this.nacimiento = undefined;
});

module.exports = mongoose.model('Mascota', mascotaSchema, 'mascotas');
module.exports.ESPECIES = ESPECIES;

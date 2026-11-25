// Proveedor (global). diasCredito se copia a cada compra a crédito para calcular su vencimiento.
const mongoose = require('mongoose');

// RFC de persona moral (12) o física (13)
const RE_RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

const proveedorSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: [true, 'El nombre es obligatorio'], trim: true, maxlength: 120 },
    rfc: { type: String, trim: true, uppercase: true, match: [RE_RFC, 'RFC inválido'] },
    contacto: { type: String, trim: true, maxlength: 80 },
    telefono: { type: String, trim: true, maxlength: 20 },
    email: { type: String, trim: true, lowercase: true, maxlength: 120 },
    diasCredito: {
      type: Number,
      default: 0,
      min: [0, 'Los días de crédito no pueden ser negativos'],
      max: [365, 'Máximo 365 días de crédito'],
      validate: { validator: Number.isSafeInteger, message: 'Los días de crédito deben ser un entero' }
    },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true }
);

proveedorSchema.index({ nombre: 1 }, { unique: true, collation: { locale: 'es', strength: 1 } });
proveedorSchema.index({ rfc: 1 }, { unique: true, partialFilterExpression: { rfc: { $type: 'string' } } });

proveedorSchema.pre('validate', function () {
  if (this.rfc === '') this.rfc = undefined;
});

module.exports = mongoose.model('Proveedor', proveedorSchema, 'proveedores');
module.exports.RE_RFC = RE_RFC;

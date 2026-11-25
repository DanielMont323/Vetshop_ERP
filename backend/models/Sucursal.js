// Sucursal: tienda (punto de venta) o almacén. Catálogo global (no lleva campo sucursal).
const mongoose = require('mongoose');

const sucursalSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: [true, 'El nombre es obligatorio'], trim: true, maxlength: 80 },
    tipo: { type: String, enum: ['tienda', 'almacen'], required: true },
    activa: { type: Boolean, default: true }
  },
  { timestamps: true }
);

// Nombre único sin distinguir mayúsculas ni acentos
sucursalSchema.index({ nombre: 1 }, { unique: true, collation: { locale: 'es', strength: 1 } });

module.exports = mongoose.model('Sucursal', sucursalSchema, 'sucursales');

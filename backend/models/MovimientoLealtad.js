// Movimiento del programa de lealtad de un cliente (historial; el saldo vive en Cliente.lealtad).
//   acumulo:     puntos ganados en una venta (+) y costales premium que sumó
//   canje:       puntos usados como forma de pago (−)
//   cancelacion: reversa de una venta cancelada (devuelve lo usado y quita lo ganado)
//   ajuste:      corrección manual del dueño
const mongoose = require('mongoose');

const TIPOS = ['acumulo', 'canje', 'cancelacion', 'ajuste'];

const movimientoLealtadSchema = new mongoose.Schema(
  {
    cliente: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', required: true },
    sucursal: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal' },
    venta: { type: mongoose.Schema.Types.ObjectId, ref: 'Venta' },
    folio: String,
    tipo: { type: String, enum: TIPOS, required: true },
    puntos: { type: Number, default: 0, validate: { validator: Number.isSafeInteger, message: 'Puntos enteros' } },
    costales: { type: Number, default: 0, validate: { validator: Number.isSafeInteger, message: 'Costales enteros' } },
    saldoPuntos: { type: Number, required: true }, // saldo después del movimiento
    costalesCiclo: { type: Number, required: true }, // posición en el ciclo después del movimiento
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
    nota: { type: String, trim: true, maxlength: 200 },
    fecha: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

movimientoLealtadSchema.index({ cliente: 1, fecha: -1 });
movimientoLealtadSchema.index({ venta: 1 });

module.exports = mongoose.model('MovimientoLealtad', movimientoLealtadSchema, 'movimientos_lealtad');
module.exports.TIPOS = TIPOS;

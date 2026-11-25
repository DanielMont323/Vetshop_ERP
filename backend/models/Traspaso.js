// Traspaso de mercancía entre sucursales (p. ej. del almacén a una tienda).
//
// Flujo: en_transito (al enviar: sale del origen por FEFO, con sus lotes y costo)
//        → recibido               (el destino confirma lo que llegó y entra con los mismos lotes)
//        → con_diferencia         (llegó menos de lo enviado) → diferencia_autorizada (PIN del dueño)
//        | cancelado              (solo en tránsito: regresa a los lotes del origen)
// El alcance por sucursal usa origen Y destino (cada una ve los traspasos en los que participa).
const mongoose = require('mongoose');
const { alcanceSucursal } = require('./plugins/alcanceSucursal');

const ESTADOS = ['en_transito', 'recibido', 'con_diferencia', 'diferencia_autorizada', 'cancelado'];
const entero = min => ({ type: Number, required: true, min, validate: { validator: Number.isSafeInteger, message: 'Cantidad entera (piezas o gramos)' } });

const loteSchema = new mongoose.Schema(
  {
    capaOrigen: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLayer', required: true },
    lote: String,
    caducidad: { type: Date, default: null },
    costoUnitario: { type: Number, required: true, min: 0 },
    enviado: entero(1),
    recibido: { type: Number, min: 0 }, // se llena al recibir
    capaDestino: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLayer' }
  },
  { _id: false }
);

const partidaSchema = new mongoose.Schema(
  {
    producto: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true },
    sku: { type: String, required: true },
    nombre: { type: String, required: true },
    unidad: { type: String, enum: ['pieza', 'kg'], required: true },
    cantidad: entero(1), // enviada
    lotes: { type: [loteSchema], validate: { validator: l => l.length > 0, message: 'Partida sin lotes' } }
  },
  { _id: false }
);

const traspasoSchema = new mongoose.Schema(
  {
    folio: { type: Number, required: true }, // por sucursal de origen
    origen: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal', required: true },
    origenNombre: { type: String, required: true },
    destino: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal', required: true },
    destinoNombre: { type: String, required: true },
    partidas: { type: [partidaSchema], validate: { validator: l => l.length > 0 && l.length <= 200, message: 'Entre 1 y 200 partidas' } },
    estado: { type: String, enum: ESTADOS, default: 'en_transito' },
    observaciones: { type: String, trim: true, maxlength: 500 },
    envio: {
      usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
      usuarioNombre: String,
      fecha: { type: Date, required: true }
    },
    recepcion: {
      usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
      usuarioNombre: String,
      fecha: Date,
      observaciones: { type: String, maxlength: 500 }
    },
    diferencia: {
      autorizadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
      autorizadoPorNombre: String,
      nota: { type: String, maxlength: 500 },
      fecha: Date
    },
    cancelacion: {
      usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
      motivo: String,
      fecha: Date
    }
  },
  { timestamps: true }
);

traspasoSchema.index({ origen: 1, folio: 1 }, { unique: true });
traspasoSchema.index({ origen: 1, estado: 1, createdAt: -1 });
traspasoSchema.index({ destino: 1, estado: 1, createdAt: -1 });

traspasoSchema.path('destino').validate(function (v) {
  return !this.origen || !v || !v.equals(this.origen);
}, 'El destino debe ser distinto del origen');

traspasoSchema.plugin(alcanceSucursal, { campos: ['origen', 'destino'] });

module.exports = mongoose.model('Traspaso', traspasoSchema, 'traspasos');
module.exports.ESTADOS = ESTADOS;

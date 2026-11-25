// Receta médica veterinaria (por sucursal). Puede incluir varios medicamentos (partidas).
//
// Flujo: pendiente (capturada, editable) → validada (por el médico responsable con su PIN)
//        → surtida (cuando se entregó todo lo prescrito) | cancelada.
// Cada venta que surte la receta suma a `cantidadEntregada` de la partida y deja una entrega
// con los lotes entregados. Cantidad entregada ≤ prescrita, siempre.
const mongoose = require('mongoose');
const { alcanceSucursal } = require('./plugins/alcanceSucursal');

const ESTADOS = ['pendiente', 'validada', 'surtida', 'cancelada'];
const entero = min => ({ type: Number, required: true, min, validate: { validator: Number.isSafeInteger, message: 'Cantidad entera (piezas o gramos)' } });

const entregaSchema = new mongoose.Schema(
  {
    venta: { type: mongoose.Schema.Types.ObjectId, ref: 'Venta', required: true },
    folio: { type: String, required: true }, // "V-123"
    cantidad: entero(1),
    lotes: [{ _id: false, lote: String, caducidad: Date, cantidad: Number }],
    fecha: { type: Date, required: true }
  },
  { _id: false }
);

const partidaSchema = new mongoose.Schema(
  {
    producto: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true },
    sku: { type: String, required: true },
    nombre: { type: String, required: true },
    unidad: { type: String, enum: ['pieza', 'kg'], required: true },
    esControlado: { type: Boolean, default: false },
    cantidadPrescrita: entero(1),
    cantidadEntregada: { ...entero(0), default: 0 },
    indicaciones: { type: String, trim: true, maxlength: 300 },
    entregas: { type: [entregaSchema], default: [] }
  },
  { _id: false }
);

partidaSchema.path('cantidadEntregada').validate(function (v) {
  return v <= this.cantidadPrescrita;
}, 'La cantidad entregada no puede ser mayor que la prescrita');

const recetaSchema = new mongoose.Schema(
  {
    sucursal: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal', required: true },
    folio: { type: Number, required: true },
    fechaReceta: { type: Date, required: true }, // fecha de emisión (la que trae la receta)
    medico: {
      nombre: { type: String, required: [true, 'Falta el médico que prescribe'], trim: true, maxlength: 120 },
      cedula: { type: String, required: [true, 'Falta la cédula profesional'], trim: true, maxlength: 20 }
    },
    propietario: {
      nombre: { type: String, required: [true, 'Falta el nombre del propietario'], trim: true, maxlength: 120 },
      telefono: { type: String, trim: true, maxlength: 20 }
    },
    paciente: {
      nombre: { type: String, required: [true, 'Falta el nombre del paciente'], trim: true, maxlength: 80 },
      especie: { type: String, required: [true, 'Falta la especie'], trim: true, maxlength: 40 }
    },
    partidas: {
      type: [partidaSchema],
      validate: { validator: l => l.length > 0 && l.length <= 20, message: 'La receta debe tener entre 1 y 20 medicamentos' }
    },
    // Foto o escaneo: se guarda FUERA de Mongo (services/almacenamiento); aquí solo la referencia
    archivo: {
      clave: String,
      nombre: String,
      tipo: String,
      tamano: Number
    },
    observaciones: { type: String, trim: true, maxlength: 500 },
    estado: { type: String, enum: ESTADOS, default: 'pendiente' },
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
    validadaPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
    validadaPorNombre: String,
    fechaValidacion: Date,
    canceladaPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
    motivoCancelacion: String
  },
  { timestamps: true }
);

recetaSchema.index({ sucursal: 1, folio: 1 }, { unique: true });
recetaSchema.index({ sucursal: 1, estado: 1, createdAt: -1 });
recetaSchema.index({ sucursal: 1, 'partidas.producto': 1, estado: 1 });
recetaSchema.index({ 'partidas.entregas.venta': 1 });

recetaSchema.path('partidas').validate(function (lista) {
  const ids = lista.map(p => String(p.producto));
  return new Set(ids).size === ids.length;
}, 'Un medicamento aparece dos veces en la receta: súmalo en una sola partida');

recetaSchema.plugin(alcanceSucursal);

module.exports = mongoose.model('Receta', recetaSchema, 'recetas');
module.exports.ESTADOS = ESTADOS;

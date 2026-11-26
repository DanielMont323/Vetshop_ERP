// Conteo físico de inventario de una sucursal (por sucursal: lleva el plugin de alcance).
//
// Flujo:  en_captura → en_revision → aplicado          (el dueño autoriza con PIN; se generan los ajustes)
//                    ↘ cancelado (en captura o en revisión)
//
// Al iniciar se toma la FOTO de existencias: un renglón por lote (capa) con existencia de los productos
// incluidos. La captura es CIEGA: quien cuenta no ve lo esperado. Lo que se vende o se mueve durante el
// conteo se toma en cuenta al revisar (esperado ajustado = foto + movimientos de esa capa desde el inicio).
// Cantidades en unidad base (piezas o gramos); costos en centavos.
const mongoose = require('mongoose');
const { alcanceSucursal } = require('./plugins/alcanceSucursal');

const ESTADOS = ['en_captura', 'en_revision', 'aplicado', 'cancelado'];
const entero = { type: Number, validate: { validator: v => v === null || v === undefined || Number.isSafeInteger(v), message: 'Debe ser un entero' } };

const renglonSchema = new mongoose.Schema(
  {
    capa: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLayer', required: true },
    producto: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true },
    sku: { type: String, required: true },
    codigoBarras: String,
    nombre: { type: String, required: true },
    categoria: String,
    unidad: { type: String, enum: ['pieza', 'kg'], required: true },
    lote: String,
    caducidad: { type: Date, default: null },
    costoUnitario: { ...entero, required: true },
    esperado: { ...entero, required: true, min: 0 }, // foto al iniciar
    contado: { ...entero, min: 0, default: null }, // null = no se ha contado
    esperadoCaptura: { ...entero, min: 0 }, // lo que marcaba el sistema al capturar (no se muestra a quien cuenta)
    capturadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
    fechaCaptura: Date,
    // Al aplicar: lo que se ajustó
    esperadoFinal: entero,
    diferencia: entero
  },
  { _id: true }
);

const conteoSchema = new mongoose.Schema(
  {
    sucursal: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal', required: true },
    folio: { type: Number, required: true },
    categorias: [String], // vacío = todo el inventario
    estado: { type: String, enum: ESTADOS, default: 'en_captura' },
    // true mientras está en captura o revisión (índice único: un conteo abierto por sucursal)
    abierto: { type: Boolean, default: true },
    nota: { type: String, trim: true, maxlength: 300 },
    inicio: { fecha: { type: Date, required: true }, usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true }, usuarioNombre: String },
    revision: { fecha: Date, usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' } },
    aplicacion: {
      fecha: Date,
      usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
      autorizadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
      autorizadoPorNombre: String,
      noContadosEnCero: Boolean,
      movimientos: [{ type: mongoose.Schema.Types.ObjectId, ref: 'InventoryMovement' }],
      // Valor a costo de las diferencias (centavos)
      faltante: Number,
      sobrante: Number
    },
    cancelacion: { fecha: Date, motivo: String, usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' } },
    renglones: [renglonSchema]
  },
  { timestamps: true }
);

conteoSchema.index({ sucursal: 1, folio: 1 }, { unique: true });
conteoSchema.index({ sucursal: 1 }, { unique: true, partialFilterExpression: { abierto: true }, name: 'un_conteo_abierto_por_sucursal' });
conteoSchema.index({ sucursal: 1, estado: 1, 'aplicacion.fecha': -1 });
conteoSchema.index({ sucursal: 1, createdAt: -1 });

conteoSchema.plugin(alcanceSucursal);

module.exports = mongoose.model('ConteoFisico', conteoSchema, 'conteos_fisicos');
module.exports.ESTADOS = ESTADOS;

// Movimiento de inventario (adaptado de estética canina). Cada cambio de existencias crea uno
// y NUNCA se edita ni se borra: un error se corrige con un movimiento contrario.
//
// cantidad con signo (unidad base): + entra, − sale.
// capas[]: de qué capas salió o a cuáles entró, con su costo (para el margen y la reversión exacta).
const mongoose = require('mongoose');
const { alcanceSucursal } = require('./plugins/alcanceSucursal');

const TIPOS = ['entrada', 'venta', 'cancelacion', 'traspaso_salida', 'traspaso_entrada', 'ajuste'];
const TIPOS_POSITIVOS = new Set(['entrada', 'cancelacion', 'traspaso_entrada']);
const TIPOS_NEGATIVOS = new Set(['venta', 'traspaso_salida']);
const MOTIVOS_AJUSTE = ['merma', 'caducado', 'danado', 'cadena_frio', 'conteo_fisico', 'uso_interno', 'inventario_inicial', 'otro'];

const capaMovidaSchema = new mongoose.Schema(
  {
    capa: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLayer', required: true },
    lote: { type: String },
    caducidad: { type: Date, default: null },
    cantidad: { type: Number, required: true, min: 1 }, // siempre positiva
    costoUnitario: { type: Number, required: true, min: 0 },
    costo: { type: Number, required: true, min: 0 } // centavos de esta porción
  },
  { _id: false }
);

const inventoryMovementSchema = new mongoose.Schema({
  producto: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true },
  sucursal: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal', required: true },
  tipo: { type: String, enum: TIPOS, required: true },
  cantidad: {
    type: Number,
    required: true,
    validate: [
      { validator: v => Number.isSafeInteger(v) && v !== 0, message: 'La cantidad debe ser un entero distinto de cero' },
      {
        validator: function (v) {
          if (TIPOS_POSITIVOS.has(this.tipo)) return v > 0;
          if (TIPOS_NEGATIVOS.has(this.tipo)) return v < 0;
          return true; // ajuste: cualquier signo
        },
        message: 'El signo de la cantidad no corresponde al tipo de movimiento'
      }
    ]
  },
  capas: {
    type: [capaMovidaSchema],
    validate: {
      validator: function (lista) {
        return lista.length > 0 && lista.reduce((s, c) => s + c.cantidad, 0) === Math.abs(this.cantidad);
      },
      message: 'Las capas deben sumar exactamente la cantidad del movimiento'
    }
  },
  costoTotal: {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: function (v) {
        return v === this.capas.reduce((s, c) => s + c.costo, 0);
      },
      message: 'El costo total debe ser la suma del costo de las capas'
    }
  },
  // Documento que originó el movimiento: Venta, Compra, Traspaso, Ajuste…
  referencia: {
    modelo: { type: String },
    id: { type: mongoose.Schema.Types.ObjectId },
    partida: { type: Number }
  },
  // Para reversiones (cancelación): el movimiento que se revierte. Único: no se revierte dos veces.
  movimientoOriginal: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryMovement' },
  motivo: { type: String, enum: MOTIVOS_AJUSTE },
  nota: { type: String, trim: true, maxlength: 300 },
  autorizadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  fecha: { type: Date, required: true, default: Date.now }
});

inventoryMovementSchema.index({ sucursal: 1, producto: 1, fecha: -1 });
inventoryMovementSchema.index({ sucursal: 1, tipo: 1, fecha: -1 });
inventoryMovementSchema.index({ 'referencia.id': 1 });
inventoryMovementSchema.index(
  { movimientoOriginal: 1 },
  { unique: true, partialFilterExpression: { movimientoOriginal: { $type: 'objectId' } } }
);

inventoryMovementSchema.path('motivo').validate(function (v) {
  return this.tipo !== 'ajuste' || Boolean(v);
}, 'Un ajuste necesita motivo');

// Inmutable
inventoryMovementSchema.pre('save', function () {
  if (!this.isNew) throw new Error('Un movimiento de inventario no se puede modificar');
});
const prohibido = function () {
  throw new Error('Un movimiento de inventario no se puede modificar ni borrar');
};
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  inventoryMovementSchema.pre(op, prohibido);
}

inventoryMovementSchema.plugin(alcanceSucursal);

module.exports = mongoose.model('InventoryMovement', inventoryMovementSchema, 'inventory_movements');
Object.assign(module.exports, { TIPOS, MOTIVOS_AJUSTE });

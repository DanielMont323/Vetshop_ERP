// Capa de inventario: un lote de un producto en una sucursal (adaptado de estética canina).
// Las existencias se DERIVAN de las capas: no hay campo "stock" en Producto.
//
// Cantidades en unidad base entera (piezas o gramos). costoUnitario en centavos por pieza o por kg.
// Salida FEFO: se consume primero la capa con menor `ordenFefo` (= caducidad; sin caducidad, al final).
// Solo `cantidadRestante` y `agotada` cambian después de crearla (consumo o reversión).
const mongoose = require('mongoose');
const { alcanceSucursal } = require('./plugins/alcanceSucursal');

const ORIGENES = ['inventario_inicial', 'compra', 'ajuste_entrada', 'traspaso_entrada'];
// Fecha que se usa para ordenar las capas SIN caducidad después de todas las que sí tienen
const SIN_CADUCIDAD = new Date('9999-12-31T23:59:59.999Z');

const entero = (min, mensaje) => ({
  type: Number,
  required: true,
  min: [min, mensaje],
  validate: { validator: Number.isSafeInteger, message: 'Debe ser un entero (piezas, gramos o centavos)' }
});

const inventoryLayerSchema = new mongoose.Schema(
  {
    producto: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true },
    sucursal: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal', required: true },
    lote: { type: String, trim: true, maxlength: 40 },
    caducidad: { type: Date, default: null },
    ordenFefo: { type: Date, required: true },
    cantidadInicial: entero(1, 'La cantidad inicial debe ser mayor que cero'),
    cantidadRestante: entero(0, 'La cantidad restante no puede ser negativa'),
    costoUnitario: entero(0, 'El costo no puede ser negativo'),
    origen: { type: String, enum: ORIGENES, required: true },
    // Documento que originó la capa (Compra, Traspaso, ajuste…)
    referencia: {
      modelo: { type: String },
      id: { type: mongoose.Schema.Types.ObjectId }
    },
    fechaEntrada: { type: Date, required: true },
    agotada: { type: Boolean, default: false },
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true }
  },
  { timestamps: true }
);

// Consulta FEFO: capas con existencia de un producto en una sucursal, por caducidad
inventoryLayerSchema.index({ sucursal: 1, producto: 1, agotada: 1, ordenFefo: 1, _id: 1 });
// Alertas de caducidad por sucursal
inventoryLayerSchema.index({ sucursal: 1, agotada: 1, caducidad: 1 });
inventoryLayerSchema.index({ 'referencia.id': 1 });

inventoryLayerSchema.pre('validate', function () {
  this.ordenFefo = this.caducidad || SIN_CADUCIDAD;
  if (this.isNew && this.cantidadRestante === undefined) this.cantidadRestante = this.cantidadInicial;
  this.agotada = this.cantidadRestante === 0;
});

inventoryLayerSchema.path('cantidadRestante').validate(function (v) {
  return v <= this.cantidadInicial;
}, 'La cantidad restante no puede exceder la inicial');

inventoryLayerSchema.plugin(alcanceSucursal);

module.exports = mongoose.model('InventoryLayer', inventoryLayerSchema, 'inventory_layers');
Object.assign(module.exports, { ORIGENES, SIN_CADUCIDAD });

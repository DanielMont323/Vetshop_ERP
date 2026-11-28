// Pedido a proveedor de una sucursal (lo que se le pide; la mercancía entra con la Compra que se recibe contra él).
//
// Flujo: borrador (se edita) → enviado (se mandó por WhatsApp / impreso) → parcial | recibido (por las compras
// confirmadas contra el pedido) | cancelado (desde borrador, enviado o parcial).
// costoEstimado: centavos SIN IVA por pieza o por kg (último costo), solo de referencia.
const mongoose = require('mongoose');
const { alcanceSucursal } = require('./plugins/alcanceSucursal');

const ESTADOS = ['borrador', 'enviado', 'parcial', 'recibido', 'cancelado'];
const SERIE_PEDIDO = 'PED';
const entero = { validator: Number.isSafeInteger, message: 'Debe ser un entero' };

const partidaSchema = new mongoose.Schema(
  {
    producto: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true },
    sku: { type: String, required: true },
    nombre: { type: String, required: true },
    presentacion: String,
    unidad: { type: String, enum: ['pieza', 'kg'], required: true },
    tasaIva: { type: Number, min: 0, default: 0 }, // puntos base (para prellenar la recepción)
    cantidad: { type: Number, required: true, min: 1, validate: entero }, // piezas o gramos
    costoEstimado: { type: Number, min: 0, validate: entero },
    recibido: { type: Number, default: 0, min: 0, validate: entero }
  },
  { _id: false }
);

const pedidoSchema = new mongoose.Schema(
  {
    sucursal: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal', required: true },
    serie: { type: String, default: SERIE_PEDIDO },
    folio: { type: Number, required: true },
    proveedor: { type: mongoose.Schema.Types.ObjectId, ref: 'Proveedor', required: true },
    proveedorNombre: { type: String, required: true },
    partidas: { type: [partidaSchema], validate: { validator: l => l.length > 0 && l.length <= 200, message: 'El pedido debe tener entre 1 y 200 productos' } },
    totalEstimado: { type: Number, default: 0 },
    notas: { type: String, trim: true, maxlength: 500 },
    origen: { type: String, enum: ['manual', 'sugeridas'], default: 'manual' },
    estado: { type: String, enum: ESTADOS, default: 'borrador' },
    enviadoEn: Date,
    recibidoEn: Date,
    compras: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Compra' }],
    cancelacion: { fecha: Date, motivo: String, usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' } },
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true }
  },
  { timestamps: true }
);

pedidoSchema.index({ sucursal: 1, serie: 1, folio: 1 }, { unique: true });
pedidoSchema.index({ sucursal: 1, estado: 1, createdAt: -1 });
pedidoSchema.index({ proveedor: 1, estado: 1 });
pedidoSchema.plugin(alcanceSucursal);

module.exports = mongoose.model('PedidoProveedor', pedidoSchema, 'pedidos_proveedor');
Object.assign(module.exports, { ESTADOS, SERIE_PEDIDO });

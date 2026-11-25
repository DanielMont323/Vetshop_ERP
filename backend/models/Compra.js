// Compra (recepción de mercancía) en una sucursal.
//
// Flujo: borrador (se puede editar) → recibida (al confirmar: crea capas y movimientos de entrada,
// ya no se edita) | cancelada (solo desde borrador).
//
// costoUnitario de cada partida: centavos SIN IVA, por pieza o por kg (como viene en la factura).
// El IVA de la factura se calcula por partida según la tasa del producto (copiada en la partida).
// Vencimiento: se guarda para las cuentas por pagar de la Fase 2.
const mongoose = require('mongoose');
const { alcanceSucursal } = require('./plugins/alcanceSucursal');

const ESTADOS = ['borrador', 'recibida', 'cancelada'];
const centavos = { type: Number, required: true, min: 0, validate: { validator: Number.isSafeInteger, message: 'Debe estar en centavos enteros' } };

const partidaSchema = new mongoose.Schema(
  {
    producto: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true },
    // Copias del producto al momento de la compra (para mostrar e imprimir sin consultar el catálogo)
    sku: { type: String, required: true },
    nombre: { type: String, required: true },
    unidad: { type: String, enum: ['pieza', 'kg'], required: true },
    tasaIva: { type: Number, required: true, min: 0 }, // puntos base
    cantidad: { type: Number, required: true, min: 1, validate: { validator: Number.isSafeInteger, message: 'Cantidad entera (piezas o gramos)' } },
    costoUnitario: centavos,
    importe: centavos, // sin IVA
    iva: centavos,
    lote: { type: String, trim: true, maxlength: 40 },
    caducidad: { type: Date, default: null },
    // Temperatura de llegada en °C (cadena de frío). Opcional.
    temperaturaLlegada: { type: Number, min: -40, max: 60 },
    // true si el producto requiere refrigeración y llegó fuera de 2–8 °C
    fueraDeRango: { type: Boolean, default: false },
    // Capa creada al confirmar
    capa: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLayer' }
  },
  { _id: false }
);

const compraSchema = new mongoose.Schema(
  {
    sucursal: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal', required: true },
    proveedor: { type: mongoose.Schema.Types.ObjectId, ref: 'Proveedor', required: true },
    proveedorNombre: { type: String, required: true },
    folioFactura: { type: String, required: [true, 'El folio de la factura es obligatorio'], trim: true, uppercase: true, maxlength: 40 },
    fechaFactura: { type: Date, required: true },
    condicionPago: { type: String, enum: ['contado', 'credito'], required: true },
    diasCredito: { type: Number, default: 0, min: 0 },
    vencimiento: { type: Date, default: null },
    partidas: {
      type: [partidaSchema],
      validate: { validator: l => l.length > 0 && l.length <= 200, message: 'La compra debe tener entre 1 y 200 partidas' }
    },
    subtotal: centavos,
    iva: centavos,
    total: centavos,
    estado: { type: String, enum: ESTADOS, default: 'borrador' },
    // false cuando se cancela: libera el folio de factura para volver a capturarlo
    vigente: { type: Boolean, default: true },
    observaciones: { type: String, trim: true, maxlength: 500 },
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
    recibidoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
    fechaRecepcion: { type: Date },
    canceladoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
    fechaCancelacion: { type: Date }
  },
  { timestamps: true }
);

compraSchema.index({ sucursal: 1, estado: 1, fechaFactura: -1 });
compraSchema.index({ sucursal: 1, proveedor: 1, fechaFactura: -1 });
// Una factura de un proveedor no se registra dos veces (en ninguna sucursal), salvo que se haya cancelado
compraSchema.index({ proveedor: 1, folioFactura: 1 }, { unique: true, partialFilterExpression: { vigente: true } });

compraSchema.plugin(alcanceSucursal);

module.exports = mongoose.model('Compra', compraSchema, 'compras');
module.exports.ESTADOS = ESTADOS;

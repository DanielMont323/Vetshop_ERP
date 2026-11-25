// Venta cobrada. INMUTABLE: no hay edición. Solo cambia a 'cancelada' (con autorización) y eso
// genera movimientos de inventario contrarios. Todo importe en centavos.
//
// Cada partida guarda COPIAS de lo que se cobró (precio unitario, lista aplicada, tasa de IVA,
// descuento) y de los lotes que salieron con su costo, para que la venta no cambie si después
// cambia el catálogo, y para calcular el margen.
const mongoose = require('mongoose');
const { alcanceSucursal } = require('./plugins/alcanceSucursal');

const METODOS_PAGO = ['efectivo', 'tarjeta', 'transferencia'];
const centavos = (requerido = true) => ({
  type: Number,
  required: requerido,
  min: 0,
  validate: { validator: v => v === undefined || v === null || Number.isSafeInteger(v), message: 'Debe estar en centavos enteros' }
});

const loteVendidoSchema = new mongoose.Schema(
  {
    capa: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLayer', required: true },
    lote: String,
    caducidad: Date,
    cantidad: { type: Number, required: true },
    costoUnitario: centavos(),
    costo: centavos()
  },
  { _id: false }
);

const partidaSchema = new mongoose.Schema(
  {
    producto: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true },
    sku: { type: String, required: true },
    nombre: { type: String, required: true },
    unidad: { type: String, enum: ['pieza', 'kg'], required: true },
    cantidad: { type: Number, required: true, min: 1 }, // piezas o gramos
    listaAplicada: { type: String, required: true }, // lista de la que salió el precio
    precioUnitario: centavos(), // con IVA, por pieza o por kg
    tipoIva: { type: String, required: true },
    tasaIva: { type: Number, required: true, min: 0 }, // puntos base
    bruto: centavos(), // precio × cantidad
    descuentoPorcentaje: { type: Number, min: 0, max: 10000 }, // puntos base, si se pidió en %
    descuento: centavos(),
    importe: centavos(), // bruto − descuento (con IVA)
    iva: centavos(), // IVA contenido en el importe
    costo: centavos(), // costo de los lotes que salieron (sin IVA)
    lotes: [loteVendidoSchema],
    requiereReceta: { type: Boolean, default: false },
    receta: { type: mongoose.Schema.Types.ObjectId, ref: 'Receta' } // receta que se surtió con esta partida
  },
  { _id: false }
);

const pagoSchema = new mongoose.Schema(
  {
    metodo: { type: String, enum: METODOS_PAGO, required: true },
    monto: { ...centavos(), min: 1 },
    referencia: { type: String, trim: true, maxlength: 40 } // últimos dígitos, folio de transferencia…
  },
  { _id: false }
);

const ventaSchema = new mongoose.Schema({
  sucursal: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal', required: true },
  serie: { type: String, required: true },
  folio: { type: Number, required: true },
  caja: { type: Number, required: true, default: 1 },
  turno: { type: mongoose.Schema.Types.ObjectId, ref: 'Turno', default: null }, // Paso 7
  cajero: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  cajeroNombre: { type: String, required: true },
  cliente: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', required: true },
  clienteNombre: { type: String, required: true },
  listaPrecios: { type: String, required: true },
  partidas: { type: [partidaSchema], validate: { validator: l => l.length > 0, message: 'La venta no tiene partidas' } },
  subtotal: centavos(), // suma de brutos
  descuento: centavos(),
  total: centavos(), // lo que se cobra (con IVA)
  iva: centavos(),
  costo: centavos(),
  pagos: { type: [pagoSchema], validate: { validator: l => l.length > 0, message: 'La venta no tiene pagos' } },
  cambio: centavos(), // se entrega en efectivo
  autorizacionDescuento: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  estado: { type: String, enum: ['cobrada', 'cancelada'], default: 'cobrada' },
  cancelacion: {
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
    autorizadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
    motivo: String,
    fecha: Date
  },
  // Clave que manda la caja para que un reintento (doble clic, red lenta) no cobre dos veces
  claveOperacion: { type: String, required: true },
  fecha: { type: Date, required: true, default: Date.now }
});

ventaSchema.index({ sucursal: 1, serie: 1, folio: 1 }, { unique: true });
ventaSchema.index({ sucursal: 1, claveOperacion: 1 }, { unique: true });
ventaSchema.index({ sucursal: 1, fecha: -1 });
ventaSchema.index({ sucursal: 1, cajero: 1, fecha: -1 });
ventaSchema.index({ sucursal: 1, turno: 1 });

// Inmutable salvo la cancelación, que se hace con updateOne filtrando estado 'cobrada'
ventaSchema.pre('save', function () {
  if (!this.isNew) throw new Error('Una venta cobrada no se puede modificar');
});
for (const op of ['deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne', 'findOneAndReplace']) {
  ventaSchema.pre(op, function () {
    throw new Error('Una venta no se puede borrar ni reemplazar');
  });
}
// Las únicas actualizaciones permitidas son las de la cancelación (estado y datos de cancelación)
const CAMPOS_ACTUALIZABLES = new Set(['estado', 'cancelacion']);
ventaSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], function () {
  const update = this.getUpdate() || {};
  if (Array.isArray(update)) throw new Error('Una venta cobrada no se puede modificar');
  const campos = Object.entries(update).flatMap(([k, v]) => (k.startsWith('$') ? Object.keys(v || {}) : [k]));
  if (campos.some(c => !CAMPOS_ACTUALIZABLES.has(c.split('.')[0]))) {
    throw new Error('Una venta cobrada no se puede modificar (solo cancelar)');
  }
});

ventaSchema.plugin(alcanceSucursal);

module.exports = mongoose.model('Venta', ventaSchema, 'ventas');
module.exports.METODOS_PAGO = METODOS_PAGO;

// Promoción (global, la crea el dueño). Se aplica sola en la caja, sin PIN, mientras esté vigente.
//
//   tipo 'precio':     precio final especial (centavos, con IVA) — solo por producto o por lote
//   tipo 'porcentaje': % de descuento sobre el precio de lista (puntos base, 1–10000)
//   alcance 'producto' | 'categoria' | 'lote' (un lote de un producto: para mover lo próximo a caducar;
//                       la caja vende primero ese lote y solo aplica el precio si alcanza su existencia)
//   sucursales: vacío = todas
//   vigencia: [desde, hasta) en UTC real (se capturan como días de Tepic)
const mongoose = require('mongoose');
const { CATEGORIAS } = require('./Producto');

const TIPOS = ['precio', 'porcentaje'];
const ALCANCES = ['producto', 'categoria', 'lote'];
const entero = { validator: Number.isSafeInteger, message: 'Debe ser un entero' };

const promocionSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: [true, 'El nombre es obligatorio'], trim: true, maxlength: 80 },
    tipo: { type: String, enum: { values: TIPOS, message: 'Tipo inválido (precio o porcentaje)' }, required: true },
    valor: { type: Number, required: true, min: [1, 'El valor debe ser mayor que cero'], validate: entero },
    alcance: { type: String, enum: { values: ALCANCES, message: 'Alcance inválido' }, required: true },
    producto: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto' },
    categoria: { type: String, enum: { values: CATEGORIAS, message: 'Categoría inválida' } },
    lote: { type: String, trim: true, maxlength: 40 },
    sucursales: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal' }], default: [] },
    desde: { type: Date, required: true },
    hasta: { type: Date, required: true },
    activa: { type: Boolean, default: true },
    creadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true }
  },
  { timestamps: true }
);

promocionSchema.index({ activa: 1, hasta: 1, desde: 1 });
promocionSchema.index({ producto: 1 });

promocionSchema.pre('validate', function () {
  if (this.alcance !== 'categoria') this.categoria = undefined;
  if (this.alcance === 'categoria') this.producto = undefined;
  if (this.alcance !== 'lote') this.lote = undefined;
  if (this.alcance !== 'categoria' && !this.producto) this.invalidate('producto', 'Elige el producto');
  if (this.alcance === 'categoria' && !this.categoria) this.invalidate('categoria', 'Elige la categoría');
  if (this.alcance === 'lote' && !this.lote) this.invalidate('lote', 'Escribe el lote');
  if (this.tipo === 'precio' && this.alcance === 'categoria') this.invalidate('tipo', 'Una promoción por categoría es por porcentaje');
  if (this.tipo === 'porcentaje' && this.valor > 10000) this.invalidate('valor', 'El porcentaje va de 0.01 a 100');
  if (this.desde && this.hasta && this.hasta <= this.desde) this.invalidate('hasta', 'La fecha final debe ser posterior a la inicial');
});

module.exports = mongoose.model('Promocion', promocionSchema, 'promociones');
Object.assign(module.exports, { TIPOS, ALCANCES });

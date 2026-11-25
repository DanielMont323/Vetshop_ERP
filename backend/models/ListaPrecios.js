// Lista de precios (global). Hay exactamente cuatro: publico, mayoreo, clinica y empleado.
// Cada precio es FINAL (con IVA incluido), en centavos, por pieza o por kg según la unidad del producto.
const mongoose = require('mongoose');

const LISTAS = [
  { clave: 'publico', nombre: 'Público' },
  { clave: 'mayoreo', nombre: 'Mayoreo' },
  { clave: 'clinica', nombre: 'Clínica' },
  { clave: 'empleado', nombre: 'Empleado' }
];
const CLAVES_LISTA = LISTAS.map(l => l.clave);
// Si un producto no tiene precio en la lista del cliente, se usa el de esta lista
const LISTA_BASE = 'publico';

const precioSchema = new mongoose.Schema(
  {
    producto: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true },
    precio: {
      type: Number,
      required: true,
      min: [0, 'El precio no puede ser negativo'],
      validate: { validator: Number.isSafeInteger, message: 'El precio debe estar en centavos enteros' }
    }
  },
  { _id: false }
);

const listaPreciosSchema = new mongoose.Schema(
  {
    clave: { type: String, enum: CLAVES_LISTA, required: true },
    nombre: { type: String, required: true, trim: true },
    precios: { type: [precioSchema], default: [] }
  },
  { timestamps: true }
);

listaPreciosSchema.index({ clave: 1 }, { unique: true });
// Buscar el precio de un producto en todas las listas
listaPreciosSchema.index({ 'precios.producto': 1 });

listaPreciosSchema.path('precios').validate(function (lista) {
  const ids = (lista || []).map(p => String(p.producto));
  return new Set(ids).size === ids.length;
}, 'Producto repetido en la lista de precios');

module.exports = mongoose.model('ListaPrecios', listaPreciosSchema, 'listas_precios');
Object.assign(module.exports, { LISTAS, CLAVES_LISTA, LISTA_BASE });

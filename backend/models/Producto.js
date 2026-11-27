// Producto del catálogo. Global (no lleva sucursal); solo los mínimos son por sucursal.
//
// Unidades: 'pieza' (cantidades en piezas) o 'kg' (cantidades en GRAMOS; precio y costo por kg).
// IVA: 'tasa_16', 'tasa_0' o 'exento'. Los precios de las listas son FINALES, con IVA incluido.
const mongoose = require('mongoose');
const { normalizar } = require('../helpers/texto');

const CATEGORIAS = ['medicamento', 'biologico', 'alimento', 'accesorio', 'higiene', 'otro'];
const UNIDADES = ['pieza', 'kg'];
const TIPOS_IVA = ['tasa_16', 'tasa_0', 'exento'];
const PUNTOS_BASE_IVA = { tasa_16: 1600, tasa_0: 0, exento: 0 };

const RE_SKU = /^[A-Z0-9._-]{1,30}$/;
const RE_CODIGO_BARRAS = /^[0-9A-Za-z-]{4,40}$/;

const minimoSchema = new mongoose.Schema(
  {
    sucursal: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal', required: true },
    // En unidad base: piezas o gramos
    cantidad: {
      type: Number,
      required: true,
      min: [0, 'El mínimo no puede ser negativo'],
      validate: { validator: Number.isSafeInteger, message: 'El mínimo debe ser un entero (piezas o gramos)' }
    },
    // Máximo opcional (compras sugeridas piden hasta aquí); 0 o ausente = sin máximo
    maximo: {
      type: Number,
      min: [0, 'El máximo no puede ser negativo'],
      validate: { validator: v => v === undefined || v === null || Number.isSafeInteger(v), message: 'El máximo debe ser un entero (piezas o gramos)' }
    }
  },
  { _id: false }
);

// Escala de mayoreo por cantidad: desde N (piezas o gramos) se cobra este precio final (centavos, con IVA)
const escalaSchema = new mongoose.Schema(
  {
    desde: { type: Number, required: true, min: [2, 'La escala empieza desde 2'], validate: { validator: Number.isSafeInteger, message: 'Cantidad entera (piezas o gramos)' } },
    precio: { type: Number, required: true, min: [0, 'Precio inválido'], validate: { validator: Number.isSafeInteger, message: 'El precio debe estar en centavos enteros' } }
  },
  { _id: false }
);

const productoSchema = new mongoose.Schema(
  {
    sku: {
      type: String,
      required: [true, 'El SKU es obligatorio'],
      trim: true,
      uppercase: true,
      match: [RE_SKU, 'El SKU solo admite letras, números, punto, guion y guion bajo (máx. 30)']
    },
    codigoBarras: {
      type: String,
      trim: true,
      match: [RE_CODIGO_BARRAS, 'Código de barras inválido (4 a 40 letras o números)']
    },
    nombre: { type: String, required: [true, 'El nombre es obligatorio'], trim: true, maxlength: 120 },
    // Copia normalizada del nombre para buscar sin acentos ni mayúsculas
    nombreBusqueda: { type: String, select: false },
    categoria: { type: String, enum: { values: CATEGORIAS, message: 'Categoría inválida' }, required: true },
    unidad: { type: String, enum: { values: UNIDADES, message: 'Unidad inválida (pieza o kg)' }, required: true },
    presentacion: { type: String, trim: true, maxlength: 80 },
    // Facturación: clave de producto/servicio y clave de unidad del SAT (sin clave: 01010101 y H87/KGM)
    claveSat: { type: String, trim: true, match: [/^\d{8}$/, 'Clave SAT: 8 dígitos'] },
    claveUnidadSat: { type: String, trim: true, uppercase: true, match: [/^[A-Z0-9]{2,3}$/, 'Clave de unidad SAT inválida'] },
    requiereReceta: { type: Boolean, default: false },
    esControlado: { type: Boolean, default: false },
    requiereRefrigeracion: { type: Boolean, default: false },
    iva: { type: String, enum: { values: TIPOS_IVA, message: 'Tipo de IVA inválido' }, required: true },
    activo: { type: Boolean, default: true },
    minimos: { type: [minimoSchema], default: [] },
    escalas: { type: [escalaSchema], default: [] }
  },
  { timestamps: true }
);

productoSchema.index({ sku: 1 }, { unique: true });
productoSchema.index({ codigoBarras: 1 }, { unique: true, partialFilterExpression: { codigoBarras: { $type: 'string' } } });
productoSchema.index({ nombreBusqueda: 1 });
productoSchema.index({ categoria: 1, activo: 1 });

productoSchema.pre('validate', function () {
  if (this.isModified('nombre') || !this.nombreBusqueda) this.nombreBusqueda = normalizar(this.nombre);
  if (this.codigoBarras === '') this.codigoBarras = undefined;
  if (this.claveSat === '') this.claveSat = undefined;
  if (this.claveUnidadSat === '') this.claveUnidadSat = undefined;
  // Un medicamento controlado siempre exige receta
  if (this.esControlado) this.requiereReceta = true;
});

productoSchema.path('minimos').validate(function (lista) {
  return (lista || []).every(m => !m.maximo || m.maximo >= m.cantidad);
}, 'El máximo no puede ser menor que el mínimo');

productoSchema.path('minimos').validate(function (lista) {
  const ids = (lista || []).map(m => String(m.sucursal));
  return new Set(ids).size === ids.length;
}, 'Sucursal repetida en los mínimos');

productoSchema.path('escalas').validate(function (lista) {
  const desdes = (lista || []).map(e => e.desde);
  return desdes.length <= 5 && new Set(desdes).size === desdes.length;
}, 'Máximo 5 escalas de mayoreo, sin repetir la cantidad');

productoSchema.pre('save', function () {
  if (this.isModified('escalas')) this.escalas.sort((a, b) => a.desde - b.desde);
});

productoSchema.methods.tasaIva = function () {
  return PUNTOS_BASE_IVA[this.iva];
};

module.exports = mongoose.model('Producto', productoSchema, 'productos');
Object.assign(module.exports, { CATEGORIAS, UNIDADES, TIPOS_IVA, PUNTOS_BASE_IVA, RE_SKU, RE_CODIGO_BARRAS });

// Cliente (global). Su lista de precios define cuánto se le cobra.
// "Público en general" es un cliente especial (esPublicoGeneral) que se usa cuando la venta no indica cliente.
const mongoose = require('mongoose');
const { CLAVES_LISTA } = require('./ListaPrecios');
const { RE_RFC } = require('./Proveedor');

const TIPOS = ['publico', 'clinica', 'veterinaria', 'petshop', 'estetica', 'empleado'];

const clienteSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: [true, 'El nombre es obligatorio'], trim: true, maxlength: 120 },
    tipo: { type: String, enum: { values: TIPOS, message: 'Tipo de cliente inválido' }, required: true },
    listaPrecios: { type: String, enum: { values: CLAVES_LISTA, message: 'Lista de precios inválida' }, required: true },
    rfc: { type: String, trim: true, uppercase: true, match: [RE_RFC, 'RFC inválido'] },
    telefono: { type: String, trim: true, maxlength: 20 },
    email: { type: String, trim: true, lowercase: true, maxlength: 120 },
    esPublicoGeneral: { type: Boolean, default: false },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true }
);

clienteSchema.index({ nombre: 1 }, { collation: { locale: 'es', strength: 1 } });
clienteSchema.index({ rfc: 1 }, { unique: true, partialFilterExpression: { rfc: { $type: 'string' } } });
// Solo puede existir un "Público en general"
clienteSchema.index({ esPublicoGeneral: 1 }, { unique: true, partialFilterExpression: { esPublicoGeneral: true } });

clienteSchema.pre('validate', function () {
  if (this.rfc === '') this.rfc = undefined;
});

module.exports = mongoose.model('Cliente', clienteSchema, 'clientes');
module.exports.TIPOS = TIPOS;

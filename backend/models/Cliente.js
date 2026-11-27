// Cliente (global). Su lista de precios define cuánto se le cobra.
// "Público en general" es un cliente especial (esPublicoGeneral) que se usa cuando la venta no indica cliente.
const mongoose = require('mongoose');
const { CLAVES_LISTA } = require('./ListaPrecios');
const { RE_RFC } = require('./Proveedor');
const { REGIMENES, USOS_CFDI, RE_CP } = require('../config/sat');

const TIPOS = ['publico', 'clinica', 'veterinaria', 'petshop', 'estetica', 'empleado'];
const entero = (min, max) => ({ type: Number, min, max, validate: { validator: v => v === undefined || Number.isSafeInteger(v), message: 'Debe ser un entero' } });

// Crédito (Fase 2). Solo el dueño lo configura. Límite en centavos; bonificación en puntos base (200 = 2 %).
const creditoSchema = new mongoose.Schema(
  {
    activo: { type: Boolean, default: false },
    limite: { ...entero(0), default: 0 },
    dias: { ...entero(1, 180), default: 30 },
    bonificacionProntoPago: { ...entero(0, 2000), default: 0 },
    diasProntoPago: { ...entero(0, 60), default: 8 },
    // Se escribe en cada venta a crédito y en cada abono: dos operaciones del mismo cliente no se cruzan
    ultimoMovimiento: Date
  },
  { _id: false }
);

// Datos para facturar (CFDI 4.0): deben coincidir con la constancia de situación fiscal del cliente
const fiscalSchema = new mongoose.Schema(
  {
    razonSocial: { type: String, trim: true, uppercase: true, maxlength: 254 },
    regimen: { type: String, enum: { values: Object.keys(REGIMENES), message: 'Régimen fiscal inválido' } },
    codigoPostal: { type: String, trim: true, match: [RE_CP, 'Código postal: 5 dígitos'] },
    usoCfdi: { type: String, enum: { values: Object.keys(USOS_CFDI), message: 'Uso de CFDI inválido' }, default: 'G03' }
  },
  { _id: false }
);

const clienteSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: [true, 'El nombre es obligatorio'], trim: true, maxlength: 120 },
    tipo: { type: String, enum: { values: TIPOS, message: 'Tipo de cliente inválido' }, required: true },
    listaPrecios: { type: String, enum: { values: CLAVES_LISTA, message: 'Lista de precios inválida' }, required: true },
    rfc: { type: String, trim: true, uppercase: true, match: [RE_RFC, 'RFC inválido'] },
    telefono: { type: String, trim: true, maxlength: 20 },
    email: { type: String, trim: true, lowercase: true, maxlength: 120 },
    // WhatsApp a 10 dígitos (recordatorios y avisos); dirección y notas para el directorio
    whatsapp: { type: String, trim: true, match: [/^\d{10}$/, 'WhatsApp: 10 dígitos'] },
    direccion: { type: String, trim: true, maxlength: 300 },
    notas: { type: String, trim: true, maxlength: 500 },
    esPublicoGeneral: { type: Boolean, default: false },
    credito: { type: creditoSchema, default: () => ({}) },
    fiscal: { type: fiscalSchema, default: () => ({}) },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true }
);

clienteSchema.index({ nombre: 1 }, { collation: { locale: 'es', strength: 1 } });
clienteSchema.index({ rfc: 1 }, { unique: true, partialFilterExpression: { rfc: { $type: 'string' } } });
// Solo puede existir un "Público en general"
clienteSchema.index({ esPublicoGeneral: 1 }, { unique: true, partialFilterExpression: { esPublicoGeneral: true } });
clienteSchema.index({ 'credito.activo': 1 });

clienteSchema.pre('validate', function () {
  if (this.rfc === '') this.rfc = undefined;
  if (this.whatsapp === '') this.whatsapp = undefined;
  if (this.esPublicoGeneral && this.credito?.activo) this.invalidate('credito.activo', '"Público en general" no puede tener crédito');
});

module.exports = mongoose.model('Cliente', clienteSchema, 'clientes');
module.exports.TIPOS = TIPOS;

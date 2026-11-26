// Comprobante fiscal (CFDI 4.0) emitido por una sucursal. Importes en centavos.
//
//   tipo I (ingreso): factura a cliente (desde ventas), global de público en general o autofactura
//   tipo E (egreso):  nota de crédito relacionada a una factura de ingreso
//   tipo P (pago):    complemento de pago de una factura PPD (venta a crédito)
//
// Flujo: pendiente (reservada, ventas marcadas) → timbrada | error (el PAC la rechazó: se liberan las ventas)
//        timbrada → cancelada (con motivo del SAT y PIN del dueño)
// El XML timbrado se guarda en el almacenamiento de archivos (xmlClave).
const mongoose = require('mongoose');
const { alcanceSucursal } = require('./plugins/alcanceSucursal');
const { MOTIVOS_CANCELACION } = require('../config/sat');

const centavos = { type: Number, required: true, min: 0, validate: { validator: Number.isSafeInteger, message: 'Centavos enteros' } };
const TIPOS = ['I', 'E', 'P'];
const MODALIDADES = ['cliente', 'global', 'autofactura', 'nota_credito', 'pago'];
const ESTADOS = ['pendiente', 'timbrada', 'error', 'cancelada'];

const conceptoSchema = new mongoose.Schema(
  {
    claveSat: { type: String, required: true },
    claveUnidad: { type: String, required: true },
    noIdentificacion: String, // SKU o folio del ticket (global)
    descripcion: { type: String, required: true },
    cantidad: { type: Number, required: true, min: 0 }, // piezas o kg (con decimales)
    importe: centavos, // base sin IVA
    iva: centavos,
    tasaIva: { type: Number, required: true } // puntos base (1600 = 16 %)
  },
  { _id: false }
);

const facturaSchema = new mongoose.Schema(
  {
    sucursal: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal', required: true },
    tipo: { type: String, enum: TIPOS, required: true },
    modalidad: { type: String, enum: MODALIDADES, required: true },
    serie: { type: String, required: true },
    folio: { type: Number, required: true },
    receptor: {
      cliente: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente' },
      rfc: { type: String, required: true },
      razonSocial: { type: String, required: true },
      regimen: { type: String, required: true },
      codigoPostal: { type: String, required: true },
      usoCfdi: { type: String, required: true },
      email: String
    },
    ventas: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Venta' }],
    global: { periodicidad: String, meses: String, anio: Number },
    conceptos: [conceptoSchema],
    subtotal: centavos,
    iva: centavos,
    total: centavos,
    formaPago: { type: String, required: true },
    metodoPago: { type: String, enum: ['PUE', 'PPD'], required: true },
    // Relación con otros CFDI (nota de crédito: 01 a la factura original)
    relacionados: { tipoRelacion: String, uuids: [String], facturas: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Factura' }] },
    // Complemento de pago
    pago: {
      fecha: Date,
      formaPago: String,
      monto: Number,
      documentos: [{ _id: false, factura: { type: mongoose.Schema.Types.ObjectId, ref: 'Factura' }, uuid: String, parcialidad: Number, saldoAnterior: Number, importePagado: Number, saldoInsoluto: Number }]
    },
    // Facturas PPD: lo que falta por pagar (lo reducen los complementos de pago)
    saldo: { type: Number, min: 0 },
    parcialidades: { type: Number, default: 0 },
    // Notas de crédito emitidas contra esta factura (centavos con IVA)
    acreditado: { type: Number, default: 0 },
    estado: { type: String, enum: ESTADOS, default: 'pendiente' },
    uuid: String,
    pac: { proveedor: String, id: String },
    fechaTimbrado: Date,
    xmlClave: String,
    error: String,
    cancelacion: {
      motivo: { type: String, enum: Object.keys(MOTIVOS_CANCELACION) },
      sustitucion: String,
      fecha: Date,
      usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
      autorizadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' }
    },
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' }, // null en autofactura
    claveOperacion: { type: String, required: true }
  },
  { timestamps: true }
);

facturaSchema.index({ sucursal: 1, serie: 1, folio: 1 }, { unique: true });
facturaSchema.index({ claveOperacion: 1 }, { unique: true });
facturaSchema.index({ uuid: 1 }, { unique: true, partialFilterExpression: { uuid: { $type: 'string' } } });
facturaSchema.index({ sucursal: 1, createdAt: -1 });
facturaSchema.index({ sucursal: 1, 'receptor.rfc': 1 });

facturaSchema.plugin(alcanceSucursal);

module.exports = mongoose.model('Factura', facturaSchema, 'facturas');
Object.assign(module.exports, { TIPOS, MODALIDADES, ESTADOS });

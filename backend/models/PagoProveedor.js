// Pago a un proveedor (solo dueño). Se reparte entre sus facturas pendientes (aplicaciones); se permiten
// abonos parciales. No sale de la caja de una sucursal (los pagos de caja se registran como retiro de efectivo).
// Importes en centavos.
const mongoose = require('mongoose');

const centavos = { type: Number, required: true, min: 0, validate: { validator: Number.isSafeInteger, message: 'Centavos enteros' } };
const METODOS_PAGO_PROVEEDOR = ['transferencia', 'efectivo', 'cheque'];

const pagoSchema = new mongoose.Schema(
  {
    proveedor: { type: mongoose.Schema.Types.ObjectId, ref: 'Proveedor', required: true },
    proveedorNombre: { type: String, required: true },
    fecha: { type: Date, required: true }, // día en que se pagó (puede registrarse después)
    metodo: { type: String, enum: METODOS_PAGO_PROVEEDOR, required: true },
    referencia: { type: String, trim: true, maxlength: 60 }, // folio de transferencia, número de cheque…
    nota: { type: String, trim: true, maxlength: 300 },
    monto: { ...centavos, min: 1 },
    aplicaciones: {
      type: [{ _id: false, cuenta: { type: mongoose.Schema.Types.ObjectId, ref: 'CuentaPorPagar', required: true }, folioFactura: String, monto: centavos }],
      validate: { validator: l => l.length > 0, message: 'El pago no se aplicó a ninguna factura' }
    },
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
    usuarioNombre: { type: String, required: true },
    estado: { type: String, enum: ['aplicado', 'cancelado'], default: 'aplicado' },
    cancelacion: { fecha: Date, motivo: String, usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' } },
    claveOperacion: { type: String, required: true }
  },
  { timestamps: true }
);

pagoSchema.index({ claveOperacion: 1 }, { unique: true });
pagoSchema.index({ proveedor: 1, fecha: -1 });
pagoSchema.index({ fecha: -1 });

module.exports = mongoose.model('PagoProveedor', pagoSchema, 'pagos_proveedores');
module.exports.METODOS_PAGO_PROVEEDOR = METODOS_PAGO_PROVEEDOR;

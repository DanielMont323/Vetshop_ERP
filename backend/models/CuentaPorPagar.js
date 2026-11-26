// Cuenta por pagar a un proveedor: una por cada compra RECIBIDA (factura). Importes en centavos.
//
// Las compras de contado se registran ya pagadas (pagadaAlRecibir); las de crédito quedan pendientes hasta que
// los pagos (PagoProveedor) cubran el total. Los pagos los hace el dueño de forma centralizada, por eso esta
// colección es global (sin plugin de alcance); `sucursal` es la que recibió la mercancía, para reportes.
//
//   saldo = total − pagado        estado: pendiente → pagada
const mongoose = require('mongoose');

const centavos = { type: Number, required: true, min: 0, validate: { validator: Number.isSafeInteger, message: 'Centavos enteros' } };

const cuentaSchema = new mongoose.Schema(
  {
    proveedor: { type: mongoose.Schema.Types.ObjectId, ref: 'Proveedor', required: true },
    proveedorNombre: { type: String, required: true },
    sucursal: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal', required: true },
    compra: { type: mongoose.Schema.Types.ObjectId, ref: 'Compra', required: true },
    folioFactura: { type: String, required: true },
    fechaFactura: { type: Date, required: true },
    condicionPago: { type: String, enum: ['contado', 'credito'], required: true },
    vencimiento: { type: Date, required: true },
    total: centavos,
    pagado: { ...centavos, default: 0 },
    saldo: centavos,
    estado: { type: String, enum: ['pendiente', 'pagada'], default: 'pendiente' },
    pagadaAlRecibir: { type: Boolean, default: false } // compra de contado
  },
  { timestamps: true }
);

cuentaSchema.index({ compra: 1 }, { unique: true });
cuentaSchema.index({ estado: 1, vencimiento: 1 });
cuentaSchema.index({ proveedor: 1, estado: 1, vencimiento: 1 });
cuentaSchema.index({ fechaFactura: -1 });

module.exports = mongoose.model('CuentaPorPagar', cuentaSchema, 'cuentas_por_pagar');

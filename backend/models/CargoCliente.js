// Cargo a la cuenta de un cliente: la parte a crédito de una venta. Importes en centavos.
//
// La cuenta es del CLIENTE (global, como Cliente): se paga en cualquier sucursal. `sucursal` es la
// de la venta, para reportes. Por eso esta colección no lleva el plugin de alcance; los servicios
// filtran siempre por cliente.
//
//   saldo = importe − abonado − bonificado
//   estado: pendiente → pagado (saldo 0) | cancelado (se canceló la venta sin abonos)
const mongoose = require('mongoose');

const centavos = { type: Number, required: true, min: 0, validate: { validator: Number.isSafeInteger, message: 'Centavos enteros' } };
const ESTADOS = ['pendiente', 'pagado', 'cancelado'];

const cargoSchema = new mongoose.Schema(
  {
    cliente: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', required: true },
    clienteNombre: { type: String, required: true },
    sucursal: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal', required: true },
    venta: { type: mongoose.Schema.Types.ObjectId, ref: 'Venta', required: true },
    folio: { type: String, required: true }, // folio de la venta (p. ej. V-123)
    fecha: { type: Date, required: true },
    vencimiento: { type: Date, required: true }, // fin del día de vencimiento (hora de Tepic)
    // Bonificación por pronto pago pactada al vender (copia de las condiciones del cliente en ese momento)
    prontoPago: {
      tasa: { type: Number, default: 0 }, // puntos base
      fechaLimite: Date
    },
    importe: centavos,
    abonado: { ...centavos, default: 0 },
    bonificado: { ...centavos, default: 0 },
    saldo: centavos,
    estado: { type: String, enum: ESTADOS, default: 'pendiente' },
    cancelacion: { fecha: Date, usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' } }
  },
  { timestamps: true }
);

cargoSchema.index({ venta: 1 }, { unique: true });
cargoSchema.index({ cliente: 1, estado: 1, vencimiento: 1 });
cargoSchema.index({ estado: 1, vencimiento: 1 });
cargoSchema.index({ cliente: 1, fecha: -1 });

module.exports = mongoose.model('CargoCliente', cargoSchema, 'cargos_clientes');
module.exports.ESTADOS = ESTADOS;

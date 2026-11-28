// Abono (pago) de un cliente a su cuenta. Se reparte entre sus cargos pendientes (aplicaciones).
// Si con el abono un cargo queda liquidado dentro del plazo de pronto pago, se le aplica la
// bonificación pactada (no es dinero: reduce el saldo).
//
// Global por cliente (ver CargoCliente). `sucursal` y `turno` son donde se recibió el dinero:
// los abonos que tienen turno entran al corte de ese turno. Importes en centavos.
const mongoose = require('mongoose');

const centavos = { type: Number, required: true, min: 0, validate: { validator: Number.isSafeInteger, message: 'Centavos enteros' } };
const METODOS_ABONO = ['efectivo', 'tarjeta', 'transferencia'];
const SERIE_ABONO = 'A';

const aplicacionSchema = new mongoose.Schema(
  {
    cargo: { type: mongoose.Schema.Types.ObjectId, ref: 'CargoCliente', required: true },
    folio: { type: String, required: true },
    monto: centavos,
    bonificacion: { ...centavos, default: 0 }
  },
  { _id: false }
);

const abonoSchema = new mongoose.Schema(
  {
    cliente: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', required: true },
    clienteNombre: { type: String, required: true },
    sucursal: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal', required: true },
    serie: { type: String, required: true, default: SERIE_ABONO },
    folio: { type: Number, required: true },
    turno: { type: mongoose.Schema.Types.ObjectId, ref: 'Turno', default: null },
    fecha: { type: Date, required: true },
    metodo: { type: String, enum: METODOS_ABONO, required: true },
    referencia: { type: String, trim: true, maxlength: 40 },
    monto: { ...centavos, min: 1 }, // dinero recibido
    bonificacion: { ...centavos, default: 0 }, // total bonificado por pronto pago
    aplicaciones: { type: [aplicacionSchema], validate: { validator: l => l.length > 0, message: 'El abono no se aplicó a ningún cargo' } },
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
    usuarioNombre: { type: String, required: true },
    estado: { type: String, enum: ['aplicado', 'cancelado'], default: 'aplicado' },
    cancelacion: {
      fecha: Date,
      motivo: String,
      usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
      autorizadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' }
    },
    // Complementos de pago (CFDI tipo P) que se timbraron por este abono, uno por factura PPD cubierta
    complementos: [{
      _id: false,
      factura: { type: mongoose.Schema.Types.ObjectId, ref: 'Factura', required: true },
      folioFactura: String,
      monto: Number,
      estado: { type: String, enum: ['timbrado', 'error'], required: true },
      complemento: { type: mongoose.Schema.Types.ObjectId, ref: 'Factura' },
      folio: String,
      uuid: String,
      mensaje: String,
      fecha: { type: Date, default: Date.now }
    }],
    // Un reintento (doble clic, red lenta) no registra el abono dos veces
    claveOperacion: { type: String, required: true }
  },
  { timestamps: true }
);

abonoSchema.index({ sucursal: 1, serie: 1, folio: 1 }, { unique: true });
abonoSchema.index({ claveOperacion: 1 }, { unique: true });
abonoSchema.index({ cliente: 1, fecha: -1 });
abonoSchema.index({ turno: 1 });
abonoSchema.index({ sucursal: 1, fecha: -1 });

module.exports = mongoose.model('AbonoCliente', abonoSchema, 'abonos_clientes');
Object.assign(module.exports, { METODOS_ABONO, SERIE_ABONO });

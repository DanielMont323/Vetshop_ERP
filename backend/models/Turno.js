// Turno de caja (por sucursal y caja). Todas las ventas se ligan al turno abierto del cajero.
//
// Flujo:  abierto → (conteo ciego) → cerrado            si no hay diferencias
//                                   → contado → cerrado  si hay diferencia: justificación + PIN del dueño
//
// Corte ciego: el cajero captura el efectivo por denominación y el total de la terminal SIN ver lo
// esperado. Al registrar el conteo ya no se puede recontar; entonces se muestran las diferencias.
// Importes en centavos.
const mongoose = require('mongoose');
const { alcanceSucursal } = require('./plugins/alcanceSucursal');

const ESTADOS = ['abierto', 'contado', 'cerrado'];
// Billetes y monedas de México, en centavos
const DENOMINACIONES = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50];

const centavos = { type: Number, min: 0, validate: { validator: v => v === undefined || Number.isSafeInteger(v), message: 'Centavos enteros' } };
const conSigno = { type: Number, validate: { validator: v => v === undefined || Number.isSafeInteger(v), message: 'Centavos enteros' } };

const conteoSchema = new mongoose.Schema(
  {
    denominacion: { type: Number, enum: DENOMINACIONES, required: true },
    cantidad: { type: Number, required: true, min: 0, validate: { validator: Number.isSafeInteger, message: 'Cantidad entera' } }
  },
  { _id: false }
);

const porMetodo = { efectivo: conSigno, tarjeta: conSigno, transferencia: conSigno };

const turnoSchema = new mongoose.Schema(
  {
    sucursal: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal', required: true },
    caja: { type: Number, required: true, min: 1, default: 1 },
    cajero: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
    cajeroNombre: { type: String, required: true },
    estado: { type: String, enum: ESTADOS, default: 'abierto' },
    // true mientras está abierto o en corte; false al cerrar (lo usan los índices únicos)
    vigente: { type: Boolean, default: true },
    apertura: {
      fecha: { type: Date, required: true },
      fondo: { ...centavos, required: true },
      denominaciones: [conteoSchema]
    },
    // Se actualiza en cada venta y cancelación: así una venta y el conteo del corte nunca se cruzan
    // (las dos transacciones escriben este documento y Mongo serializa)
    ultimoMovimiento: Date,
    // Salidas de efectivo durante el turno:
    //   retiro: con PIN del dueño (p. ej. llevar efectivo al banco)
    //   gasto:  gasto de caja con concepto (mandadito…); sin PIN hasta el tope por turno de la configuración
    retiros: [
      {
        _id: false,
        tipo: { type: String, enum: ['retiro', 'gasto'], default: 'retiro' },
        concepto: { type: String, maxlength: 40 },
        monto: { ...centavos, required: true },
        motivo: { type: String, required: true, maxlength: 200 },
        usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
        autorizadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' }, // vacío: gasto dentro del tope sin PIN
        fecha: { type: Date, required: true }
      }
    ],
    conteo: {
      fecha: Date,
      denominaciones: [conteoSchema],
      contado: porMetodo, // efectivo contado, total de terminal (tarjeta), transferencias confirmadas
      esperado: porMetodo,
      diferencias: porMetodo, // contado − esperado (+ sobrante, − faltante)
      ventas: Number,
      canceladas: Number,
      abonos: Number // abonos de clientes recibidos en el turno
    },
    cierre: {
      fecha: Date,
      justificacion: { type: String, maxlength: 500 },
      autorizadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
      autorizadoPorNombre: String
    }
  },
  { timestamps: true }
);

// Una sola caja abierta (o en corte) por sucursal y número de caja, y un solo turno abierto por cajero y sucursal
turnoSchema.index({ sucursal: 1, caja: 1 }, { unique: true, partialFilterExpression: { vigente: true } });
turnoSchema.index({ sucursal: 1, cajero: 1 }, { unique: true, partialFilterExpression: { vigente: true } });
turnoSchema.index({ sucursal: 1, createdAt: -1 });

turnoSchema.plugin(alcanceSucursal);

module.exports = mongoose.model('Turno', turnoSchema, 'turnos');
Object.assign(module.exports, { ESTADOS, DENOMINACIONES });

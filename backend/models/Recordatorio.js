// Recordatorio para avisar a un cliente por WhatsApp: la próxima cita de su mascota (en su clínica o estética),
// el siguiente costal de alimento, desparasitante, vacuna… Es por sucursal (la que lo registró y lo avisa).
//
//   fecha:       día del evento (AAAA-MM-DD, día de Tepic)
//   fechaAviso:  día en que aparece en «Recordatorios de hoy» = fecha − diasAntes
//   repetirCadaDias: al marcarlo «hecho» se programa el siguiente (alimento cada 30, vacuna cada 365…)
const mongoose = require('mongoose');
const { alcanceSucursal } = require('./plugins/alcanceSucursal');

const TIPOS = ['cita', 'alimento', 'desparasitante', 'vacuna', 'medicamento', 'otro'];
const ESTADOS = ['pendiente', 'avisado', 'hecho', 'cancelado'];
const YMD = [/^\d{4}-\d{2}-\d{2}$/, 'Fecha: AAAA-MM-DD'];

const recordatorioSchema = new mongoose.Schema(
  {
    sucursal: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal', required: true },
    cliente: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', required: true },
    mascota: { type: mongoose.Schema.Types.ObjectId, ref: 'Mascota' },
    tipo: { type: String, enum: { values: TIPOS, message: 'Tipo de recordatorio inválido' }, required: true },
    descripcion: { type: String, required: [true, 'Describe el recordatorio'], trim: true, maxlength: 150 },
    producto: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto' },
    fecha: { type: String, required: true, match: YMD },
    diasAntes: { type: Number, min: 0, max: 30 },
    fechaAviso: { type: String, required: true, match: YMD },
    repetirCadaDias: { type: Number, min: 1, max: 730 },
    estado: { type: String, enum: ESTADOS, default: 'pendiente' },
    avisadoEn: Date,
    avisadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
    terminadoEn: Date,
    siguiente: { type: mongoose.Schema.Types.ObjectId, ref: 'Recordatorio' },
    creadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true }
  },
  { timestamps: true }
);

recordatorioSchema.index({ sucursal: 1, estado: 1, fechaAviso: 1 });
recordatorioSchema.index({ cliente: 1, estado: 1 });
recordatorioSchema.plugin(alcanceSucursal);

module.exports = mongoose.model('Recordatorio', recordatorioSchema, 'recordatorios');
Object.assign(module.exports, { TIPOS, ESTADOS });

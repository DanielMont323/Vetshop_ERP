// Intentos de autofactura (página pública) por IP. Se borran solos a los 15 minutos (índice TTL).
// Sirven para limitar a quien prueba folios y totales al azar.
const mongoose = require('mongoose');

const intentoSchema = new mongoose.Schema({
  ip: { type: String, required: true },
  exito: { type: Boolean, default: false },
  fecha: { type: Date, default: Date.now }
});

intentoSchema.index({ fecha: 1 }, { expireAfterSeconds: 15 * 60 });
intentoSchema.index({ ip: 1, fecha: -1 });

module.exports = mongoose.model('IntentoAutofactura', intentoSchema, 'intentos_autofactura');

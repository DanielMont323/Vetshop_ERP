// Bitácora: quién hizo qué, sobre qué entidad, con qué valores antes y después.
// Solo se inserta; nunca se edita ni se borra.
const mongoose = require('mongoose');

const auditoriaSchema = new mongoose.Schema({
  usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  // Quien autorizó con su PIN (si la acción lo requería)
  autorizadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  accion: { type: String, required: true, trim: true }, // p. ej. 'usuario.crear', 'venta.cambiar_forma_pago'
  entidad: { type: String, required: true, trim: true }, // p. ej. 'Usuario', 'Venta'
  entidadId: { type: mongoose.Schema.Types.ObjectId },
  // Opcional: las acciones sobre catálogos globales (usuarios, sucursales) no tienen sucursal
  sucursal: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal' },
  antes: { type: mongoose.Schema.Types.Mixed },
  despues: { type: mongoose.Schema.Types.Mixed },
  motivo: { type: String, trim: true, maxlength: 500 },
  fecha: { type: Date, default: Date.now, required: true }
});

auditoriaSchema.index({ entidad: 1, entidadId: 1, fecha: -1 });
auditoriaSchema.index({ sucursal: 1, fecha: -1 });
auditoriaSchema.index({ accion: 1, fecha: -1 });

// Inmutable: bloquear actualizaciones y borrados desde Mongoose
const prohibido = function () {
  throw new Error('La bitácora no se puede modificar ni borrar');
};
auditoriaSchema.pre('save', function () {
  if (!this.isNew) throw new Error('La bitácora no se puede modificar ni borrar');
});
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  auditoriaSchema.pre(op, prohibido);
}

module.exports = mongoose.model('Auditoria', auditoriaSchema, 'auditoria');

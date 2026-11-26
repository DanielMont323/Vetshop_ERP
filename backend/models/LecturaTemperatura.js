// Lectura de temperatura de un equipo de frío. Inmutable (bitácora sanitaria): no se edita ni se borra.
// Fuera del rango del equipo exige acción correctiva (qué se hizo y productos afectados).
const mongoose = require('mongoose');
const { alcanceSucursal } = require('./plugins/alcanceSucursal');

const lecturaSchema = new mongoose.Schema({
  sucursal: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal', required: true },
  equipo: { type: mongoose.Schema.Types.ObjectId, ref: 'EquipoFrio', required: true },
  equipoNombre: { type: String, required: true },
  fecha: { type: Date, required: true },
  temperatura: { type: Number, required: true, min: -40, max: 60 },
  rango: { minimo: { type: Number, required: true }, maximo: { type: Number, required: true } }, // copia al momento
  fueraDeRango: { type: Boolean, required: true },
  observacion: { type: String, trim: true, maxlength: 300 },
  accionCorrectiva: { type: String, trim: true, maxlength: 500 },
  productosAfectados: { type: String, trim: true, maxlength: 500 },
  usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  usuarioNombre: { type: String, required: true }
});

lecturaSchema.index({ sucursal: 1, equipo: 1, fecha: -1 });
lecturaSchema.index({ sucursal: 1, fueraDeRango: 1, fecha: -1 });

lecturaSchema.path('accionCorrectiva').validate(function (v) {
  return !this.fueraDeRango || Boolean(v && v.trim().length >= 5);
}, 'Fuera de rango: describe la acción correctiva');

lecturaSchema.pre('save', function () {
  if (!this.isNew) throw new Error('Una lectura de temperatura no se puede modificar');
});
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  lecturaSchema.pre(op, function () {
    throw new Error('Una lectura de temperatura no se puede modificar ni borrar');
  });
}

lecturaSchema.plugin(alcanceSucursal);

module.exports = mongoose.model('LecturaTemperatura', lecturaSchema, 'lecturas_temperatura');

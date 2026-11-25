// Plugin de alcance por sucursal: red de seguridad para que NINGUNA consulta a una colección
// operativa se ejecute sin filtro de sucursal (aunque a un servicio se le olvide).
//
//   esquema.plugin(alcanceSucursal)                                  → campo 'sucursal'
//   esquema.plugin(alcanceSucursal, { campos: ['origen', 'destino'] }) → Traspaso
//
// Reglas:
//   - find/findOne/count/update/delete/replace/distinct: el filtro debe restringir alguno de los
//     campos (igualdad, $eq, $in no vacío, o $exists: true que usa el dueño para "todas").
//     También vale dentro de $and, o en TODAS las ramas de un $or.
//   - aggregate: la PRIMERA etapa del pipeline debe ser un $match que cumpla lo anterior.
//   - estimatedDocumentCount no admite filtro: siempre se rechaza.
//   - Escape explícito para scripts/migraciones: .setOptions({ sinAlcance: true })
//     (en aggregate: Modelo.aggregate(pipeline).option({ sinAlcance: true })).
//
// El plugin solo verifica que el filtro EXISTA; que su valor esté dentro de las sucursales
// permitidas lo garantiza conAlcance() (helpers/alcance.js) con req.alcance.
const mongoose = require('mongoose');

class ErrorAlcance extends Error {
  constructor(modelo, operacion, campos) {
    super(`[ALCANCE] ${modelo}.${operacion} sin filtro de ${campos.join(' / ')}. Usa conAlcance() en el servicio.`);
    this.name = 'ErrorAlcance';
  }
}

const OPERACIONES_QUERY = [
  'find', 'findOne', 'countDocuments', 'distinct',
  'updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete'
];

function esOperadores(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor) &&
    !(valor instanceof mongoose.Types.ObjectId) && Object.keys(valor).some(k => k.startsWith('$'));
}

function valorRestringe(valor) {
  if (valor === undefined || valor === null) return false;
  if (!esOperadores(valor)) return true; // igualdad directa (ObjectId o string)
  const claves = Object.keys(valor);
  return claves.every(k => {
    if (k === '$eq') return valorRestringe(valor.$eq);
    if (k === '$in') return Array.isArray(valor.$in) && valor.$in.length > 0 && valor.$in.every(v => v != null);
    if (k === '$exists') return valor.$exists === true;
    return false; // $ne, $nin, $regex… no restringen la sucursal
  });
}

function filtroTieneAlcance(filtro, campos) {
  if (!filtro || typeof filtro !== 'object') return false;
  if (campos.some(c => Object.prototype.hasOwnProperty.call(filtro, c) && valorRestringe(filtro[c]))) return true;
  if (Array.isArray(filtro.$and) && filtro.$and.some(sub => filtroTieneAlcance(sub, campos))) return true;
  if (Array.isArray(filtro.$or) && filtro.$or.length > 0 && filtro.$or.every(sub => filtroTieneAlcance(sub, campos))) return true;
  return false;
}

function alcanceSucursal(schema, { campos = ['sucursal'] } = {}) {
  for (const campo of campos) {
    if (!schema.path(campo)) throw new Error(`alcanceSucursal: el esquema no tiene el campo "${campo}"`);
  }
  schema.statics.camposAlcance = campos;

  schema.pre(OPERACIONES_QUERY, function () {
    if (this.getOptions().sinAlcance) return;
    if (!filtroTieneAlcance(this.getFilter(), campos)) {
      throw new ErrorAlcance(this.model.modelName, this.op, campos);
    }
  });

  schema.pre('estimatedDocumentCount', function () {
    if (this.getOptions().sinAlcance) return;
    throw new ErrorAlcance(this.model.modelName, 'estimatedDocumentCount', campos);
  });

  schema.pre('aggregate', function () {
    if (this.options && this.options.sinAlcance) return;
    const primera = this.pipeline()[0];
    if (!primera || !primera.$match || !filtroTieneAlcance(primera.$match, campos)) {
      throw new ErrorAlcance(this._model ? this._model.modelName : 'Modelo', 'aggregate (la primera etapa debe ser $match con sucursal)', campos);
    }
  });
}

module.exports = { alcanceSucursal, filtroTieneAlcance, ErrorAlcance };

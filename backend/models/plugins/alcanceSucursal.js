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
//   - Las actualizaciones no pueden cambiar los campos de sucursal (un documento no se "muda"
//     de sucursal: eso es un traspaso).
//   - aggregate: la PRIMERA etapa del pipeline debe ser un $match que cumpla lo anterior.
//   - insertMany: CADA documento debe traer todos los campos de sucursal (también con lean: true,
//     que se salta la validación del esquema).
//   - bulkWrite: cada insertOne trae los campos; cada update/replace/delete tiene filtro con
//     alcance; los update no cambian los campos; los replace conservan los campos.
//   - estimatedDocumentCount no admite filtro: siempre se rechaza.
//   - Escape explícito para scripts/migraciones: .setOptions({ sinAlcance: true }),
//     aggregate(...).option({ sinAlcance: true }), insertMany(docs, { sinAlcance: true }),
//     bulkWrite(ops, { sinAlcance: true }).
//
// El plugin solo verifica que el filtro EXISTA; que su valor esté dentro de las sucursales
// permitidas lo garantiza conAlcance() (helpers/alcance.js) con req.alcance.
const mongoose = require('mongoose');

class ErrorAlcance extends Error {
  constructor(modelo, operacion, campos, detalle = 'sin filtro de') {
    super(`[ALCANCE] ${modelo}.${operacion} ${detalle} ${campos.join(' / ')}. Usa conAlcance() en el servicio.`);
    this.name = 'ErrorAlcance';
  }
}

const OPERACIONES_QUERY = [
  'find', 'findOne', 'countDocuments', 'distinct',
  'updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete'
];
const OPERACIONES_UPDATE = new Set(['updateOne', 'updateMany', 'findOneAndUpdate']);
const OPERACIONES_REPLACE = new Set(['replaceOne', 'findOneAndReplace']);

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

// ¿El documento a insertar trae TODOS los campos de sucursal con valor?
function documentoTieneCampos(doc, campos) {
  if (!doc || typeof doc !== 'object') return false;
  const plano = typeof doc.toObject === 'function' ? doc.toObject({ depopulate: true }) : doc;
  return campos.every(c => plano[c] != null && !esOperadores(plano[c]));
}

// ¿La actualización toca algún campo de sucursal? (en la raíz o dentro de cualquier operador)
function actualizacionTocaCampos(update, campos) {
  if (!update || typeof update !== 'object') return false;
  if (Array.isArray(update)) return update.some(etapa => actualizacionTocaCampos(etapa, campos)); // pipeline de update
  return Object.entries(update).some(([clave, valor]) => {
    if (clave.startsWith('$')) {
      if (valor && typeof valor === 'object') {
        // $rename: { viejo: 'nuevo' } también "toca" si el destino es un campo de sucursal
        const destinos = clave === '$rename' ? Object.values(valor) : [];
        return Object.keys(valor).some(k => campos.includes(k.split('.')[0])) || destinos.some(d => campos.includes(String(d).split('.')[0]));
      }
      return false;
    }
    return campos.includes(clave.split('.')[0]);
  });
}

function revisarOperacionBulk(op, campos, modelo) {
  const [tipo] = Object.keys(op || {});
  const cuerpo = op && op[tipo];
  const error = detalle => new ErrorAlcance(modelo, `bulkWrite.${tipo}`, campos, detalle);
  switch (tipo) {
    case 'insertOne':
      if (!documentoTieneCampos(cuerpo && cuerpo.document, campos)) throw error('sin documento con');
      return;
    case 'updateOne':
    case 'updateMany':
      if (!filtroTieneAlcance(cuerpo && cuerpo.filter, campos)) throw error('sin filtro de');
      if (actualizacionTocaCampos(cuerpo.update, campos)) throw error('no puede cambiar');
      return;
    case 'replaceOne':
      if (!filtroTieneAlcance(cuerpo && cuerpo.filter, campos)) throw error('sin filtro de');
      if (!documentoTieneCampos(cuerpo.replacement, campos)) throw error('reemplazo sin');
      return;
    case 'deleteOne':
    case 'deleteMany':
      if (!filtroTieneAlcance(cuerpo && cuerpo.filter, campos)) throw error('sin filtro de');
      return;
    default:
      throw new ErrorAlcance(modelo, `bulkWrite.${tipo}`, campos, 'operación no reconocida para');
  }
}

function alcanceSucursal(schema, { campos = ['sucursal'] } = {}) {
  for (const campo of campos) {
    if (!schema.path(campo)) throw new Error(`alcanceSucursal: el esquema no tiene el campo "${campo}"`);
  }
  schema.statics.camposAlcance = campos;

  schema.pre(OPERACIONES_QUERY, function () {
    if (this.getOptions().sinAlcance) return;
    const modelo = this.model.modelName;
    if (!filtroTieneAlcance(this.getFilter(), campos)) {
      throw new ErrorAlcance(modelo, this.op, campos);
    }
    if (OPERACIONES_UPDATE.has(this.op) && actualizacionTocaCampos(this.getUpdate(), campos)) {
      throw new ErrorAlcance(modelo, this.op, campos, 'no puede cambiar');
    }
    if (OPERACIONES_REPLACE.has(this.op) && !documentoTieneCampos(this.getUpdate(), campos)) {
      throw new ErrorAlcance(modelo, this.op, campos, 'reemplazo sin');
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

  // Middleware de modelo: `this` es el modelo. Firma (next, docs, options) en insertMany
  // y (next, ops, options) en bulkWrite.
  schema.pre('insertMany', function (next, docs, options) {
    if (options && options.sinAlcance) return next();
    const lista = Array.isArray(docs) ? docs : [docs];
    const malo = lista.findIndex(d => !documentoTieneCampos(d, campos));
    if (malo !== -1) return next(new ErrorAlcance(this.modelName, `insertMany (documento ${malo})`, campos, 'sin'));
    next();
  });

  schema.pre('bulkWrite', function (next, ops, options) {
    if (options && options.sinAlcance) return next();
    try {
      for (const op of ops || []) revisarOperacionBulk(op, campos, this.modelName);
      next();
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { alcanceSucursal, filtroTieneAlcance, ErrorAlcance };

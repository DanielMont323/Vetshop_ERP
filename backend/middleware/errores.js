// Convierte cualquier error en una respuesta JSON uniforme: { ok: false, codigo, mensaje, detalles? }.
// Nunca expone el stack ni mensajes internos en producción.
const { ErrorApp } = require('../helpers/errores');

function rutaNoEncontrada(req, res) {
  res.status(404).json({ ok: false, codigo: 'RUTA_NO_ENCONTRADA', mensaje: 'Ruta no encontrada' });
}

// eslint-disable-next-line no-unused-vars
function manejarErrores(err, req, res, next) {
  if (err instanceof ErrorApp) {
    const cuerpo = { ok: false, codigo: err.codigo, mensaje: err.message };
    if (err.detalles !== undefined) cuerpo.detalles = err.detalles;
    return res.status(err.status).json(cuerpo);
  }
  // JSON mal formado en el cuerpo
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, codigo: 'JSON_INVALIDO', mensaje: 'El cuerpo de la petición no es JSON válido' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, codigo: 'DEMASIADO_GRANDE', mensaje: 'La petición es demasiado grande' });
  }
  if (err.name === 'ValidationError') {
    const detalles = Object.values(err.errors || {}).map(e => ({ campo: e.path, mensaje: e.message }));
    return res.status(400).json({ ok: false, codigo: 'VALIDACION', mensaje: 'Datos inválidos', detalles });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ ok: false, codigo: 'ID_INVALIDO', mensaje: `Valor inválido para ${err.path}` });
  }
  if (err.code === 11000) {
    const campos = Object.keys(err.keyPattern || err.keyValue || {});
    return res.status(409).json({ ok: false, codigo: 'DUPLICADO', mensaje: `Ya existe un registro con ese ${campos.join(', ') || 'valor'}` });
  }
  if (err.name === 'MongoServerSelectionError' || err.name === 'MongooseServerSelectionError') {
    console.error('[BD] Sin conexión:', err.message);
    return res.status(503).json({ ok: false, codigo: 'BD_NO_DISPONIBLE', mensaje: 'La base de datos no está disponible. Intenta de nuevo.' });
  }

  console.error('[ERROR]', err);
  res.status(500).json({
    ok: false,
    codigo: 'ERROR_INTERNO',
    mensaje: 'Error interno del servidor',
    ...(process.env.NODE_ENV === 'development' && { error: err.message })
  });
}

module.exports = { rutaNoEncontrada, manejarErrores };

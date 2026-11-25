// Ejecuta las reglas de express-validator y responde 400 con la lista de errores.
// Uso en una ruta: router.post('/', validar([body('nombre').isString()]), handler)
const { validationResult, matchedData } = require('express-validator');
const { solicitudInvalida } = require('../helpers/errores');

function validar(reglas) {
  return [
    ...reglas,
    (req, res, next) => {
      const resultado = validationResult(req);
      if (!resultado.isEmpty()) {
        const detalles = resultado.array().map(e => ({ campo: e.path, mensaje: e.msg }));
        return next(solicitudInvalida(detalles[0].mensaje, detalles));
      }
      // Solo los campos declarados en las reglas llegan al servicio (se descartan los demás)
      req.datos = matchedData(req, { locations: ['body', 'query', 'params'], includeOptionals: false });
      next();
    }
  ];
}

module.exports = { validar };

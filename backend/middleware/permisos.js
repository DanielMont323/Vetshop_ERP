// requirePermiso('ventas:cobrar', ...) → 403 si el rol del usuario no tiene TODOS los permisos.
// Un permiso que no existe en config/permisos.js lanza error al arrancar (no en producción a medio día).
const { existePermiso, tienePermiso } = require('../config/permisos');
const { noAutenticado, sinPermiso } = require('../helpers/errores');

function requirePermiso(...permisos) {
  if (permisos.length === 0) throw new Error('requirePermiso necesita al menos un permiso');
  for (const p of permisos) {
    if (!existePermiso(p)) throw new Error(`requirePermiso: permiso desconocido "${p}"`);
  }
  return (req, res, next) => {
    if (!req.user) return next(noAutenticado());
    const faltan = permisos.filter(p => !tienePermiso(req.user.rol, p));
    if (faltan.length) return next(sinPermiso(`No tienes permiso para esta acción (${faltan.join(', ')})`));
    next();
  };
}

module.exports = { requirePermiso };

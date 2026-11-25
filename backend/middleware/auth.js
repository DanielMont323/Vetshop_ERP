// Autenticación por JWT. Adaptado de estética canina:
//   - el token lleva `v` (versionToken); si el usuario cambió la contraseña o fue dado de baja,
//     la versión ya no coincide y la sesión deja de servir (antes se comparaba iat con
//     passwordChangedAt, que tiene precisión de segundos).
//   - el usuario se relee en cada petición: un cambio de rol o de sucursales aplica de inmediato.
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const { noAutenticado } = require('../helpers/errores');

const DURACION_SESION = '12h'; // una jornada de trabajo

function secreto() {
  if (!process.env.JWT_SECRET) throw new Error('Falta la variable JWT_SECRET');
  return process.env.JWT_SECRET;
}

function generarToken(usuario) {
  return jwt.sign({ sub: String(usuario._id), v: usuario.versionToken || 0 }, secreto(), {
    expiresIn: DURACION_SESION,
    algorithm: 'HS256'
  });
}

async function autenticar(req, res, next) {
  try {
    if (req.user) return next();
    const cabecera = req.get('Authorization') || '';
    const [tipo, token] = cabecera.split(' ');
    if (tipo !== 'Bearer' || !token) throw noAutenticado('Inicia sesión para continuar');

    let datos;
    try {
      datos = jwt.verify(token, secreto(), { algorithms: ['HS256'] });
    } catch (error) {
      throw noAutenticado(error.name === 'TokenExpiredError' ? 'Tu sesión expiró. Inicia sesión de nuevo.' : 'Sesión inválida');
    }

    const usuario = await Usuario.findById(datos.sub).lean();
    if (!usuario || !usuario.activo) throw noAutenticado('Sesión inválida');
    if ((usuario.versionToken || 0) !== datos.v) {
      throw noAutenticado('Tu sesión ya no es válida (la contraseña cambió). Inicia sesión de nuevo.');
    }

    req.user = {
      _id: usuario._id,
      nombre: usuario.nombre,
      usuario: usuario.usuario,
      rol: usuario.rol,
      sucursales: usuario.sucursales || []
    };
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { autenticar, generarToken, DURACION_SESION };

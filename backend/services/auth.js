// Inicio de sesión, perfil, cambio de contraseña y PIN propio.
const bcrypt = require('bcryptjs');
const Usuario = require('../models/Usuario');
const Sucursal = require('../models/Sucursal');
const { generarToken } = require('../middleware/auth');
const { permisosDe } = require('../config/permisos');
const { noAutenticado, demasiadosIntentos, solicitudInvalida, sinPermiso, noEncontrado } = require('../helpers/errores');
const { conTransaccion } = require('../helpers/transaccion');
const auditoria = require('./auditoria');

const MAX_INTENTOS = 5;
const MINUTOS_BLOQUEO = 15;
const MENSAJE_CREDENCIALES = 'Usuario o contraseña incorrectos';

// Hash de relleno: si el usuario no existe se compara igual, para no revelar por el tiempo
// de respuesta qué usuarios existen.
let hashRelleno;
const relleno = () => (hashRelleno ||= bcrypt.hashSync('relleno-no-es-una-contrasena', 4));

function minutosRestantes(hasta) {
  return Math.max(1, Math.ceil((hasta.getTime() - Date.now()) / 60000));
}

function mensajeBloqueo(hasta) {
  const m = minutosRestantes(hasta);
  return `Cuenta bloqueada por varios intentos fallidos. Intenta de nuevo en ${m} minuto${m === 1 ? '' : 's'}.`;
}

// Sucursales que el usuario puede usar (para el selector del frontend)
async function sucursalesDe(usuario) {
  const filtro = usuario.rol === 'dueno' ? { activa: true } : { _id: { $in: usuario.sucursales }, activa: true };
  const lista = await Sucursal.find(filtro).select('nombre tipo').sort({ nombre: 1 }).lean();
  return lista.map(s => ({ id: s._id, nombre: s.nombre, tipo: s.tipo }));
}

async function perfilDe(usuario) {
  return {
    id: usuario._id,
    nombre: usuario.nombre,
    usuario: usuario.usuario,
    rol: usuario.rol,
    sucursales: await sucursalesDe(usuario),
    permisos: permisosDe(usuario.rol)
  };
}

async function login({ usuario: nombreUsuario, password }) {
  const usuario = await Usuario.findOne({ usuario: String(nombreUsuario).trim().toLowerCase() }).select('+passwordHash');

  if (!usuario || !usuario.activo) {
    await bcrypt.compare(String(password), relleno());
    throw noAutenticado(MENSAJE_CREDENCIALES);
  }
  if (usuario.bloqueadoHasta && usuario.bloqueadoHasta > new Date()) {
    throw demasiadosIntentos(mensajeBloqueo(usuario.bloqueadoHasta));
  }

  if (!(await usuario.compararPassword(password))) {
    // $inc atómico: dos intentos simultáneos no se pisan el contador
    const actualizado = await Usuario.findOneAndUpdate(
      { _id: usuario._id },
      { $inc: { intentosFallidos: 1 } },
      { new: true, projection: { intentosFallidos: 1 } }
    );
    if (actualizado.intentosFallidos >= MAX_INTENTOS) {
      const hasta = new Date(Date.now() + MINUTOS_BLOQUEO * 60000);
      await Usuario.updateOne({ _id: usuario._id }, { $set: { intentosFallidos: 0, bloqueadoHasta: hasta } });
      throw demasiadosIntentos(mensajeBloqueo(hasta));
    }
    throw noAutenticado(MENSAJE_CREDENCIALES);
  }

  if (usuario.intentosFallidos || usuario.bloqueadoHasta) {
    await Usuario.updateOne({ _id: usuario._id }, { $set: { intentosFallidos: 0 }, $unset: { bloqueadoHasta: 1 } });
  }

  return { token: generarToken(usuario), usuario: await perfilDe(usuario) };
}

async function perfil(usuarioId) {
  const usuario = await Usuario.findById(usuarioId).lean();
  if (!usuario) throw noEncontrado('Usuario no encontrado');
  return perfilDe(usuario);
}

// Cambia la contraseña propia. Sube versionToken: TODAS las sesiones abiertas (otras cajas,
// el celular…) dejan de servir. Devuelve un token nuevo para quien hizo el cambio.
async function cambiarPassword(usuarioId, { actual, nueva }) {
  return conTransaccion(async session => {
    const usuario = await Usuario.findById(usuarioId).select('+passwordHash').session(session);
    if (!usuario) throw noEncontrado('Usuario no encontrado');
    if (!(await usuario.compararPassword(actual))) throw solicitudInvalida('La contraseña actual no es correcta');
    if (actual === nueva) throw solicitudInvalida('La contraseña nueva debe ser distinta de la actual');
    await usuario.establecerPassword(nueva);
    usuario.versionToken += 1;
    await usuario.save({ session });
    await auditoria.registrar(
      { usuario: usuario._id, accion: 'usuario.cambiar_password', entidad: 'Usuario', entidadId: usuario._id },
      session
    );
    return { token: generarToken(usuario) };
  });
}

// Dueño y médico responsable definen su propio PIN (confirmando con su contraseña).
async function establecerPinPropio(usuarioId, { password, pin }) {
  return conTransaccion(async session => {
    const usuario = await Usuario.findById(usuarioId).select('+passwordHash').session(session);
    if (!usuario) throw noEncontrado('Usuario no encontrado');
    if (!usuario.usaPin()) throw sinPermiso('Tu rol no usa PIN de autorización');
    if (!(await usuario.compararPassword(password))) throw solicitudInvalida('La contraseña no es correcta');
    await usuario.establecerPin(pin);
    await usuario.save({ session });
    await auditoria.registrar(
      { usuario: usuario._id, accion: 'usuario.establecer_pin', entidad: 'Usuario', entidadId: usuario._id },
      session
    );
  });
}

module.exports = { login, perfil, cambiarPassword, establecerPinPropio, MAX_INTENTOS, MINUTOS_BLOQUEO };

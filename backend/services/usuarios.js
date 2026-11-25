// Gestión de usuarios (solo el dueño). Cada cambio queda en la bitácora.
const mongoose = require('mongoose');
const Usuario = require('../models/Usuario');
const Sucursal = require('../models/Sucursal');
const { conTransaccion } = require('../helpers/transaccion');
const { solicitudInvalida, noEncontrado, conflicto } = require('../helpers/errores');
const auditoria = require('./auditoria');

const aIds = lista => [...new Set((lista || []).map(String))].map(id => new mongoose.Types.ObjectId(id));

async function validarSucursales(ids, session) {
  if (!ids.length) return;
  const encontradas = await Sucursal.countDocuments({ _id: { $in: ids }, activa: true }).session(session);
  if (encontradas !== ids.length) throw solicitudInvalida('Alguna sucursal no existe o está desactivada');
}

// Nunca dejar el sistema sin un dueño activo (nadie podría administrarlo)
async function exigirOtroDuenoActivo(usuarioId, session) {
  const otros = await Usuario.countDocuments({ _id: { $ne: usuarioId }, rol: 'dueno', activo: true }).session(session);
  if (otros === 0) throw conflicto('Debe quedar al menos un dueño activo', 'ULTIMO_DUENO');
}

async function listar({ incluirInactivos = false } = {}) {
  const filtro = incluirInactivos ? {} : { activo: true };
  const lista = await Usuario.find(filtro).sort({ nombre: 1 });
  return lista.map(u => ({ ...u.publico(), bloqueadoHasta: u.bloqueadoHasta }));
}

async function crear({ nombre, usuario, password, rol, sucursales, pin }, actor) {
  return conTransaccion(async session => {
    const ids = rol === 'dueno' ? [] : aIds(sucursales);
    await validarSucursales(ids, session);
    const nuevo = new Usuario({ nombre, usuario, rol, sucursales: ids });
    await nuevo.establecerPassword(password);
    if (pin !== undefined) {
      if (!nuevo.usaPin()) throw solicitudInvalida('Solo el dueño y el médico responsable usan PIN');
      await nuevo.establecerPin(pin);
    }
    await nuevo.save({ session });
    await auditoria.registrar(
      { usuario: actor._id, accion: 'usuario.crear', entidad: 'Usuario', entidadId: nuevo._id, despues: nuevo.publico() },
      session
    );
    return nuevo.publico();
  });
}

async function actualizar(id, cambios, actor) {
  return conTransaccion(async session => {
    const usuario = await Usuario.findById(id).session(session);
    if (!usuario) throw noEncontrado('Usuario no encontrado');
    const antes = usuario.publico();
    const esUnoMismo = usuario._id.equals(actor._id);

    if (cambios.rol !== undefined && cambios.rol !== usuario.rol) {
      if (esUnoMismo) throw solicitudInvalida('No puedes cambiar tu propio rol');
      if (usuario.rol === 'dueno') await exigirOtroDuenoActivo(usuario._id, session);
      usuario.rol = cambios.rol;
      if (!usuario.usaPin()) usuario.pinHash = undefined; // el PIN no sobrevive a un cambio de rol
      usuario.versionToken += 1;
    }
    if (cambios.activo !== undefined && cambios.activo !== usuario.activo) {
      if (!cambios.activo) {
        if (esUnoMismo) throw solicitudInvalida('No puedes desactivar tu propio usuario');
        if (usuario.rol === 'dueno') await exigirOtroDuenoActivo(usuario._id, session);
        usuario.versionToken += 1; // cierra sus sesiones abiertas
      }
      usuario.activo = cambios.activo;
    }
    if (cambios.nombre !== undefined) usuario.nombre = cambios.nombre;
    if (cambios.sucursales !== undefined) {
      const ids = usuario.rol === 'dueno' ? [] : aIds(cambios.sucursales);
      await validarSucursales(ids, session);
      usuario.sucursales = ids;
    } else if (usuario.rol === 'dueno') {
      usuario.sucursales = [];
    }

    await usuario.save({ session });
    await auditoria.registrar(
      { usuario: actor._id, accion: 'usuario.actualizar', entidad: 'Usuario', entidadId: usuario._id, antes, despues: usuario.publico() },
      session
    );
    return usuario.publico();
  });
}

// El dueño asigna una contraseña nueva (olvido). Desbloquea la cuenta y cierra sus sesiones.
async function restablecerPassword(id, nueva, actor) {
  return conTransaccion(async session => {
    const usuario = await Usuario.findById(id).session(session);
    if (!usuario) throw noEncontrado('Usuario no encontrado');
    await usuario.establecerPassword(nueva);
    usuario.intentosFallidos = 0;
    usuario.bloqueadoHasta = undefined;
    usuario.versionToken += 1;
    await usuario.save({ session });
    await auditoria.registrar(
      { usuario: actor._id, accion: 'usuario.restablecer_password', entidad: 'Usuario', entidadId: usuario._id },
      session
    );
  });
}

module.exports = { listar, crear, actualizar, restablecerPassword };

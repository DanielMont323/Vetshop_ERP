// Verificación del PIN de autorización (dueño o médico responsable).
// La usarán descuentos, cancelaciones, ajustes, cambio de forma de pago, diferencias de corte
// (dueño) y validación de recetas (médico responsable).
//
//   const autorizador = await verificarPin({ usuario: 'carlos', pin: '1234',
//                                            permiso: 'autorizar:descuento', sucursal }, session);
//
// - Bloqueo propio del PIN: 5 intentos fallidos → 15 minutos (contador en la BD).
// - Primero se verifica el PIN y después el permiso: un PIN equivocado no revela el rol de nadie.
// - Si se indica `sucursal`, el autorizador (salvo el dueño) debe tenerla asignada.
const Usuario = require('../models/Usuario');
const { existePermiso, tienePermiso } = require('../config/permisos');
const { noAutenticado, sinPermiso, demasiadosIntentos } = require('../helpers/errores');

const MAX_INTENTOS_PIN = 5;
const MINUTOS_BLOQUEO_PIN = 15;

async function verificarPin({ usuario: nombreUsuario, pin, permiso, sucursal }, session) {
  if (!existePermiso(permiso)) throw new Error(`verificarPin: permiso desconocido "${permiso}"`);

  const autorizador = await Usuario.findOne({ usuario: String(nombreUsuario || '').trim().toLowerCase() })
    .select('+pinHash')
    .session(session || null);

  if (!autorizador || !autorizador.activo || !autorizador.usaPin() || !autorizador.pinHash) {
    throw noAutenticado('Usuario o PIN de autorización incorrectos');
  }
  if (autorizador.pinBloqueadoHasta && autorizador.pinBloqueadoHasta > new Date()) {
    throw demasiadosIntentos('El PIN está bloqueado por varios intentos fallidos. Intenta más tarde.');
  }

  if (!(await autorizador.compararPin(pin))) {
    // Fuera de la transacción del llamador: el intento fallido debe contar aunque la operación se revierta
    const actualizado = await Usuario.findOneAndUpdate(
      { _id: autorizador._id },
      { $inc: { intentosPinFallidos: 1 } },
      { new: true, projection: { intentosPinFallidos: 1 } }
    );
    if (actualizado.intentosPinFallidos >= MAX_INTENTOS_PIN) {
      await Usuario.updateOne(
        { _id: autorizador._id },
        { $set: { intentosPinFallidos: 0, pinBloqueadoHasta: new Date(Date.now() + MINUTOS_BLOQUEO_PIN * 60000) } }
      );
      throw demasiadosIntentos('El PIN quedó bloqueado por varios intentos fallidos. Intenta más tarde.');
    }
    throw noAutenticado('Usuario o PIN de autorización incorrectos');
  }

  if (!tienePermiso(autorizador.rol, permiso)) {
    throw sinPermiso('Ese usuario no puede autorizar esta acción');
  }
  if (sucursal && autorizador.rol !== 'dueno' && !autorizador.sucursales.some(s => s.equals(sucursal))) {
    throw sinPermiso('Ese usuario no puede autorizar en esta sucursal');
  }

  if (autorizador.intentosPinFallidos) {
    await Usuario.updateOne({ _id: autorizador._id }, { $set: { intentosPinFallidos: 0 }, $unset: { pinBloqueadoHasta: 1 } });
  }

  return { id: autorizador._id, nombre: autorizador.nombre, rol: autorizador.rol };
}

module.exports = { verificarPin, MAX_INTENTOS_PIN, MINUTOS_BLOQUEO_PIN };

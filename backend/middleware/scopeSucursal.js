// Alcance de sucursal para TODAS las rutas operativas (existencias, ventas, cortes, traspasos…).
// Va después de autenticar(). Deja en req.alcance:
//   { sucursalActiva: ObjectId | null, permitidas: ObjectId[] | 'todas', esDueno }
//
// Reglas:
//   - Encabezado X-Sucursal: debe ser un id válido, existir y estar entre las sucursales del usuario
//     (el dueño puede elegir cualquiera). Si no, 400 / 404 / 403.
//   - ESCRITURAS (POST, PUT, PATCH, DELETE): X-Sucursal es obligatorio para todos, también para el
//     dueño (aunque vea todas, tiene que decir en cuál escribe). Sin él → 400.
//     No se escribe en una sucursal desactivada → 403.
//   - LECTURAS sin X-Sucursal: el dueño ve todas; un usuario con una sola sucursal ve esa;
//     uno con varias ve todas las suyas.
const mongoose = require('mongoose');
const Sucursal = require('../models/Sucursal');
const { noAutenticado, sinPermiso, solicitudInvalida, noEncontrado } = require('../helpers/errores');

const METODOS_LECTURA = new Set(['GET', 'HEAD', 'OPTIONS']);
const RE_OBJECT_ID = /^[a-f0-9]{24}$/i;

async function scopeSucursal(req, res, next) {
  try {
    const usuario = req.user;
    if (!usuario) throw noAutenticado();

    const esDueno = usuario.rol === 'dueno';
    const esEscritura = !METODOS_LECTURA.has(req.method);
    const permitidas = esDueno ? 'todas' : usuario.sucursales.map(id => new mongoose.Types.ObjectId(String(id)));
    const cabecera = (req.get('X-Sucursal') || '').trim();

    let sucursalActiva = null;
    if (cabecera) {
      if (!RE_OBJECT_ID.test(cabecera)) throw solicitudInvalida('El encabezado X-Sucursal no es un id válido');
      const id = new mongoose.Types.ObjectId(cabecera);
      if (!esDueno && !permitidas.some(p => p.equals(id))) throw sinPermiso('No tienes acceso a esa sucursal');
      const sucursal = await Sucursal.findById(id).select('activa').lean();
      if (!sucursal) throw noEncontrado('La sucursal no existe');
      if (esEscritura && !sucursal.activa) throw sinPermiso('La sucursal está desactivada');
      sucursalActiva = id;
    } else if (esEscritura) {
      throw solicitudInvalida('Indica la sucursal en la que trabajas (encabezado X-Sucursal)');
    } else if (!esDueno && permitidas.length === 1) {
      sucursalActiva = permitidas[0];
    }

    if (!esDueno && permitidas.length === 0) throw sinPermiso('Tu usuario no tiene sucursales asignadas');

    req.alcance = Object.freeze({ sucursalActiva, permitidas, esDueno });
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { scopeSucursal };

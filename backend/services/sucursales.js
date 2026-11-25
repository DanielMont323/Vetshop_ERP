// Sucursales. El dueño las ve y gestiona todas; los demás solo ven las suyas.
const Sucursal = require('../models/Sucursal');
const { conTransaccion } = require('../helpers/transaccion');
const { noEncontrado } = require('../helpers/errores');
const auditoria = require('./auditoria');

const publica = s => ({ id: s._id, nombre: s.nombre, tipo: s.tipo, activa: s.activa });

function filtroVisible(usuario) {
  return usuario.rol === 'dueno' ? {} : { _id: { $in: usuario.sucursales } };
}

async function listar(usuario, { incluirInactivas = false } = {}) {
  const filtro = { ...filtroVisible(usuario), ...(incluirInactivas ? {} : { activa: true }) };
  const lista = await Sucursal.find(filtro).sort({ nombre: 1 }).lean();
  return lista.map(publica);
}

// Una sucursal ajena responde 404 (no 403): no se revela que existe
async function obtener(usuario, id) {
  const sucursal = await Sucursal.findOne({ $and: [{ _id: id }, filtroVisible(usuario)] }).lean();
  if (!sucursal) throw noEncontrado('Sucursal no encontrada');
  return publica(sucursal);
}

async function crear({ nombre, tipo }, actor) {
  return conTransaccion(async session => {
    const [sucursal] = await Sucursal.create([{ nombre, tipo }], { session });
    await auditoria.registrar(
      { usuario: actor._id, accion: 'sucursal.crear', entidad: 'Sucursal', entidadId: sucursal._id, despues: publica(sucursal) },
      session
    );
    return publica(sucursal);
  });
}

async function actualizar(id, cambios, actor) {
  return conTransaccion(async session => {
    const sucursal = await Sucursal.findById(id).session(session);
    if (!sucursal) throw noEncontrado('Sucursal no encontrada');
    const antes = publica(sucursal);
    for (const campo of ['nombre', 'tipo', 'activa']) {
      if (cambios[campo] !== undefined) sucursal[campo] = cambios[campo];
    }
    await sucursal.save({ session });
    await auditoria.registrar(
      { usuario: actor._id, accion: 'sucursal.actualizar', entidad: 'Sucursal', entidadId: sucursal._id, antes, despues: publica(sucursal) },
      session
    );
    return publica(sucursal);
  });
}

module.exports = { listar, obtener, crear, actualizar };

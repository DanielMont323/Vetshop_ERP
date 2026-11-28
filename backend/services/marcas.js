// Marcas con las que salen las notas y tickets:
//   negocio   («Vet Shop»): clientes con negocio (clínicas, veterinarias, petshops, estéticas)
//   mostrador («Huellitas Vetshop»): ventas de mostrador (público en general, clientes de público y empleados)
const Configuracion = require('../models/Configuracion');
const Logo = require('../models/Logo');
const { solicitudInvalida } = require('../helpers/errores');
const auditoria = require('./auditoria');

const TIPOS_MOSTRADOR = ['publico', 'empleado'];
const CAMPOS = ['nombre', 'lema', 'rfc', 'direccion', 'telefono'];

const claveDe = cliente => (!cliente || cliente.esPublicoGeneral || TIPOS_MOSTRADOR.includes(cliente.tipo) ? 'mostrador' : 'negocio');

const limpia = m => Object.fromEntries(CAMPOS.map(c => [c, m?.[c] || '']));

async function config() {
  await Configuracion.updateOne({ clave: 'general' }, { $setOnInsert: { clave: 'general' } }, { upsert: true }).catch(e => {
    if (e.code !== 11000) throw e;
  });
  return Configuracion.findOne({ clave: 'general' });
}

// Para Administración: datos de las dos marcas y qué logos hay (con la imagen)
async function obtener() {
  const [c, logos] = await Promise.all([config(), Logo.find({}).lean()]);
  const porClave = Object.fromEntries(logos.map(l => [l.clave, l.imagen]));
  return {
    negocio: { ...limpia(c.marcas?.negocio), logo: porClave.negocio || null },
    mostrador: { ...limpia(c.marcas?.mostrador), logo: porClave.mostrador || null },
    pie: logos.filter(l => l.clave.startsWith('pie-')).sort((a, b) => a.clave.localeCompare(b.clave)).map(l => ({ clave: l.clave, imagen: l.imagen }))
  };
}

// Para imprimir: la marca que corresponde al cliente, con su logo y los logos del pie
async function paraCliente(cliente) {
  const todo = await obtener();
  return { clave: claveDe(cliente), ...todo[claveDe(cliente)], pie: todo.pie.map(p => p.imagen) };
}

async function actualizar(actor, cambios) {
  const c = await config();
  const antes = { negocio: limpia(c.marcas?.negocio), mostrador: limpia(c.marcas?.mostrador) };
  for (const clave of ['negocio', 'mostrador']) {
    for (const campo of CAMPOS) {
      if (cambios[clave]?.[campo] !== undefined) c.set(`marcas.${clave}.${campo}`, String(cambios[clave][campo]).trim());
    }
  }
  if (!c.marcas?.negocio?.nombre || !c.marcas?.mostrador?.nombre) throw solicitudInvalida('Cada marca necesita su nombre');
  await c.save();
  const despues = { negocio: limpia(c.marcas.negocio), mostrador: limpia(c.marcas.mostrador) };
  await auditoria.registrar({ usuario: actor._id, accion: 'configuracion.marcas', entidad: 'Configuracion', entidadId: c._id, antes, despues });
  return obtener();
}

async function guardarLogo(actor, clave, imagen) {
  try {
    await Logo.updateOne({ clave }, { $set: { imagen } }, { upsert: true, runValidators: true });
  } catch (error) {
    if (error.name === 'ValidationError') throw solicitudInvalida(Object.values(error.errors)[0].message);
    throw error;
  }
  await auditoria.registrar({ usuario: actor._id, accion: 'configuracion.logo', entidad: 'Logo', despues: { clave } });
  return obtener();
}

async function quitarLogo(actor, clave) {
  await Logo.deleteOne({ clave });
  await auditoria.registrar({ usuario: actor._id, accion: 'configuracion.logo_quitar', entidad: 'Logo', antes: { clave } });
  return obtener();
}

module.exports = { obtener, paraCliente, actualizar, guardarLogo, quitarLogo, claveDe, TIPOS_MOSTRADOR };

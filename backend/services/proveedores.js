// Proveedores (catálogo global). Cada alta y cambio queda en la bitácora.
const Proveedor = require('../models/Proveedor');
const { conTransaccion } = require('../helpers/transaccion');
const { noEncontrado } = require('../helpers/errores');
const { normalizar } = require('../helpers/texto');
const auditoria = require('./auditoria');

const CAMPOS = ['nombre', 'rfc', 'contacto', 'telefono', 'whatsapp', 'email', 'diasCredito', 'activo'];

const publico = p => ({
  id: p._id,
  nombre: p.nombre,
  rfc: p.rfc || null,
  contacto: p.contacto || '',
  telefono: p.telefono || '',
  whatsapp: p.whatsapp || '',
  email: p.email || '',
  diasCredito: p.diasCredito,
  activo: p.activo
});

async function listar({ q, activo } = {}) {
  const filtro = {};
  if (activo !== undefined) filtro.activo = activo;
  const texto = normalizar(q || '');
  const lista = await Proveedor.find(filtro).collation({ locale: 'es', strength: 1 }).sort({ nombre: 1 }).lean();
  // ~decenas de proveedores: filtrar sin acentos en memoria es suficiente
  const filtrados = texto
    ? lista.filter(p => normalizar(`${p.nombre} ${p.rfc || ''} ${p.contacto || ''}`).includes(texto))
    : lista;
  return filtrados.map(publico);
}

async function obtener(id) {
  const p = await Proveedor.findById(id).lean();
  if (!p) throw noEncontrado('Proveedor no encontrado');
  return publico(p);
}

async function crear(datos, actor) {
  return conTransaccion(async session => {
    const [p] = await Proveedor.create([datos], { session });
    await auditoria.registrar({ usuario: actor._id, accion: 'proveedor.crear', entidad: 'Proveedor', entidadId: p._id, despues: publico(p) }, session);
    return publico(p);
  });
}

async function actualizar(id, cambios, actor) {
  return conTransaccion(async session => {
    const p = await Proveedor.findById(id).session(session);
    if (!p) throw noEncontrado('Proveedor no encontrado');
    const antes = publico(p);
    for (const campo of CAMPOS) if (cambios[campo] !== undefined) p[campo] = cambios[campo];
    if (p.isModified()) {
      await p.save({ session });
      await auditoria.registrar({ usuario: actor._id, accion: 'proveedor.actualizar', entidad: 'Proveedor', entidadId: p._id, antes, despues: publico(p) }, session);
    }
    return publico(p);
  });
}

module.exports = { listar, obtener, crear, actualizar };

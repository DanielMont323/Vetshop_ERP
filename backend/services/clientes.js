// Clientes (globales). Consultar: catalogo:ver. Crear y modificar (incluidos lista de precios y crédito): dueño.
const Cliente = require('../models/Cliente');
const { conTransaccion } = require('../helpers/transaccion');
const { noEncontrado, solicitudInvalida } = require('../helpers/errores');
const { normalizar } = require('../helpers/texto');
const auditoria = require('./auditoria');

const CAMPOS = ['nombre', 'tipo', 'listaPrecios', 'rfc', 'telefono', 'email', 'activo'];
const CAMPOS_CREDITO = ['activo', 'limite', 'dias', 'bonificacionProntoPago', 'diasProntoPago'];
const NOMBRE_PUBLICO_GENERAL = 'Público en general';

const publico = c => ({
  id: c._id,
  nombre: c.nombre,
  tipo: c.tipo,
  listaPrecios: c.listaPrecios,
  rfc: c.rfc || null,
  telefono: c.telefono || '',
  email: c.email || '',
  esPublicoGeneral: Boolean(c.esPublicoGeneral),
  credito: {
    activo: Boolean(c.credito?.activo),
    limite: c.credito?.limite || 0,
    dias: c.credito?.dias ?? 30,
    bonificacionProntoPago: c.credito?.bonificacionProntoPago || 0,
    diasProntoPago: c.credito?.diasProntoPago ?? 8
  },
  activo: c.activo
});

// El cliente "Público en general" (lista público). Se crea la primera vez que se necesita.
async function publicoGeneral(session) {
  await Cliente.updateOne(
    { esPublicoGeneral: true },
    { $setOnInsert: { nombre: NOMBRE_PUBLICO_GENERAL, tipo: 'publico', listaPrecios: 'publico', esPublicoGeneral: true, activo: true } },
    { upsert: true, session }
  ).catch(error => {
    if (error.code !== 11000) throw error; // otra petición lo creó al mismo tiempo
  });
  return Cliente.findOne({ esPublicoGeneral: true }).session(session || null).lean();
}

async function listar({ q, activo } = {}) {
  await publicoGeneral();
  const filtro = activo === undefined ? {} : { activo };
  const lista = await Cliente.find(filtro).collation({ locale: 'es', strength: 1 }).sort({ esPublicoGeneral: -1, nombre: 1 }).lean();
  const texto = normalizar(q || '');
  const filtrados = texto ? lista.filter(c => normalizar(`${c.nombre} ${c.rfc || ''} ${c.telefono || ''}`).includes(texto)) : lista;
  return filtrados.slice(0, 100).map(publico);
}

async function obtener(id) {
  const c = await Cliente.findById(id).lean();
  if (!c) throw noEncontrado('Cliente no encontrado');
  return publico(c);
}

const soloCredito = (credito = {}) => Object.fromEntries(CAMPOS_CREDITO.filter(k => credito[k] !== undefined).map(k => [k, credito[k]]));

async function crear(datos, actor) {
  return conTransaccion(async session => {
    const [c] = await Cliente.create([{ ...datos, credito: soloCredito(datos.credito), esPublicoGeneral: false }], { session });
    await auditoria.registrar({ usuario: actor._id, accion: 'cliente.crear', entidad: 'Cliente', entidadId: c._id, despues: publico(c) }, session);
    return publico(c);
  });
}

async function actualizar(id, cambios, actor) {
  return conTransaccion(async session => {
    const c = await Cliente.findById(id).session(session);
    if (!c) throw noEncontrado('Cliente no encontrado');
    if (c.esPublicoGeneral && (cambios.activo === false || (cambios.listaPrecios && cambios.listaPrecios !== 'publico'))) {
      throw solicitudInvalida('"Público en general" siempre está activo y usa la lista de público');
    }
    const antes = publico(c);
    for (const campo of CAMPOS) if (cambios[campo] !== undefined) c[campo] = cambios[campo];
    for (const [campo, valor] of Object.entries(soloCredito(cambios.credito))) c.set(`credito.${campo}`, valor);
    if (c.isModified()) {
      await c.save({ session });
      await auditoria.registrar({ usuario: actor._id, accion: 'cliente.actualizar', entidad: 'Cliente', entidadId: c._id, antes, despues: publico(c) }, session);
    }
    return publico(c);
  });
}

module.exports = { listar, obtener, crear, actualizar, publicoGeneral, NOMBRE_PUBLICO_GENERAL };

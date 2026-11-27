// Clientes (globales). Consultar: catalogo:ver. Crear y modificar (incluidos lista de precios y crédito): dueño.
const Cliente = require('../models/Cliente');
const { conTransaccion } = require('../helpers/transaccion');
const { noEncontrado, solicitudInvalida } = require('../helpers/errores');
const { normalizar } = require('../helpers/texto');
const auditoria = require('./auditoria');

const CAMPOS = ['nombre', 'tipo', 'listaPrecios', 'rfc', 'telefono', 'email', 'whatsapp', 'direccion', 'notas', 'activo'];
// Lo que puede capturar la caja (clientes:registrar): solo contacto, nunca crédito ni lista de precios
const CAMPOS_CONTACTO = ['telefono', 'whatsapp', 'email', 'direccion', 'notas'];
const CAMPOS_CREDITO = ['activo', 'limite', 'dias', 'bonificacionProntoPago', 'diasProntoPago'];
const CAMPOS_FISCAL = ['razonSocial', 'regimen', 'codigoPostal', 'usoCfdi'];
const NOMBRE_PUBLICO_GENERAL = 'Público en general';

const publico = c => ({
  id: c._id,
  nombre: c.nombre,
  tipo: c.tipo,
  listaPrecios: c.listaPrecios,
  rfc: c.rfc || null,
  telefono: c.telefono || '',
  email: c.email || '',
  whatsapp: c.whatsapp || '',
  direccion: c.direccion || '',
  notas: c.notas || '',
  esPublicoGeneral: Boolean(c.esPublicoGeneral),
  credito: {
    activo: Boolean(c.credito?.activo),
    limite: c.credito?.limite || 0,
    dias: c.credito?.dias ?? 30,
    bonificacionProntoPago: c.credito?.bonificacionProntoPago || 0,
    diasProntoPago: c.credito?.diasProntoPago ?? 8
  },
  fiscal: {
    razonSocial: c.fiscal?.razonSocial || '',
    regimen: c.fiscal?.regimen || '',
    codigoPostal: c.fiscal?.codigoPostal || '',
    usoCfdi: c.fiscal?.usoCfdi || 'G03'
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
  const filtrados = texto ? lista.filter(c => normalizar(`${c.nombre} ${c.rfc || ''} ${c.telefono || ''} ${c.whatsapp || ''} ${c.direccion || ''}`).includes(texto)) : lista;
  return filtrados.slice(0, 100).map(publico);
}

async function obtener(id) {
  const c = await Cliente.findById(id).lean();
  if (!c) throw noEncontrado('Cliente no encontrado');
  return publico(c);
}

const soloFiscal = (fiscal = {}) => Object.fromEntries(CAMPOS_FISCAL.filter(k => fiscal[k] !== undefined).map(k => [k, fiscal[k] === '' ? undefined : fiscal[k]]));
const soloCredito = (credito = {}) => Object.fromEntries(CAMPOS_CREDITO.filter(k => credito[k] !== undefined).map(k => [k, credito[k]]));

async function crear(datos, actor) {
  return conTransaccion(async session => {
    const [c] = await Cliente.create([{ ...datos, credito: soloCredito(datos.credito), fiscal: soloFiscal(datos.fiscal), esPublicoGeneral: false }], { session });
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
    for (const [campo, valor] of Object.entries(soloFiscal(cambios.fiscal))) c.set(`fiscal.${campo}`, valor);
    if (c.isModified()) {
      await c.save({ session });
      await auditoria.registrar({ usuario: actor._id, accion: 'cliente.actualizar', entidad: 'Cliente', entidadId: c._id, antes, despues: publico(c) }, session);
    }
    return publico(c);
  });
}

// Alta rápida desde la caja: cliente de público con lista de público; el dueño decide después crédito y lista
async function registrarRapido(datos, actor) {
  return crear({ nombre: datos.nombre, tipo: 'publico', listaPrecios: 'publico', ...Object.fromEntries(CAMPOS_CONTACTO.filter(k => datos[k] !== undefined).map(k => [k, datos[k]])) }, actor);
}

// Datos de contacto (la caja los mantiene al día)
async function actualizarContacto(id, cambios, actor) {
  return conTransaccion(async session => {
    const c = await Cliente.findById(id).session(session);
    if (!c) throw noEncontrado('Cliente no encontrado');
    if (c.esPublicoGeneral) throw solicitudInvalida('«Público en general» no tiene datos de contacto');
    const antes = publico(c);
    for (const campo of CAMPOS_CONTACTO) if (cambios[campo] !== undefined) c[campo] = cambios[campo] === '' ? undefined : cambios[campo];
    if (c.isModified()) {
      await c.save({ session });
      await auditoria.registrar({ usuario: actor._id, accion: 'cliente.contacto', entidad: 'Cliente', entidadId: c._id, antes, despues: publico(c) }, session);
    }
    return publico(c);
  });
}

module.exports = { registrarRapido, actualizarContacto, listar, obtener, crear, actualizar, publicoGeneral, NOMBRE_PUBLICO_GENERAL };

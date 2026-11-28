// Mascotas de los clientes (globales). Las registra la caja o el dueño (clientes:registrar).
const mongoose = require('mongoose');
const Mascota = require('../models/Mascota');
const Cliente = require('../models/Cliente');
const { solicitudInvalida, noEncontrado } = require('../helpers/errores');
const auditoria = require('./auditoria');

const aId = id => new mongoose.Types.ObjectId(String(id));
const CAMPOS = ['nombre', 'especie', 'raza', 'sexo', 'nacimiento', 'peso', 'notas', 'activa'];

const publica = m => ({
  id: m._id, cliente: m.cliente, nombre: m.nombre, especie: m.especie, raza: m.raza || '', sexo: m.sexo || '',
  nacimiento: m.nacimiento || null, peso: m.peso ?? null, notas: m.notas || '', activa: m.activa
});

async function guardar(doc) {
  try {
    await doc.save();
  } catch (error) {
    if (error.name === 'ValidationError') throw solicitudInvalida(Object.values(error.errors)[0].message);
    throw error;
  }
}

async function listar({ cliente, todas = false }) {
  const lista = await Mascota.find({ cliente: aId(cliente), ...(!todas && { activa: true }) }).sort({ nombre: 1 }).lean();
  return lista.map(publica);
}

async function crear(datos, actor) {
  const cliente = await Cliente.findById(aId(datos.cliente)).lean();
  if (!cliente) throw noEncontrado('Cliente no encontrado');
  if (cliente.esPublicoGeneral) throw solicitudInvalida('Registra primero al cliente para agregar sus mascotas');
  const doc = new Mascota({ cliente: cliente._id, ...Object.fromEntries(CAMPOS.filter(c => datos[c] !== undefined).map(c => [c, datos[c]])) });
  await guardar(doc);
  await auditoria.registrar({ usuario: actor._id, accion: 'mascota.crear', entidad: 'Mascota', entidadId: doc._id, despues: publica(doc) });
  return publica(doc);
}

async function actualizar(id, cambios, actor) {
  const doc = await Mascota.findById(aId(id));
  if (!doc) throw noEncontrado('Mascota no encontrada');
  const antes = publica(doc.toObject());
  for (const c of CAMPOS) if (cambios[c] !== undefined) doc[c] = cambios[c];
  await guardar(doc);
  await auditoria.registrar({ usuario: actor._id, accion: 'mascota.actualizar', entidad: 'Mascota', entidadId: doc._id, antes, despues: publica(doc) });
  return publica(doc);
}

module.exports = { listar, crear, actualizar, publica };

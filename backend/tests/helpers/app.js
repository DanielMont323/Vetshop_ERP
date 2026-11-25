// Utilidades de prueba: app real, base limpia y cierre.
const mongoose = require('mongoose');
const request = require('supertest');
const { crearApp } = require('../../app');
const { conectar, desconectar } = require('../../config/database');

const app = crearApp();

async function conectado() {
  await conectar();
  const { host, name } = mongoose.connection;
  if (host !== '127.0.0.1' || name !== 'vetshop-pruebas') {
    throw new Error(`[GUARDIA] Conectado a ${host}/${name}; se esperaba el Mongo en memoria`);
  }
}

// Borra la base de pruebas y recrea colecciones e índices (las transacciones no crean colecciones).
async function resetDb() {
  await conectado();
  await mongoose.connection.db.dropDatabase();
  for (const modelo of Object.values(mongoose.models)) {
    await modelo.createCollection().catch(() => {});
    await modelo.syncIndexes();
  }
}

async function cerrar() {
  await desconectar();
}

module.exports = { app, request, resetDb, cerrar, conectado };

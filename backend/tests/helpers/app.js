// Utilidades de prueba: app real, base limpia, datos semilla y login real por HTTP.
const mongoose = require('mongoose');
const request = require('supertest');
const { crearApp } = require('../../app');
const { conectar, desconectar } = require('../../config/database');
const Sucursal = require('../../models/Sucursal');
const Usuario = require('../../models/Usuario');
const Auditoria = require('../../models/Auditoria');
const { router: rutaNotas, NotaPrueba } = require('./notasPrueba');

// La app real + una ruta operativa de prueba montada igual que las reales
const app = crearApp({ rutasOperativas: [['/api/prueba-notas', rutaNotas]] });

const PASSWORD = 'Prueba-12345';

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

let secuencia = 0;
const siguiente = () => `${Date.now().toString(36)}${(secuencia += 1)}`;

async function crearSucursal(extra = {}) {
  return Sucursal.create({ nombre: `Sucursal ${siguiente()}`, tipo: 'tienda', ...extra });
}

// Crea un usuario directo en la BD (sin pasar por la API)
async function crearUsuario({ rol = 'cajero', sucursales = [], pin, password = PASSWORD, ...extra } = {}) {
  const u = new Usuario({ nombre: `Usuario ${rol}`, usuario: `${rol.slice(0, 6)}.${siguiente()}`, rol, sucursales, ...extra });
  await u.establecerPassword(password);
  if (pin) await u.establecerPin(pin);
  await u.save();
  return u;
}

async function login(usuario, password = PASSWORD) {
  return request(app).post('/api/auth/login').send({ usuario: usuario.usuario || usuario, password });
}

// Crea el usuario e inicia sesión. Devuelve { usuario, token }.
async function sesion(opciones = {}) {
  const usuario = await crearUsuario(opciones);
  const res = await login(usuario, opciones.password);
  if (res.status !== 200) throw new Error(`Login falló: ${res.status} ${JSON.stringify(res.body)}`);
  return { usuario, token: res.body.datos.token };
}

const auth = (token, sucursal) => ({
  Authorization: `Bearer ${token}`,
  ...(sucursal && { 'X-Sucursal': String(sucursal._id || sucursal) })
});

module.exports = {
  app, request, resetDb, cerrar, conectado, PASSWORD,
  crearSucursal, crearUsuario, login, sesion, auth,
  modelos: { Sucursal, Usuario, Auditoria, NotaPrueba }
};

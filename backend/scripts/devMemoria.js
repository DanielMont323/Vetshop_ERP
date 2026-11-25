// API local con un Mongo EN MEMORIA y datos de prueba (se borra al cerrar). No toca Atlas.
//   npm run dev:memoria
// Usuarios de prueba (contraseña para todos: Prueba-12345; PIN del dueño: 1234):
//   dueno.demo, cajero.centro, almacen.demo, medico.demo
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const PASSWORD = 'Prueba-12345';

async function main() {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.MONGODB_URI = replSet.getUri('vetshop-dev');
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-solo-para-desarrollo-local';
  process.env.CORS_ORIGINS = process.env.CORS_ORIGINS || 'http://localhost:5173';
  process.env.NODE_ENV = 'development';

  const { conectar } = require('../config/database');
  const { crearApp } = require('../app');
  const Sucursal = require('../models/Sucursal');
  const Usuario = require('../models/Usuario');
  await conectar();

  const [centro, norte, almacen] = await Sucursal.create([
    { nombre: 'Centro (prueba)', tipo: 'tienda' },
    { nombre: 'Norte (prueba)', tipo: 'tienda' },
    { nombre: 'Almacén (prueba)', tipo: 'almacen' }
  ]);
  const usuarios = [
    { nombre: 'Dueño Demo', usuario: 'dueno.demo', rol: 'dueno', sucursales: [], pin: '1234' },
    { nombre: 'Cajero Centro', usuario: 'cajero.centro', rol: 'cajero', sucursales: [centro._id] },
    { nombre: 'Almacén Demo', usuario: 'almacen.demo', rol: 'almacen', sucursales: [almacen._id, centro._id, norte._id] },
    { nombre: 'Médico Demo', usuario: 'medico.demo', rol: 'medico_responsable', sucursales: [centro._id], pin: '4321' }
  ];
  for (const { pin, ...datos } of usuarios) {
    const u = new Usuario(datos);
    await u.establecerPassword(PASSWORD);
    if (pin) await u.establecerPin(pin);
    await u.save();
  }

  const PORT = process.env.PORT || 5000;
  crearApp().listen(PORT, () => {
    console.log(`API (Mongo en memoria) en http://localhost:${PORT}/api`);
    console.log(`Usuarios: ${usuarios.map(u => u.usuario).join(', ')} · contraseña ${PASSWORD}`);
  });

  const salir = async () => {
    await replSet.stop();
    process.exit(0);
  };
  process.on('SIGINT', salir);
  process.on('SIGTERM', salir);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

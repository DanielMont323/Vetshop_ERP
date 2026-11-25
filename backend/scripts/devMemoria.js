// API local con un Mongo EN MEMORIA y datos de prueba (se borra al cerrar). No toca Atlas.
//   npm run dev:memoria
// Usuarios de prueba (contraseña para todos: Prueba-12345; PIN del dueño: 1234; del médico: 4321):
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
  const { sembrar } = require('./datosDemo');
  await conectar();
  const usuarios = await sembrar({ password: PASSWORD, pinDueno: '1234', pinMedico: '4321' });

  const PORT = process.env.PORT || 5000;
  crearApp().listen(PORT, () => {
    console.log(`API (Mongo en memoria) en http://localhost:${PORT}/api`);
    console.log(`Usuarios: ${usuarios.join(', ')} · contraseña ${PASSWORD}`);
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

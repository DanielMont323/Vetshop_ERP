// Conexión a MongoDB reutilizable en serverless (Vercel): se cachea en `global` para que
// las invocaciones calientes de la misma instancia no abran una conexión nueva.
// Nunca llama a process.exit: si falla, lanza el error y la petición responde 503.
const mongoose = require('mongoose');

mongoose.set('strictQuery', true);

const cache = global.__vetshopMongo || (global.__vetshopMongo = { promesa: null });

async function conectar(uri = process.env.MONGODB_URI) {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!uri) throw new Error('Falta la variable MONGODB_URI');
  if (!cache.promesa) {
    cache.promesa = mongoose
      .connect(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 10 })
      .then(() => mongoose.connection)
      .catch(error => {
        cache.promesa = null; // permitir reintento en la siguiente petición
        throw error;
      });
  }
  return cache.promesa;
}

async function desconectar() {
  cache.promesa = null;
  await mongoose.disconnect();
}

module.exports = { conectar, desconectar };

// Mongo en memoria con réplica de un nodo (las transacciones exigen réplica).
const { MongoMemoryReplSet } = require('mongodb-memory-server');

module.exports = async () => {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  global.__MONGO_REPLSET__ = replSet;
  // Los procesos de prueba se crean después de este punto y heredan la variable
  process.env.MONGO_URI_PRUEBAS = replSet.getUri('vetshop-pruebas');
};

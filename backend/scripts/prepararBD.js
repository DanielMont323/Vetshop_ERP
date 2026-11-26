// Crea (o pone al día) todas las colecciones e índices de la base de MONGODB_URI.
// Seguro de repetir: no borra datos. Úsalo al crear la base y después de cada actualización que agregue índices.
//   npm run preparar-bd
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { conectar, desconectar } = require('../config/database');

async function main() {
  const carpeta = path.join(__dirname, '..', 'models');
  for (const archivo of fs.readdirSync(carpeta).filter(a => a.endsWith('.js'))) require(path.join(carpeta, archivo));

  await conectar();
  const db = mongoose.connection.db;
  const existentes = new Set((await db.listCollections().toArray()).map(c => c.name));
  console.log(`Base: ${db.databaseName}`);
  for (const modelo of Object.values(mongoose.models).sort((a, b) => a.collection.name.localeCompare(b.collection.name))) {
    const nombre = modelo.collection.name;
    if (!existentes.has(nombre)) await modelo.createCollection();
    await modelo.syncIndexes();
    const indices = await modelo.collection.indexes();
    console.log(`  ${existentes.has(nombre) ? '=' : '+'} ${nombre.padEnd(22)} ${indices.length} índice(s)`);
  }
  // Datos que agregan los módulos nuevos (seguros de repetir)
  const cuentas = await require('../services/cuentasPorPagar').generarFaltantes();
  if (cuentas) console.log(`  Cuentas por pagar creadas de compras ya recibidas: ${cuentas}`);
  console.log('Listo.');
}

main()
  .catch(error => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => desconectar().catch(() => {}));

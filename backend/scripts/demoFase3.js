// Agrega los datos de demostración de la Fase 3 a una base demo que ya tiene las Fases 1 y 2 (sin borrar nada).
// Se niega si la base no es la demo (sin «Centro (prueba)») o si ya se cargaron.
//
// PowerShell:  npm run demo-fase3      (usa MONGODB_URI del .env; debe apuntar a la base demo)
require('dotenv').config({ quiet: true });
const { conectar, desconectar } = require('../config/database');
const Sucursal = require('../models/Sucursal');
const { sembrarFase3, yaCargada } = require('./datosDemoFase3');

async function main() {
  await conectar();
  if (!(await Sucursal.exists({ nombre: 'Centro (prueba)' }))) throw new Error('Esta base no tiene los datos de demostración: no se toca');
  if (await yaCargada()) throw new Error('Los datos de la Fase 3 ya están cargados en esta base');
  await sembrarFase3();
  console.log('Datos de demostración de la Fase 3 cargados.');
}

main()
  .catch(error => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => desconectar().catch(() => {}));

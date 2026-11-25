// Carga los datos de DEMOSTRACIÓN en una base VACÍA (p. ej. una base "vetshop-demo" en Atlas para
// enseñar el sistema). Se niega si la base ya tiene sucursales o usuarios: nunca mezcla con datos reales.
//
// PowerShell:
//   $env:MONGODB_URI = "mongodb+srv://…/vetshop-demo"; $env:DEMO_PASSWORD = "una-contraseña-larga"
//   npm run seed-demo
// Variables: DEMO_PASSWORD (obligatoria, mín. 8), DEMO_PIN_DUENO y DEMO_PIN_MEDICO (opcionales, 4–6 dígitos).
require('dotenv').config({ quiet: true });
const { conectar, desconectar } = require('../config/database');
const Sucursal = require('../models/Sucursal');
const Usuario = require('../models/Usuario');
const { sembrar } = require('./datosDemo');

async function main() {
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 8) throw new Error('Define DEMO_PASSWORD (mínimo 8 caracteres)');
  const pinDueno = process.env.DEMO_PIN_DUENO || String(Math.floor(1000 + Math.random() * 9000));
  const pinMedico = process.env.DEMO_PIN_MEDICO || String(Math.floor(1000 + Math.random() * 9000));

  await conectar();
  if ((await Sucursal.estimatedDocumentCount()) > 0 || (await Usuario.estimatedDocumentCount()) > 0) {
    throw new Error('La base no está vacía: los datos de demostración solo se cargan en una base nueva');
  }
  const usuarios = await sembrar({ password, pinDueno, pinMedico });
  console.log(`Datos de demostración cargados. Usuarios: ${usuarios.join(', ')} (contraseña: la de DEMO_PASSWORD).`);
  console.log(`PIN del dueño: ${pinDueno} · PIN del médico: ${pinMedico}`);
}

main()
  .catch(error => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => desconectar().catch(() => {}));

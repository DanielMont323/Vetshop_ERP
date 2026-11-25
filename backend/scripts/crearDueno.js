// Crea el PRIMER usuario dueño (cuando la base está vacía). Después, los usuarios se crean desde la app.
//
// PowerShell:
//   $env:DUENO_PASSWORD = "una-contraseña-larga"; npm run crear-dueno -- --usuario carlos --nombre "Carlos"
// Bash:
//   DUENO_PASSWORD="una-contraseña-larga" npm run crear-dueno -- --usuario carlos --nombre "Carlos"
//
// La contraseña va por variable de entorno para que no quede en el historial de la terminal.
// Si ya existe algún dueño, no hace nada (no sirve para tomar el control de un sistema en uso).
require('dotenv').config({ quiet: true });
const { conectar, desconectar } = require('../config/database');
const Usuario = require('../models/Usuario');
const { registrar } = require('../services/auditoria');

function argumento(nombre) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const usuario = argumento('usuario');
  const nombre = argumento('nombre');
  const password = process.env.DUENO_PASSWORD;
  if (!usuario || !nombre || !password) {
    throw new Error('Uso: DUENO_PASSWORD=... npm run crear-dueno -- --usuario carlos --nombre "Carlos"');
  }

  await conectar();
  if (await Usuario.exists({ rol: 'dueno' })) {
    console.log('Ya existe un usuario dueño. No se creó nada.');
    return;
  }
  const dueno = new Usuario({ nombre, usuario, rol: 'dueno', sucursales: [] });
  await dueno.establecerPassword(password);
  await dueno.save();
  await registrar({ usuario: dueno._id, accion: 'usuario.crear', entidad: 'Usuario', entidadId: dueno._id, despues: dueno.publico(), motivo: 'Primer dueño (script)' });
  console.log(`Dueño "${dueno.usuario}" creado. Entra a la app y define tu PIN de autorización.`);
}

main()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(desconectar);

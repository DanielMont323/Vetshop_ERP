// Importación inicial desde Excel (catálogo, precios, inventario inicial y clientes).
//
//   npm run plantilla-importacion -- plantilla.xlsx           → genera la plantilla vacía (scripts/plantillaImportacion.js)
//   npm run importar -- datos.xlsx --usuario carlos           → SOLO revisa y muestra errores y avisos
//   npm run importar -- datos.xlsx --usuario carlos --aplicar → carga (si no hay errores)
//
// Usa MONGODB_URI del .env. El usuario debe ser un dueño activo (queda como autor en la bitácora).
require('dotenv').config({ quiet: true });
const { conectar, desconectar } = require('../config/database');
const Usuario = require('../models/Usuario');
const { leerLibro } = require('../helpers/excelImportacion');
const importacion = require('../services/importacion');

function argumento(nombre) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function importar(ruta) {
  const nombreUsuario = argumento('usuario');
  if (!nombreUsuario) throw new Error('Indica el dueño que importa: --usuario <usuario>');
  await conectar();
  const actor = await Usuario.findOne({ usuario: nombreUsuario.toLowerCase(), rol: 'dueno', activo: true }).lean();
  if (!actor) throw new Error(`"${nombreUsuario}" no es un dueño activo`);

  const libro = await leerLibro(ruta);
  console.log(`Leído: ${libro.productos.length} productos, ${libro.precios.length} filas de precios, ${libro.existencias.length} lotes, ${libro.clientes.length} clientes`);
  const resultado = await importacion.validar(libro);

  for (const a of resultado.avisos) console.log(`  AVISO  ${a.hoja} fila ${a.fila}: ${a.mensaje}`);
  for (const e of resultado.errores) console.log(`  ERROR  ${e.hoja} fila ${e.fila}: ${e.mensaje}`);
  const r = resultado.resumen;
  console.log(`\nResumen: ${r.productosNuevos} productos nuevos, ${r.productosActualizados} a actualizar, ${r.precios} precios, ${r.lotes} lotes en ${r.sucursalesConInventario.join(', ') || 'ninguna sucursal'}, ${r.clientes} clientes.`);

  if (resultado.errores.length) {
    console.log(`\n${resultado.errores.length} error(es): corrige el archivo y vuelve a correr. No se cargó nada.`);
    process.exitCode = 1;
    return;
  }
  if (!process.argv.includes('--aplicar')) {
    console.log('\nSin errores. Para cargar, repite el comando con --aplicar.');
    return;
  }
  const hecho = await importacion.aplicar(resultado, actor);
  console.log(`\nCargado: ${hecho.productos} productos, ${hecho.precios} precios, ${hecho.lotes} lotes, ${hecho.clientes} clientes.`);
}

async function main() {
  const ruta = process.argv[2];
  if (!ruta || ruta.startsWith('--')) throw new Error('Indica el archivo .xlsx');
  return importar(ruta);
}

main()
  .catch(error => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => desconectar().catch(() => {}));

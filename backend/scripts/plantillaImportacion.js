// Genera la plantilla vacía de importación:  npm run plantilla-importacion -- plantilla.xlsx
// No necesita base de datos.
const fs = require('fs/promises');
const { crearPlantilla } = require('../helpers/excelImportacion');

const ruta = process.argv[2] || 'plantilla-importacion.xlsx';
crearPlantilla()
  .then(buffer => fs.writeFile(ruta, Buffer.from(buffer)))
  .then(() => console.log(`Plantilla creada: ${ruta}`))
  .catch(error => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });

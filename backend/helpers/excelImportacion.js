// Plantilla de importación y lectura del libro lleno.
// Las columnas se reconocen por su encabezado (sin importar mayúsculas, acentos ni espacios).
const ExcelJS = require('exceljs');
const { normalizar } = require('./texto');

const HOJAS = {
  Productos: [
    ['SKU', 'sku', 14], ['Código de barras', 'codigoBarras', 18], ['Nombre', 'nombre', 40], ['Categoría', 'categoria', 14],
    ['Unidad', 'unidad', 8], ['Presentación', 'presentacion', 20], ['Requiere receta', 'requiereReceta', 9],
    ['Controlado', 'controlado', 9], ['Refrigeración', 'refrigeracion', 9], ['IVA', 'iva', 8], ['Activo', 'activo', 8]
  ],
  Precios: [['SKU', 'sku', 14], ['Público', 'publico', 12], ['Mayoreo', 'mayoreo', 12], ['Clínica', 'clinica', 12], ['Empleado', 'empleado', 12]],
  Existencias: [
    ['Sucursal', 'sucursal', 20], ['SKU', 'sku', 14], ['Lote', 'lote', 14], ['Caducidad', 'caducidad', 12],
    ['Cantidad', 'cantidad', 10], ['Costo unitario', 'costoUnitario', 14]
  ],
  Clientes: [
    ['Nombre', 'nombre', 34], ['Tipo', 'tipo', 12], ['Lista de precios', 'listaPrecios', 14], ['RFC', 'rfc', 15],
    ['Teléfono', 'telefono', 14], ['Correo', 'correo', 26], ['Saldo', 'saldo', 12]
  ]
};

const INSTRUCCIONES = [
  'Cómo llenar esta plantilla (una fila por registro; no cambies los encabezados)',
  '',
  'Productos: SKU único. Categoría: medicamento, biologico, alimento, accesorio, higiene u otro. Unidad: pieza o kg.',
  '  Requiere receta / Controlado / Refrigeración / Activo: sí o no (Activo vacío = sí). IVA: 16, 0 o exento.',
  'Precios: precios FINALES con IVA, en pesos (p. ej. 1299.00). Para productos por kg, el precio es por kilo. Vacío = sin precio en esa lista.',
  'Existencias: una fila por lote. Sucursal con el nombre tal como está en el sistema. Caducidad: MM/AAAA, DD/MM/AAAA o fecha.',
  '  Cantidad: piezas enteras, o kg con hasta 3 decimales. Costo unitario SIN IVA, por pieza o por kg.',
  '  Medicamentos y biológicos requieren lote y caducidad; alimento requiere caducidad.',
  '  El inventario inicial de una sucursal solo se carga UNA vez (la sucursal no debe tener movimientos).',
  'Clientes: Tipo: publico, clinica, veterinaria, petshop, estetica o empleado. Lista: publico, mayoreo, clinica o empleado.',
  '  El saldo NO se importa todavía (el crédito llega en la Fase 2); se avisa para no perderlo.',
  '',
  'Antes de cargar: npm run importar -- archivo.xlsx --usuario <dueño>   (solo revisa y muestra errores)',
  'Para cargar:      npm run importar -- archivo.xlsx --usuario <dueño> --aplicar'
];

async function crearPlantilla() {
  const libro = new ExcelJS.Workbook();
  const instrucciones = libro.addWorksheet('Instrucciones');
  instrucciones.getColumn(1).width = 130;
  INSTRUCCIONES.forEach((t, i) => {
    instrucciones.getCell(`A${i + 1}`).value = t;
  });
  instrucciones.getCell('A1').font = { bold: true, size: 13 };

  for (const [nombre, columnas] of Object.entries(HOJAS)) {
    const h = libro.addWorksheet(nombre);
    h.columns = columnas.map(([header, key, width]) => ({ header, key, width }));
    h.getRow(1).font = { bold: true };
    h.views = [{ state: 'frozen', ySplit: 1 }];
  }
  // Listas desplegables en las columnas con valores fijos (filas 2 a 2000)
  const lista = (hoja, col, valores) => {
    for (let fila = 2; fila <= 2000; fila++) {
      libro.getWorksheet(hoja).getCell(`${col}${fila}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${valores.join(',')}"`] };
    }
  };
  lista('Productos', 'D', ['medicamento', 'biologico', 'alimento', 'accesorio', 'higiene', 'otro']);
  lista('Productos', 'E', ['pieza', 'kg']);
  for (const col of ['G', 'H', 'I', 'K']) lista('Productos', col, ['sí', 'no']);
  lista('Productos', 'J', ['16', '0', 'exento']);
  lista('Clientes', 'B', ['publico', 'clinica', 'veterinaria', 'petshop', 'estetica', 'empleado']);
  lista('Clientes', 'C', ['publico', 'mayoreo', 'clinica', 'empleado']);
  return libro.xlsx.writeBuffer();
}

// Valor "plano" de una celda de ExcelJS (texto enriquecido, hipervínculos, fórmulas)
function valorCelda(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('');
    if ('result' in v) return valorCelda(v.result);
    if ('text' in v) return v.text;
  }
  return v;
}

const claveEncabezado = t => normalizar(String(t)).replace(/[^a-z0-9]/g, '');

// Lee un libro (ruta o buffer) → { productos, precios, existencias, clientes } con `fila` en cada registro
async function leerLibro(origen) {
  const libro = new ExcelJS.Workbook();
  if (Buffer.isBuffer(origen)) await libro.xlsx.load(origen);
  else await libro.xlsx.readFile(origen);
  const resultado = {};
  for (const [nombre, columnas] of Object.entries(HOJAS)) {
    const clave = nombre.toLowerCase();
    resultado[clave] = [];
    const hoja = libro.worksheets.find(w => claveEncabezado(w.name) === claveEncabezado(nombre));
    if (!hoja) continue;
    const porEncabezado = new Map(columnas.map(([header, key]) => [claveEncabezado(header), key]));
    const columnaDe = {};
    hoja.getRow(1).eachCell((celda, col) => {
      const key = porEncabezado.get(claveEncabezado(valorCelda(celda.value)));
      if (key) columnaDe[key] = col;
    });
    hoja.eachRow((fila, numero) => {
      if (numero === 1) return;
      const registro = { fila: numero };
      let vacia = true;
      for (const [key, col] of Object.entries(columnaDe)) {
        registro[key] = valorCelda(fila.getCell(col).value);
        if (registro[key] !== '') vacia = false;
      }
      if (!vacia) resultado[clave].push(registro);
    });
  }
  return resultado;
}

module.exports = { crearPlantilla, leerLibro, HOJAS };

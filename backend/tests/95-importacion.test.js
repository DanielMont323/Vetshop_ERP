// Importación inicial desde Excel: lectura de la plantilla, validación (errores y avisos por hoja y
// fila, sin escribir nada) y carga (productos, precios, inventario inicial por lote, clientes).
const ExcelJS = require('exceljs');
const h = require('./helpers/app');
const Producto = require('../models/Producto');
const Cliente = require('../models/Cliente');
const InventoryLayer = require('../models/InventoryLayer');
const { crearPlantilla, leerLibro } = require('../helpers/excelImportacion');
const importacion = require('../services/importacion');
const { resolverPrecio } = require('../services/precios');
const { Auditoria } = h.modelos;

let centro, dueno;
beforeAll(async () => {
  await h.resetDb();
  centro = await h.crearSucursal({ nombre: 'Centro' });
  await h.crearSucursal({ nombre: 'Almacén General', tipo: 'almacen' });
  dueno = await h.crearUsuario({ rol: 'dueno' });
});
afterAll(h.cerrar);

// Llena la plantilla real con filas { Hoja: [[...valores en orden de columnas]] } y la relee
async function libroCon(datos) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(Buffer.from(await crearPlantilla()));
  // Se escribe desde la fila 2 como lo haría una persona (addRow agregaría después de las filas
  // que ya tienen listas desplegables)
  for (const [hoja, filas] of Object.entries(datos)) {
    filas.forEach((valores, i) => {
      const fila = libro.getWorksheet(hoja).getRow(i + 2);
      valores.forEach((v, c) => {
        fila.getCell(c + 1).value = v === '' ? null : v;
      });
      fila.commit();
    });
  }
  return leerLibro(Buffer.from(await libro.xlsx.writeBuffer()));
}

const filasValidas = {
  Productos: [
    ['CRQ-20', '7500000000011', 'Croquetas Adulto 20 kg', 'alimento', 'pieza', 'Costal 20 kg', 'no', 'no', 'no', '0', ''],
    ['GRA-GATO', '', 'Croqueta gato granel', 'alimento', 'kg', '', 'no', 'no', 'no', 0, 'sí'],
    ['TRAMA', '7500000000099', 'Analgésico controlado', 'medicamento', 'pieza', '', 'no', 'sí', 'no', 'exento', 'si'],
    ['VAC-R', '7500000000028', 'Vacuna rabia', 'Biológico', 'pza', '', 'sí', 'no', 'sí', '0', '']
  ],
  Precios: [
    ['CRQ-20', 1299, 1150, '', ''],
    ['GRA-GATO', '89.90', '', '', ''],
    ['TRAMA', '450', '', '', ''],
    ['VAC-R', 250.5, '', 180, '']
  ],
  Existencias: [
    ['centro', 'CRQ-20', 'CR-1', '10/2027', 8, 980],
    ['Centro', 'GRA-GATO', '', new Date(Date.UTC(2027, 4, 31)), 2.5, '51.20'],
    ['Centro', 'TRAMA', 'T-9', '06/2027', 3, 300],
    ['Centro', 'VAC-R', 'V-OLD', '01/2020', 2, 150]
  ],
  Clientes: [
    ['Clínica Patitas', 'clínica', 'mayoreo', 'CPA850101AB1', '3110000000', 'contacto@ejemplo.mx', '1500'],
    ['Juan Pérez', '', '', '', '', '', '']
  ]
};

test('la plantilla tiene las hojas y la lectura reconoce encabezados, fechas y omite filas vacías', async () => {
  const libro = await libroCon({ Productos: [filasValidas.Productos[0], [], filasValidas.Productos[1]], Existencias: [filasValidas.Existencias[1]] });
  expect(libro.productos.map(p => [p.fila, p.sku])).toEqual([[2, 'CRQ-20'], [4, 'GRA-GATO']]);
  expect(libro.existencias[0].caducidad).toBeInstanceOf(Date);
});

test('validar reporta cada error con hoja y fila, sin escribir nada', async () => {
  const libro = await libroCon({
    Productos: [
      ['MAL SKU', '', 'X', 'alimento', 'pieza', '', 'no', 'no', 'no', '0', ''],
      ['DUP', '', 'Uno', 'juguetes', 'litro', '', 'quizá', 'no', 'no', '8', ''],
      ['DUP', '', 'Dos', 'otro', 'pieza', '', 'no', 'no', 'no', '16', ''],
      ['MED', '', 'Med', 'medicamento', 'pieza', '', 'sí', 'no', 'no', '0', '']
    ],
    Precios: [['MED', '12.345', '', '', ''], ['NOEXISTE', 10, '', '', '']],
    Existencias: [['Marte', 'MED', 'L', '01/2028', 1, 1], ['Centro', 'MED', '', '01/2028', 1, 1], ['Centro', 'MED', 'L1', '01/2028', 1.5, ''], ['Centro', 'MED', 'L2', '13/2028', 1, 1]],
    Clientes: [['X', 'mayorista', 'publico', 'MALRFC', '', '', '']]
  });
  const { errores } = await importacion.validar(libro);
  const de = (hoja, fila) => errores.filter(e => e.hoja === hoja && e.fila === fila).map(e => e.mensaje).join(' | ');
  expect(de('Productos', 2)).toMatch(/SKU inválido/);
  for (const patron of [/Valor no válido en Categoría/, /unidad inválida/, /no es sí o no/, /IVA inválido/]) expect(de('Productos', 3)).toMatch(patron);
  expect(de('Productos', 4)).toMatch(/SKU repetido/);
  expect(de('Precios', 2)).toMatch(/Precio publico/);
  expect(de('Precios', 3)).toMatch(/no está en Productos/);
  expect(de('Existencias', 2)).toMatch(/Sucursal desconocida/);
  expect(de('Existencias', 3)).toMatch(/indica el lote/);
  expect(de('Existencias', 4)).toMatch(/cantidad inválida.*Falta el costo/s);
  expect(de('Existencias', 5)).toMatch(/Caducidad|Mes de caducidad/);
  expect(de('Clientes', 2)).toMatch(/Valor no válido en Tipo/);
  expect(de('Clientes', 2)).toMatch(/RFC inválido/);
  expect(await Producto.countDocuments({})).toBe(0);
  await expect(importacion.aplicar({ errores, avisos: [], plan: {} }, dueno)).rejects.toThrow(/errores/);
});

test('carga completa: productos, precios, inventario inicial por lote y clientes; avisos de caducado y saldo', async () => {
  const resultado = await importacion.validar(await libroCon(filasValidas));
  expect(resultado.errores).toEqual([]);
  expect(resultado.avisos.map(a => a.mensaje).join(' | ')).toMatch(/V-OLD caducó.*saldo no se importa/s);
  expect(resultado.resumen).toMatchObject({ productosNuevos: 4, precios: 6, lotes: 4, clientes: 2, sucursalesConInventario: ['Centro'] });

  const hecho = await importacion.aplicar(resultado, dueno);
  expect(hecho).toEqual({ productos: 4, precios: 6, lotes: 4, clientes: 2 });

  const trama = await Producto.findOne({ sku: 'TRAMA' }).lean();
  expect(trama).toMatchObject({ esControlado: true, requiereReceta: true, iva: 'exento' });
  const vacuna = await Producto.findOne({ sku: 'VAC-R' }).lean();
  expect(vacuna).toMatchObject({ categoria: 'biologico', unidad: 'pieza', requiereRefrigeracion: true });
  expect(await resolverPrecio(vacuna._id, 'clinica')).toEqual({ precio: 18000, lista: 'clinica' });
  expect(await resolverPrecio(vacuna._id, 'publico')).toEqual({ precio: 25050, lista: 'publico' });

  const granel = await Producto.findOne({ sku: 'GRA-GATO' }).lean();
  const [capa] = await InventoryLayer.find({ sucursal: centro._id, producto: granel._id }).lean();
  expect(capa).toMatchObject({ cantidadInicial: 2500, costoUnitario: 5120, origen: 'inventario_inicial' });
  expect(capa.caducidad.toISOString()).toBe('2027-06-01T06:59:59.999Z'); // 31/05/2027 fin del día en Tepic
  const crq = await Producto.findOne({ sku: 'CRQ-20' }).lean();
  const [capaCrq] = await InventoryLayer.find({ sucursal: centro._id, producto: crq._id }).lean();
  expect(capaCrq.caducidad.toISOString()).toBe('2027-11-01T06:59:59.999Z'); // 10/2027 = 31 de octubre

  const clinica = await Cliente.findOne({ rfc: 'CPA850101AB1' }).lean();
  expect(clinica).toMatchObject({ tipo: 'clinica', listaPrecios: 'mayoreo', email: 'contacto@ejemplo.mx' });
  expect(await Cliente.findOne({ nombre: 'Juan Pérez' }).lean()).toMatchObject({ tipo: 'publico', listaPrecios: 'publico' });

  expect(await Auditoria.countDocuments({ accion: 'importacion.inventario_inicial', sucursal: centro._id })).toBe(1);
});

test('reimportar el catálogo actualiza productos; el inventario inicial de una sucursal no se carga dos veces', async () => {
  const libro = await libroCon({
    Productos: [['CRQ-20', '7500000000011', 'Croquetas Adulto 20 kg (nueva receta)', 'alimento', 'pieza', '', 'no', 'no', 'no', '0', '']],
    Existencias: [['Centro', 'CRQ-20', 'CR-2', '12/2027', 5, 990]]
  });
  const resultado = await importacion.validar(libro);
  expect(resultado.errores.map(e => e.mensaje)).toEqual(['Centro ya tiene inventario: el inventario inicial solo se carga una vez']);

  const soloCatalogo = await importacion.validar({ ...libro, existencias: [] });
  expect(soloCatalogo.resumen.productosActualizados).toBe(1);
  await importacion.aplicar(soloCatalogo, dueno);
  expect((await Producto.findOne({ sku: 'CRQ-20' }).lean()).nombre).toBe('Croquetas Adulto 20 kg (nueva receta)');
});

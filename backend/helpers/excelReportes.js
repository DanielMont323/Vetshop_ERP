// Libro de Excel del reporte de ventas (para el dueño y el contador externo).
// Importes en pesos con formato de moneda (se convierten de centavos solo aquí); fechas en hora de Tepic.
const ExcelJS = require('exceljs');
const { aPesos } = require('./dinero');
const { baseATexto } = require('./cantidades');
const { formatearLocal } = require('./fechas');

const MONEDA = '"$"#,##0.00';
const METODOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', credito: 'A crédito' };
const CANALES = { publico: 'Público', distribucion: 'Distribución' };

function hoja(libro, nombre, columnas, filas) {
  const h = libro.addWorksheet(nombre);
  h.columns = columnas.map(([header, key, width, esDinero]) => ({ header, key, width, ...(esDinero && { style: { numFmt: MONEDA } }) }));
  h.getRow(1).font = { bold: true };
  h.views = [{ state: 'frozen', ySplit: 1 }];
  for (const f of filas) h.addRow(f);
  return h;
}

const columnasMargen = [
  ['Ventas', 'ventas', 10], ['Total (con IVA)', 'total', 16, true], ['IVA', 'iva', 14, true],
  ['Base (sin IVA)', 'base', 16, true], ['Costo', 'costo', 14, true], ['Margen', 'margen', 14, true], ['Margen %', 'margenPorcentaje', 11]
];
const pesos = f => ({ ...f, total: aPesos(f.total), iva: aPesos(f.iva), base: aPesos(f.base), costo: aPesos(f.costo), margen: aPesos(f.margen) });

async function libroVentas(resumen, ventas, { titulo }) {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Huellitas Vetshop ERP';
  libro.created = new Date();

  const t = resumen.totales;
  // Solo los importes llevan formato de moneda (no el número de ventas ni el porcentaje)
  const filasResumen = [
    ['Periodo', `${resumen.desde} a ${resumen.hasta}`],
    ['Ventas cobradas', t.ventas],
    ['Total vendido (con IVA)', aPesos(t.total), true],
    ['IVA', aPesos(t.iva), true],
    ['Base (sin IVA)', aPesos(t.base), true],
    ['Costo de lo vendido', aPesos(t.costo), true],
    ['Margen', aPesos(t.margen), true],
    ['Margen %', t.margenPorcentaje],
    ['Ticket promedio', aPesos(t.ticketPromedio), true],
    ['Descuentos otorgados', aPesos(t.descuento), true]
  ];
  const hojaResumen = hoja(libro, 'Resumen', [['Concepto', 'c', 30], ['Valor', 'v', 22]], [{ c: titulo, v: '' }, ...filasResumen.map(([c, v]) => ({ c, v }))]);
  filasResumen.forEach(([, , esDinero], i) => {
    if (esDinero) hojaResumen.getCell(`B${i + 3}`).numFmt = MONEDA;
  });

  hoja(libro, 'Por periodo', [['Periodo', 'periodo', 14], ...columnasMargen], resumen.periodos.map(pesos));
  hoja(libro, 'Por sucursal', [['Sucursal', 'nombre', 24], ...columnasMargen], resumen.sucursales.map(f => ({ ...pesos(f), nombre: f.sucursal.nombre })));
  hoja(libro, 'Por cajero', [['Cajero', 'nombre', 24], ...columnasMargen], resumen.cajeros.map(f => ({ ...pesos(f), nombre: f.cajero.nombre })));
  hoja(libro, 'Forma de pago', [['Forma de pago', 'metodo', 18], ['Ventas', 'ventas', 10], ['Cobrado', 'monto', 16, true]],
    resumen.formasPago.map(f => ({ metodo: METODOS[f.metodo], ventas: f.ventas, monto: aPesos(f.monto) })));
  hoja(libro, 'Público vs distribución', [['Canal', 'canal', 16], ...columnasMargen], resumen.canales.map(f => ({ ...pesos(f), canal: CANALES[f.canal] })));
  hoja(libro, 'Productos', [['SKU', 'sku', 14], ['Producto', 'nombre', 34], ['Cantidad', 'cantidad', 12], ['Unidad', 'unidad', 8], ...columnasMargen],
    resumen.productos.map(f => ({ ...pesos(f), cantidad: Number(baseATexto(f.cantidad, f.unidad)), unidad: f.unidad === 'kg' ? 'kg' : 'pza' })));

  hoja(libro, 'Ventas', [
    ['Fecha', 'fecha', 18], ['Sucursal', 'sucursal', 18], ['Folio', 'folio', 10], ['Cliente', 'cliente', 26], ['Cajero', 'cajero', 20],
    ['Estado', 'estado', 11], ['Total', 'total', 14, true], ['IVA', 'iva', 12, true], ['Descuento', 'descuento', 12, true],
    ['Costo', 'costo', 12, true], ['Efectivo', 'efectivo', 12, true], ['Tarjeta', 'tarjeta', 12, true], ['Transferencia', 'transferencia', 14, true],
    ['A crédito', 'credito', 12, true]
  ], ventas.map(v => {
    const metodo = m => aPesos(v.pagos.filter(p => p.metodo === m).reduce((s, p) => s + p.monto, 0) - (m === 'efectivo' ? v.cambio || 0 : 0));
    return {
      fecha: formatearLocal(v.fecha, 'dd/MM/yyyy HH:mm'), sucursal: v.sucursalNombre, folio: `${v.serie}-${v.folio}`, cliente: v.clienteNombre,
      cajero: v.cajeroNombre, estado: v.estado === 'cobrada' ? 'Cobrada' : 'Cancelada', total: aPesos(v.total), iva: aPesos(v.iva),
      descuento: aPesos(v.descuento), costo: aPesos(v.costo), efectivo: metodo('efectivo'), tarjeta: metodo('tarjeta'), transferencia: metodo('transferencia'),
      credito: metodo('credito')
    };
  }));

  return libro.xlsx.writeBuffer();
}

// Cartera de clientes por antigüedad (cuentas por cobrar) para el dueño y el contador
async function libroCartera(cartera, { fecha = new Date() } = {}) {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Huellitas Vetshop ERP';
  libro.created = new Date();
  const columnas = [
    ['Cliente', 'cliente', 32], ['Límite', 'limite', 14, true], ['Saldo', 'saldo', 14, true], ['Al corriente', 'corriente', 14, true],
    ['1 a 30 días', 'd1_30', 14, true], ['31 a 60 días', 'd31_60', 14, true], ['Más de 60 días', 'mas60', 15, true],
    ['Vencido', 'vencido', 14, true], ['Disponible', 'disponible', 14, true], ['Ventas pendientes', 'cargos', 10]
  ];
  const fila = f => ({
    cliente: f.cliente.nombre, limite: aPesos(f.credito.limite), saldo: aPesos(f.saldo), corriente: aPesos(f.corriente), d1_30: aPesos(f.d1_30),
    d31_60: aPesos(f.d31_60), mas60: aPesos(f.mas60), vencido: aPesos(f.vencido), disponible: aPesos(f.disponible), cargos: f.cargos
  });
  const h = hoja(libro, 'Cartera', columnas, cartera.datos.map(fila));
  const t = cartera.totales;
  const total = h.addRow({ cliente: `Total al ${formatearLocal(fecha, 'dd/MM/yyyy')}`, saldo: aPesos(t.saldo), corriente: aPesos(t.corriente), d1_30: aPesos(t.d1_30), d31_60: aPesos(t.d31_60), mas60: aPesos(t.mas60), vencido: aPesos(t.vencido) });
  total.font = { bold: true };
  return libro.xlsx.writeBuffer();
}

module.exports = { libroCartera, libroVentas };

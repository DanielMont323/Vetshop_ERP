// Datos de DEMOSTRACIÓN (todo inventado, marcado "(prueba)"): sucursales, usuarios, catálogo con
// precios, inventario inicial (con un lote caducado y uno por caducar), proveedores y clientes, y los datos
// de la Fase 2 (datosDemoFase2.js): ventas, crédito, cuentas por pagar, cadena de frío, metas y una factura.
// Lo usan dev:memoria (Mongo en memoria) y seed-demo (una base de demostración vacía).
const Sucursal = require('../models/Sucursal');
const Usuario = require('../models/Usuario');
const Producto = require('../models/Producto');
const ListaPrecios = require('../models/ListaPrecios');
const Proveedor = require('../models/Proveedor');
const Cliente = require('../models/Cliente');
const inv = require('../services/inventario');
const { conTransaccion } = require('../helpers/transaccion');
const { formatearLocal } = require('../helpers/fechas');
const { sembrarFase2 } = require('./datosDemoFase2');

const CATALOGO = [
  { sku: 'CRQ-AD-20', codigoBarras: '7500000000011', nombre: 'Croquetas Perro Adulto (prueba)', categoria: 'alimento', unidad: 'pieza', presentacion: 'Costal 20 kg', iva: 'tasa_0', precios: { publico: 129900, mayoreo: 115000, clinica: 112000 } },
  { sku: 'GRA-GATO', nombre: 'Croqueta Gato a granel (prueba)', categoria: 'alimento', unidad: 'kg', iva: 'tasa_0', precios: { publico: 8990, mayoreo: 7900 } },
  { sku: 'VAC-RAB', codigoBarras: '7500000000028', nombre: 'Vacuna Antirrábica (prueba)', categoria: 'biologico', unidad: 'pieza', iva: 'tasa_0', requiereRefrigeracion: true, precios: { publico: 25000, clinica: 18000 } },
  { sku: 'ANTB-100', codigoBarras: '7500000000035', nombre: 'Antibiótico Oral 100 ml (prueba)', categoria: 'medicamento', unidad: 'pieza', iva: 'tasa_0', requiereReceta: true, precios: { publico: 34900 } },
  { sku: 'COLLAR-M', codigoBarras: '7500000000042', nombre: 'Collar Nylon Mediano (prueba)', categoria: 'accesorio', unidad: 'pieza', iva: 'tasa_16', precios: { publico: 14900, empleado: 11000 } }
];

/**
 * @param {object} o { password, pinDueno, pinMedico }
 * @returns {Promise<string[]>} usuarios creados
 */
async function sembrar({ password, pinDueno, pinMedico }) {
  const [centro, norte, almacen] = await Sucursal.create([
    { nombre: 'Centro (prueba)', tipo: 'tienda' },
    { nombre: 'Norte (prueba)', tipo: 'tienda' },
    { nombre: 'Almacén (prueba)', tipo: 'almacen' }
  ]);
  const usuarios = [
    { nombre: 'Dueño Demo', usuario: 'dueno.demo', rol: 'dueno', sucursales: [], pin: pinDueno },
    { nombre: 'Cajero Centro', usuario: 'cajero.centro', rol: 'cajero', sucursales: [centro._id] },
    { nombre: 'Cajero Norte', usuario: 'cajero.norte', rol: 'cajero', sucursales: [norte._id] },
    { nombre: 'Almacén Demo', usuario: 'almacen.demo', rol: 'almacen', sucursales: [almacen._id, centro._id, norte._id] },
    { nombre: 'Médico Demo', usuario: 'medico.demo', rol: 'medico_responsable', sucursales: [centro._id], pin: pinMedico }
  ];
  for (const { pin, ...datos } of usuarios) {
    const u = new Usuario(datos);
    await u.establecerPassword(password);
    if (pin) await u.establecerPin(pin);
    await u.save();
  }

  const listas = Object.fromEntries(ListaPrecios.LISTAS.map(l => [l.clave, { ...l, precios: [] }]));
  const productos = {};
  for (const { precios, ...datos } of CATALOGO) {
    const p = await Producto.create({ ...datos, minimos: [{ sucursal: centro._id, cantidad: datos.unidad === 'kg' ? 10000 : 3 }] });
    productos[p.sku] = p;
    for (const [clave, precio] of Object.entries(precios)) listas[clave].precios.push({ producto: p._id, precio });
  }
  await ListaPrecios.create(Object.values(listas));

  const enDias = dias => formatearLocal(new Date(Date.now() + dias * 86400000), 'dd/MM/yyyy');
  const haceDias = dias => formatearLocal(new Date(Date.now() - dias * 86400000), 'dd/MM/yyyy');
  const dueno = await Usuario.findOne({ usuario: 'dueno.demo' });
  const porSucursal = [
    [centro, [
      ['CRQ-AD-20', 8, 98000, 'CR-2611', '08/2027'],
      ['GRA-GATO', 25000, 5200, 'GG-1', '05/2027'],
      ['VAC-RAB', 2, 15000, 'VR-OLD', haceDias(20)], // caducado
      ['VAC-RAB', 6, 16000, 'VR-0310', enDias(12)], // por caducar
      ['ANTB-100', 5, 21000, 'AB-77', '11/2027'],
      ['COLLAR-M', 32, 7100, undefined, undefined]
    ]],
    [norte, [['COLLAR-M', 10, 7000, undefined, undefined]]],
    // El almacén surte a las tiendas: tiene de todo (para probar traspasos)
    [almacen, [
      ['CRQ-AD-20', 40, 97000, 'CR-2701', '10/2027'],
      ['GRA-GATO', 100000, 5100, 'GG-2', '07/2027'],
      ['VAC-RAB', 30, 15500, 'VR-1101', '09/2027'],
      ['ANTB-100', 20, 20500, 'AB-80', '01/2028'],
      ['COLLAR-M', 50, 7000, undefined, undefined]
    ]]
  ];
  await conTransaccion(async session => {
    for (const [sucursal, entradas] of porSucursal) {
      for (const [sku, cantidad, costoUnitario, lote, caducidad] of entradas) {
        await inv.registrarEntrada(
          { sucursal: sucursal._id, producto: productos[sku]._id, cantidad, costoUnitario, lote, caducidad, origen: 'inventario_inicial', permitirCaducado: true, usuario: dueno._id },
          session
        );
      }
    }
  });

  await Proveedor.create([
    { nombre: 'Distribuidora Veterinaria (prueba)', diasCredito: 30, contacto: 'Ventas', telefono: '3110000000' },
    { nombre: 'Alimentos Mascota (prueba)', diasCredito: 0 }
  ]);
  await Cliente.create([
    { nombre: 'Público en general', tipo: 'publico', listaPrecios: 'publico', esPublicoGeneral: true },
    { nombre: 'Clínica Patitas (prueba)', tipo: 'clinica', listaPrecios: 'clinica' },
    { nombre: 'Estética Peludos (prueba)', tipo: 'estetica', listaPrecios: 'mayoreo' }
  ]);
  await sembrarFase2({ centro, norte, almacen, productos });
  return usuarios.map(u => u.usuario);
}

module.exports = { sembrar };

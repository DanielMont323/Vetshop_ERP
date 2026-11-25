// API local con un Mongo EN MEMORIA y datos de prueba (se borra al cerrar). No toca Atlas.
//   npm run dev:memoria
// Usuarios de prueba (contraseña para todos: Prueba-12345; PIN del dueño: 1234):
//   dueno.demo, cajero.centro, almacen.demo, medico.demo
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const PASSWORD = 'Prueba-12345';

async function main() {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.MONGODB_URI = replSet.getUri('vetshop-dev');
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-solo-para-desarrollo-local';
  process.env.CORS_ORIGINS = process.env.CORS_ORIGINS || 'http://localhost:5173';
  process.env.NODE_ENV = 'development';

  const { conectar } = require('../config/database');
  const { crearApp } = require('../app');
  const Sucursal = require('../models/Sucursal');
  const Usuario = require('../models/Usuario');
  await conectar();

  const [centro, norte, almacen] = await Sucursal.create([
    { nombre: 'Centro (prueba)', tipo: 'tienda' },
    { nombre: 'Norte (prueba)', tipo: 'tienda' },
    { nombre: 'Almacén (prueba)', tipo: 'almacen' }
  ]);
  const usuarios = [
    { nombre: 'Dueño Demo', usuario: 'dueno.demo', rol: 'dueno', sucursales: [], pin: '1234' },
    { nombre: 'Cajero Centro', usuario: 'cajero.centro', rol: 'cajero', sucursales: [centro._id] },
    { nombre: 'Almacén Demo', usuario: 'almacen.demo', rol: 'almacen', sucursales: [almacen._id, centro._id, norte._id] },
    { nombre: 'Médico Demo', usuario: 'medico.demo', rol: 'medico_responsable', sucursales: [centro._id], pin: '4321' }
  ];
  for (const { pin, ...datos } of usuarios) {
    const u = new Usuario(datos);
    await u.establecerPassword(PASSWORD);
    if (pin) await u.establecerPin(pin);
    await u.save();
  }

  // Catálogo de prueba (datos inventados; precios finales con IVA en centavos)
  const Producto = require('../models/Producto');
  const ListaPrecios = require('../models/ListaPrecios');
  const catalogo = [
    { sku: 'CRQ-AD-20', codigoBarras: '7500000000011', nombre: 'Croquetas Perro Adulto (prueba)', categoria: 'alimento', unidad: 'pieza', presentacion: 'Costal 20 kg', iva: 'tasa_0', precios: { publico: 129900, mayoreo: 115000, clinica: 112000 } },
    { sku: 'GRA-GATO', nombre: 'Croqueta Gato a granel (prueba)', categoria: 'alimento', unidad: 'kg', iva: 'tasa_0', precios: { publico: 8990, mayoreo: 7900 } },
    { sku: 'VAC-RAB', codigoBarras: '7500000000028', nombre: 'Vacuna Antirrábica (prueba)', categoria: 'biologico', unidad: 'pieza', iva: 'tasa_0', requiereRefrigeracion: true, precios: { publico: 25000, clinica: 18000 } },
    { sku: 'ANTB-100', codigoBarras: '7500000000035', nombre: 'Antibiótico Oral 100 ml (prueba)', categoria: 'medicamento', unidad: 'pieza', iva: 'tasa_0', requiereReceta: true, precios: { publico: 34900 } },
    { sku: 'COLLAR-M', codigoBarras: '7500000000042', nombre: 'Collar Nylon Mediano (prueba)', categoria: 'accesorio', unidad: 'pieza', iva: 'tasa_16', precios: { publico: 14900, empleado: 11000 } }
  ];
  const listas = Object.fromEntries(ListaPrecios.LISTAS.map(l => [l.clave, { ...l, precios: [] }]));
  const productos = {};
  for (const { precios, ...datos } of catalogo) {
    const p = await Producto.create({ ...datos, minimos: [{ sucursal: centro._id, cantidad: datos.unidad === 'kg' ? 10000 : 3 }] });
    productos[p.sku] = p;
    for (const [clave, precio] of Object.entries(precios)) listas[clave].precios.push({ producto: p._id, precio });
  }
  await ListaPrecios.create(Object.values(listas));

  // Inventario inicial de prueba en Centro: un lote caducado, uno por caducar y otros vigentes
  const inv = require('../services/inventario');
  const { conTransaccion } = require('../helpers/transaccion');
  const { formatearLocal } = require('../helpers/fechas');
  const enDias = dias => formatearLocal(new Date(Date.now() + dias * 86400000), 'dd/MM/yyyy');
  const dueno = await Usuario.findOne({ usuario: 'dueno.demo' });
  const entradas = [
    ['CRQ-AD-20', 8, 98000, 'CR-2611', '08/2027'],
    ['GRA-GATO', 25000, 5200, 'GG-1', '05/2027'],
    ['VAC-RAB', 2, 15000, 'VR-OLD', '10/2026'],
    ['VAC-RAB', 6, 16000, 'VR-0310', enDias(12)],
    ['ANTB-100', 5, 21000, 'AB-77', '11/2027'],
    ['COLLAR-M', 2, 7000, undefined, undefined]
  ];
  await conTransaccion(async session => {
    for (const [sku, cantidad, costoUnitario, lote, caducidad] of entradas) {
      await inv.registrarEntrada({ sucursal: centro._id, producto: productos[sku]._id, cantidad, costoUnitario, lote, caducidad, origen: 'inventario_inicial', permitirCaducado: true, usuario: dueno._id }, session);
    }
    await inv.registrarEntrada({ sucursal: norte._id, producto: productos['COLLAR-M']._id, cantidad: 10, costoUnitario: 7000, origen: 'inventario_inicial', usuario: dueno._id }, session);
  });

  const Proveedor = require('../models/Proveedor');
  await Proveedor.create([
    { nombre: 'Distribuidora Veterinaria (prueba)', diasCredito: 30, contacto: 'Ventas', telefono: '3110000000' },
    { nombre: 'Alimentos Mascota (prueba)', diasCredito: 0 }
  ]);

  const PORT = process.env.PORT || 5000;
  crearApp().listen(PORT, () => {
    console.log(`API (Mongo en memoria) en http://localhost:${PORT}/api`);
    console.log(`Usuarios: ${usuarios.map(u => u.usuario).join(', ')} · contraseña ${PASSWORD}`);
  });

  const salir = async () => {
    await replSet.stop();
    process.exit(0);
  };
  process.on('SIGINT', salir);
  process.on('SIGTERM', salir);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

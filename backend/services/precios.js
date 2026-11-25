// Listas de precios. Precios FINALES (con IVA) en centavos, por pieza o por kg.
// Cada cambio de precio queda en la bitácora con el precio anterior y el nuevo.
const mongoose = require('mongoose');
const ListaPrecios = require('../models/ListaPrecios');
const Producto = require('../models/Producto');
const { LISTAS, CLAVES_LISTA, LISTA_BASE } = ListaPrecios;
const { conTransaccion } = require('../helpers/transaccion');
const { solicitudInvalida, noEncontrado } = require('../helpers/errores');
const { esCentavos } = require('../helpers/dinero');
const auditoria = require('./auditoria');

const aId = id => new mongoose.Types.ObjectId(String(id));

function exigirClave(clave) {
  if (!CLAVES_LISTA.includes(clave)) throw noEncontrado(`La lista de precios "${clave}" no existe`);
}

function exigirPrecio(precio) {
  if (!esCentavos(precio) || precio < 0) throw solicitudInvalida('El precio debe estar en centavos enteros (≥ 0)');
}

// Las cuatro listas con cuántos productos tienen precio en cada una
async function listar() {
  const conteos = await ListaPrecios.aggregate([{ $project: { clave: 1, total: { $size: '$precios' } } }]);
  const porClave = Object.fromEntries(conteos.map(c => [c.clave, c.total]));
  return LISTAS.map(l => ({ clave: l.clave, nombre: l.nombre, totalPrecios: porClave[l.clave] || 0 }));
}

// Map(productoId → { publico: 12345, mayoreo: 11000, ... }) para varios productos
async function preciosPorProducto(productoIds, session) {
  const ids = productoIds.map(aId);
  if (ids.length === 0) return new Map();
  const filas = await ListaPrecios.aggregate([
    { $match: { 'precios.producto': { $in: ids } } },
    { $unwind: '$precios' },
    { $match: { 'precios.producto': { $in: ids } } },
    { $project: { _id: 0, clave: 1, producto: '$precios.producto', precio: '$precios.precio' } }
  ]).session(session || null);
  const mapa = new Map(ids.map(id => [String(id), {}]));
  for (const f of filas) mapa.get(String(f.producto))[f.clave] = f.precio;
  return mapa;
}

async function preciosDeProducto(productoId, session) {
  return (await preciosPorProducto([productoId], session)).get(String(productoId)) || {};
}

// Precio que se cobra a un cliente de la lista `clave`. Si el producto no tiene precio en esa
// lista se usa el de la lista base (público). Devuelve null si no tiene ninguno.
// El resultado (precio y lista aplicada) se COPIA en cada partida de la venta (Paso 5).
async function resolverPrecio(productoId, clave = LISTA_BASE, session) {
  exigirClave(clave);
  const precios = await preciosDeProducto(productoId, session);
  if (precios[clave] !== undefined) return { precio: precios[clave], lista: clave };
  if (precios[LISTA_BASE] !== undefined) return { precio: precios[LISTA_BASE], lista: LISTA_BASE };
  return null;
}

// Fija (o quita, con precio null) el precio de un producto en una lista. Dentro de una sesión.
async function fijarPrecioEnSesion({ clave, productoId, precio }, actor, session) {
  exigirClave(clave);
  if (precio !== null) exigirPrecio(precio);
  const producto = aId(productoId);
  if (!(await Producto.exists({ _id: producto }).session(session))) throw noEncontrado('Producto no encontrado');

  const nombre = LISTAS.find(l => l.clave === clave).nombre;
  await ListaPrecios.updateOne({ clave }, { $setOnInsert: { nombre, precios: [] } }, { upsert: true, session });

  const actual = await ListaPrecios.findOne({ clave, 'precios.producto': producto }, { 'precios.$': 1 }).session(session).lean();
  const antes = actual ? actual.precios[0].precio : null;
  if (antes === precio) return { cambio: false, antes, despues: precio };

  if (precio === null) {
    await ListaPrecios.updateOne({ clave }, { $pull: { precios: { producto } } }, { session });
  } else if (antes !== null) {
    await ListaPrecios.updateOne({ clave, 'precios.producto': producto }, { $set: { 'precios.$.precio': precio } }, { session });
  } else {
    // $ne evita duplicar el producto si otra petición lo agregó al mismo tiempo
    const r = await ListaPrecios.updateOne(
      { clave, 'precios.producto': { $ne: producto } },
      { $push: { precios: { producto, precio } } },
      { session }
    );
    if (r.modifiedCount === 0) throw solicitudInvalida('El precio cambió al mismo tiempo en otra pantalla. Intenta de nuevo.');
  }

  await auditoria.registrar(
    {
      usuario: actor._id,
      accion: precio === null ? 'precio.quitar' : 'precio.cambiar',
      entidad: 'Producto',
      entidadId: producto,
      antes: { lista: clave, precio: antes },
      despues: { lista: clave, precio }
    },
    session
  );
  return { cambio: true, antes, despues: precio };
}

// { publico: 12345, mayoreo: null, ... } → aplica cada lista indicada (null = quitar)
async function fijarPreciosEnSesion(productoId, precios, actor, session) {
  for (const [clave, precio] of Object.entries(precios || {})) {
    await fijarPrecioEnSesion({ clave, productoId, precio }, actor, session);
  }
}

async function fijarPrecio({ clave, productoId, precio }, actor) {
  return conTransaccion(session => fijarPrecioEnSesion({ clave, productoId, precio }, actor, session));
}

module.exports = {
  listar, preciosPorProducto, preciosDeProducto, resolverPrecio,
  fijarPrecio, fijarPrecioEnSesion, fijarPreciosEnSesion,
  CLAVES_LISTA, LISTA_BASE
};

// Catálogo de productos (global). Búsqueda por nombre (sin acentos), SKU o código de barras.
// Crear y modificar: solo el dueño; cada cambio queda en la bitácora.
const mongoose = require('mongoose');
const Producto = require('../models/Producto');
const Sucursal = require('../models/Sucursal');
const { conTransaccion } = require('../helpers/transaccion');
const { noEncontrado, solicitudInvalida, conflicto } = require('../helpers/errores');
const { normalizar, escaparRegex } = require('../helpers/texto');
const precios = require('./precios');
const auditoria = require('./auditoria');
const { tieneInventario } = require('./inventario');

const CAMPOS_EDITABLES = [
  'sku', 'codigoBarras', 'nombre', 'categoria', 'unidad', 'presentacion',
  'requiereReceta', 'esControlado', 'requiereRefrigeracion', 'iva', 'activo', 'minimos', 'claveSat', 'claveUnidadSat', 'escalas'
];
const LIMITE_MAXIMO = 100;

function publico(p, preciosProducto = {}) {
  return {
    id: p._id,
    sku: p.sku,
    codigoBarras: p.codigoBarras || null,
    nombre: p.nombre,
    categoria: p.categoria,
    unidad: p.unidad,
    presentacion: p.presentacion || '',
    claveSat: p.claveSat || '',
    claveUnidadSat: p.claveUnidadSat || '',
    requiereReceta: p.requiereReceta,
    esControlado: p.esControlado,
    requiereRefrigeracion: p.requiereRefrigeracion,
    iva: p.iva,
    activo: p.activo,
    minimos: (p.minimos || []).map(m => ({ sucursal: m.sucursal, cantidad: m.cantidad, maximo: m.maximo || null })),
    escalas: (p.escalas || []).map(e => ({ desde: e.desde, precio: e.precio })),
    precios: preciosProducto
  };
}

// Para la bitácora: el producto sin precios (cada precio se audita por separado)
const paraBitacora = p => {
  const { precios: _omitido, ...resto } = publico(p);
  return resto;
};

// Filtro de búsqueda: el texto coincide con el código de barras o el SKU exactos, o cada palabra
// aparece en el nombre (sin acentos ni mayúsculas). "croq adul" encuentra "Croquetas Adulto".
function filtroBusqueda({ q, categoria, activo }) {
  const filtro = {};
  if (categoria) filtro.categoria = categoria;
  if (activo !== undefined) filtro.activo = activo;
  const texto = (q || '').trim();
  if (texto) {
    const palabras = normalizar(texto).split(' ').filter(Boolean);
    filtro.$or = [
      { codigoBarras: texto },
      { sku: texto.toUpperCase() },
      { $and: palabras.map(p => ({ nombreBusqueda: { $regex: escaparRegex(p) } })) }
    ];
  }
  return filtro;
}

async function buscar({ q, categoria, activo, pagina = 1, limite = 50 } = {}) {
  const tope = Math.min(Math.max(1, limite), LIMITE_MAXIMO);
  const filtro = filtroBusqueda({ q, categoria, activo });
  const [lista, total] = await Promise.all([
    Producto.find(filtro).sort({ nombre: 1, _id: 1 }).skip((Math.max(1, pagina) - 1) * tope).limit(tope).lean(),
    Producto.countDocuments(filtro)
  ]);
  const mapa = await precios.preciosPorProducto(lista.map(p => p._id));
  return { datos: lista.map(p => publico(p, mapa.get(String(p._id)))), total, pagina: Math.max(1, pagina), limite: tope };
}

async function obtener(id) {
  const p = await Producto.findById(id).lean();
  if (!p) throw noEncontrado('Producto no encontrado');
  return publico(p, await precios.preciosDeProducto(p._id));
}

// Lector de código de barras: coincidencia EXACTA con el código o el SKU
async function porCodigo(codigo) {
  const texto = String(codigo || '').trim();
  const p = await Producto.findOne({ $or: [{ codigoBarras: texto }, { sku: texto.toUpperCase() }] }).lean();
  if (!p) throw noEncontrado(`No hay ningún producto con el código ${texto}`);
  return publico(p, await precios.preciosDeProducto(p._id));
}

async function validarMinimos(minimos, session) {
  if (!minimos || minimos.length === 0) return;
  const ids = [...new Set(minimos.map(m => String(m.sucursal)))].map(id => new mongoose.Types.ObjectId(id));
  const existentes = await Sucursal.countDocuments({ _id: { $in: ids } }).session(session);
  if (existentes !== ids.length) throw solicitudInvalida('Algún mínimo es de una sucursal que no existe');
}

async function crear({ precios: preciosNuevos, ...datos }, actor) {
  return conTransaccion(async session => {
    await validarMinimos(datos.minimos, session);
    const [producto] = await Producto.create([datos], { session });
    await auditoria.registrar(
      { usuario: actor._id, accion: 'producto.crear', entidad: 'Producto', entidadId: producto._id, despues: paraBitacora(producto) },
      session
    );
    await precios.fijarPreciosEnSesion(producto._id, preciosNuevos, actor, session);
    return publico(producto, await precios.preciosDeProducto(producto._id, session));
  });
}

async function actualizar(id, { precios: preciosNuevos, ...cambios }, actor) {
  return conTransaccion(async session => {
    const producto = await Producto.findById(id).session(session);
    if (!producto) throw noEncontrado('Producto no encontrado');
    const antes = paraBitacora(producto);

    // Con inventario registrado, cambiar la unidad haría que piezas se leyeran como gramos (o al revés)
    if (cambios.unidad !== undefined && cambios.unidad !== producto.unidad && (await tieneInventario(producto._id, session))) {
      throw conflicto('No se puede cambiar la unidad: el producto ya tiene inventario registrado', 'UNIDAD_CON_INVENTARIO');
    }
    if (cambios.minimos !== undefined) await validarMinimos(cambios.minimos, session);
    for (const campo of CAMPOS_EDITABLES) {
      if (cambios[campo] !== undefined) producto[campo] = cambios[campo];
    }
    if (producto.isModified()) {
      await producto.save({ session });
      await auditoria.registrar(
        { usuario: actor._id, accion: 'producto.actualizar', entidad: 'Producto', entidadId: producto._id, antes, despues: paraBitacora(producto) },
        session
      );
    }
    await precios.fijarPreciosEnSesion(producto._id, preciosNuevos, actor, session);
    return publico(producto, await precios.preciosDeProducto(producto._id, session));
  });
}

module.exports = { buscar, obtener, porCodigo, crear, actualizar, filtroBusqueda, LIMITE_MAXIMO };

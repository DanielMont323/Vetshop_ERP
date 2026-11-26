// Compras sugeridas de una sucursal.
//
//   venta diaria  = lo vendido (ventas cobradas) en los últimos `dias` / `dias`
//   necesidad     = venta diaria × días de cobertura
//   disponible    = existencia útil (lotes que NO caducan dentro de la cobertura) + en camino
//                   (traspasos en tránsito hacia la sucursal + compras en borrador)
//   Se sugiere cuando disponible < punto de reorden:
//     con máximo definido:  reorden = mínimo (o la necesidad si no hay mínimo); se pide hasta el máximo
//     sin máximo:           reorden = mayor entre mínimo y necesidad; se pide hasta ese nivel
//   Cantidad redondeada hacia arriba: piezas enteras; granel a kilos completos.
// Cada producto lleva su proveedor habitual (el de su última compra recibida) y su último costo, y lo que
// hay en los almacenes (para pedirlo por traspaso antes de comprarlo).
const mongoose = require('mongoose');
const Producto = require('../models/Producto');
const { PUNTOS_BASE_IVA } = Producto;
const Venta = require('../models/Venta');
const InventoryLayer = require('../models/InventoryLayer');
const Traspaso = require('../models/Traspaso');
const Compra = require('../models/Compra');
const Sucursal = require('../models/Sucursal');
const { importePartida, sumar } = require('../helpers/dinero');
const { solicitudInvalida } = require('../helpers/errores');

const DIA_MS = 86400000;
const PERIODOS = [30, 60, 90];

const redondear = (cantidad, unidad) => (unidad === 'kg' ? Math.ceil(cantidad / 1000) * 1000 : Math.ceil(cantidad));

async function vendidoPorProducto(sucursal, desde, hasta) {
  const filas = await Venta.aggregate([
    { $match: { sucursal, estado: 'cobrada', fecha: { $gte: desde, $lt: hasta } } },
    { $unwind: '$partidas' },
    { $group: { _id: '$partidas.producto', cantidad: { $sum: '$partidas.cantidad' } } }
  ]);
  return new Map(filas.map(f => [String(f._id), f.cantidad]));
}

// Existencia útil y por caducar dentro de la cobertura, por producto (de una o varias sucursales)
async function existenciaPorProducto(sucursales, limiteUtil, ahora) {
  const capas = await InventoryLayer.find({ sucursal: { $in: sucursales }, agotada: false, cantidadRestante: { $gt: 0 } })
    .select('producto cantidadRestante caducidad').lean();
  const r = new Map();
  for (const k of capas) {
    const clave = String(k.producto);
    if (!r.has(clave)) r.set(clave, { util: 0, porCaducar: 0 });
    const e = r.get(clave);
    if (!k.caducidad || k.caducidad > limiteUtil) e.util += k.cantidadRestante;
    else if (k.caducidad >= ahora) e.porCaducar += k.cantidadRestante;
  }
  return r;
}

async function enCamino(sucursal) {
  const [traspasos, borradores] = await Promise.all([
    Traspaso.find({ destino: sucursal, estado: 'en_transito' }).select('partidas.producto partidas.cantidad').lean(),
    Compra.find({ sucursal, estado: 'borrador' }).select('partidas.producto partidas.cantidad').lean()
  ]);
  const r = new Map();
  for (const doc of [...traspasos, ...borradores]) {
    for (const p of doc.partidas) r.set(String(p.producto), (r.get(String(p.producto)) || 0) + p.cantidad);
  }
  return r;
}

// Último proveedor y costo de cada producto (compras recibidas de cualquier sucursal)
async function proveedorHabitual() {
  const filas = await Compra.aggregate([
    { $match: { sucursal: { $exists: true }, estado: 'recibida' } },
    { $sort: { fechaRecepcion: -1 } },
    { $unwind: '$partidas' },
    { $group: { _id: '$partidas.producto', proveedor: { $first: '$proveedor' }, proveedorNombre: { $first: '$proveedorNombre' }, costo: { $first: '$partidas.costoUnitario' }, fecha: { $first: '$fechaRecepcion' } } }
  ]);
  return new Map(filas.map(f => [String(f._id), f]));
}

/**
 * @param alcance   sucursal activa obligatoria
 * @param opciones  dias (30|60|90), cobertura (días, 1–120), categoria, todos (incluir los que no necesitan pedido)
 */
async function calcular(alcance, { dias = 30, cobertura = 15, categoria, todos = false } = {}, ahora = new Date()) {
  const sucursal = alcance.sucursalActiva;
  if (!sucursal) throw solicitudInvalida('Elige la sucursal para calcular sus compras sugeridas');
  if (!PERIODOS.includes(dias)) throw solicitudInvalida(`Periodo de ventas: ${PERIODOS.join(', ')} días`);
  if (!Number.isSafeInteger(cobertura) || cobertura < 1 || cobertura > 120) throw solicitudInvalida('Cobertura: de 1 a 120 días');

  const limiteUtil = new Date(ahora.getTime() + cobertura * DIA_MS);
  const [sucursalDoc, almacenes] = await Promise.all([
    Sucursal.findById(sucursal).lean(),
    Sucursal.find({ tipo: 'almacen', activa: true, _id: { $ne: sucursal } }).select('nombre').lean()
  ]);
  const [productos, vendido, existencia, camino, habitual, enAlmacenes] = await Promise.all([
    Producto.find({ activo: true, ...(categoria && { categoria }) }).lean(),
    vendidoPorProducto(sucursal, new Date(ahora.getTime() - dias * DIA_MS), ahora),
    existenciaPorProducto([sucursal], limiteUtil, ahora),
    enCamino(sucursal),
    proveedorHabitual(),
    sucursalDoc?.tipo === 'tienda' && almacenes.length ? existenciaPorProducto(almacenes.map(a => a._id), limiteUtil, ahora) : new Map()
  ]);

  const filas = [];
  for (const p of productos) {
    const id = String(p._id);
    const limites = (p.minimos || []).find(m => String(m.sucursal) === String(sucursal)) || {};
    const minimo = limites.cantidad || 0;
    const maximo = limites.maximo || 0;
    const ventaTotal = vendido.get(id) || 0;
    const ventaDiaria = ventaTotal / dias;
    const necesidad = Math.ceil(ventaDiaria * cobertura);
    const e = existencia.get(id) || { util: 0, porCaducar: 0 };
    const transito = camino.get(id) || 0;
    const disponible = e.util + transito;
    const reorden = maximo ? minimo || necesidad : Math.max(minimo, necesidad);
    const objetivo = maximo || reorden;
    const sugerido = reorden > 0 && disponible < reorden ? redondear(objetivo - disponible, p.unidad) : 0;
    if (!sugerido && !todos) continue;
    const prov = habitual.get(id);
    filas.push({
      producto: { id: p._id, sku: p.sku, nombre: p.nombre, unidad: p.unidad, categoria: p.categoria, presentacion: p.presentacion || '', iva: p.iva, tasaIva: PUNTOS_BASE_IVA[p.iva] },
      vendido: ventaTotal,
      ventaDiaria: Math.round(ventaDiaria * 100) / 100,
      existencia: e.util,
      porCaducar: e.porCaducar,
      enCamino: transito,
      minimo, maximo, necesidad, objetivo, sugerido,
      proveedor: prov ? { id: prov.proveedor, nombre: prov.proveedorNombre } : null,
      ultimoCosto: prov?.costo ?? null,
      costoEstimado: prov && sugerido ? importePartida({ precioUnitario: prov.costo, cantidad: sugerido, unidad: p.unidad }) : 0,
      enAlmacen: (enAlmacenes.get(id) || { util: 0 }).util
    });
  }
  filas.sort((a, b) => (a.proveedor?.nombre || '~').localeCompare(b.proveedor?.nombre || '~', 'es') || a.producto.nombre.localeCompare(b.producto.nombre, 'es'));

  return {
    sucursal: { id: sucursal, nombre: sucursalDoc?.nombre || '', tipo: sucursalDoc?.tipo },
    parametros: { dias, cobertura, categoria: categoria || null },
    almacenes: almacenes.map(a => a.nombre),
    datos: filas,
    totales: {
      productos: filas.filter(f => f.sugerido).length,
      costoEstimado: sumar(filas.map(f => f.costoEstimado)),
      conAlmacen: filas.filter(f => f.sugerido && f.enAlmacen > 0).length
    }
  };
}

module.exports = { calcular, PERIODOS, redondear };

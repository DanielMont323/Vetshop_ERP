// Importación inicial desde Excel: productos, precios, existencias (inventario inicial con lote y
// caducidad) y clientes. Dos fases:
//   validar(filas)  → { errores, avisos, resumen, plan }   (no escribe nada)
//   aplicar(plan)   → escribe en transacciones (productos+precios, existencias por sucursal, clientes)
// Las filas llegan como objetos { fila, ...columnas } (ver helpers/excelImportacion.js).
const mongoose = require('mongoose');
const Producto = require('../models/Producto');
const { CATEGORIAS, RE_SKU, RE_CODIGO_BARRAS } = Producto;
const Sucursal = require('../models/Sucursal');
const Cliente = require('../models/Cliente');
const InventoryMovement = require('../models/InventoryMovement');
const { RE_RFC } = require('../models/Proveedor');
const { CLAVES_LISTA } = require('../models/ListaPrecios');
const { conTransaccion } = require('../helpers/transaccion');
const { aCentavos } = require('../helpers/dinero');
const { parsearCaducidad, estaCaducado, formatearLocal } = require('../helpers/fechas');
const { normalizar } = require('../helpers/texto');
const inventario = require('./inventario');
const precios = require('./precios');
const auditoria = require('./auditoria');

const TIPOS_CLIENTE = Cliente.TIPOS;
const EXIGEN_LOTE = inventario.EXIGEN_LOTE;
const EXIGEN_CADUCIDAD = inventario.EXIGEN_CADUCIDAD;

// ---- Lectura de valores de celda ----
const texto = v => (v === null || v === undefined ? '' : String(v).trim());
const clave = v => normalizar(texto(v)).replace(/\s+/g, '_');

function siNo(v, defecto = false) {
  const t = clave(v);
  if (t === '') return defecto;
  if (['si', 's', 'x', '1', 'true', 'verdadero'].includes(t)) return true;
  if (['no', 'n', '0', 'false', 'falso'].includes(t)) return false;
  throw new Error(`"${texto(v)}" no es sí o no`);
}

function pesos(v) {
  if (texto(v) === '') return null;
  const c = aCentavos(typeof v === 'number' ? v : texto(v));
  if (c < 0) throw new Error('no puede ser negativo');
  return c;
}

// Cantidad en unidad base: piezas enteras, o kg con hasta 3 decimales → gramos
function cantidadBase(v, unidad) {
  const t = typeof v === 'number' ? v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') : texto(v).replace(',', '.');
  if (unidad === 'kg') {
    const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(t);
    if (!m) throw new Error(`cantidad inválida para kg: "${texto(v)}" (hasta 3 decimales)`);
    return Number(m[1]) * 1000 + Number((m[2] || '').padEnd(3, '0'));
  }
  if (!/^\d+$/.test(t)) throw new Error(`cantidad inválida: "${texto(v)}" (piezas enteras)`);
  return Number(t);
}

// Caducidad: celda de fecha de Excel (medianoche UTC de ese día) o texto MM/AAAA, DD/MM/AAAA, AAAA-MM-DD
function caducidad(v) {
  if (v instanceof Date) {
    const ymd = `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
    return parsearCaducidad(ymd);
  }
  return texto(v) === '' ? null : parsearCaducidad(texto(v));
}

function iva(v) {
  const t = clave(v).replace('%', '');
  if (['16', '0.16', 'tasa_16'].includes(t)) return 'tasa_16';
  if (['0', 'tasa_0', '0.0'].includes(t)) return 'tasa_0';
  if (['exento', 'ex'].includes(t)) return 'exento';
  throw new Error(`IVA inválido: "${texto(v)}" (16, 0 o exento)`);
}

function unidad(v) {
  const t = clave(v);
  if (['pieza', 'pza', 'pz', 'piezas', ''].includes(t)) return 'pieza';
  if (['kg', 'kilo', 'kilos', 'granel'].includes(t)) return 'kg';
  throw new Error(`unidad inválida: "${texto(v)}" (pieza o kg)`);
}

function deLista(v, validos, nombre) {
  const t = clave(v);
  if (!validos.includes(t)) throw new Error(`Valor no válido en ${nombre}: "${texto(v)}" (${validos.join(', ')})`);
  return t;
}

// ---- Validación ----

/**
 * @param {object} libro { productos: [], precios: [], existencias: [], clientes: [] } filas con `fila`
 */
async function validar(libro) {
  const errores = [];
  const avisos = [];
  const error = (hoja, fila, mensaje) => errores.push({ hoja, fila, mensaje });
  const intentar = (hoja, fila, fn) => {
    try {
      return fn();
    } catch (e) {
      error(hoja, fila, e.message);
      return undefined;
    }
  };

  // Productos
  const enBD = new Map((await Producto.find({}).lean()).map(p => [p.sku, p]));
  const porCodigoBD = new Map([...enBD.values()].filter(p => p.codigoBarras).map(p => [p.codigoBarras, p.sku]));
  const productos = new Map(); // sku → datos
  const codigosHoja = new Map();
  for (const f of libro.productos || []) {
    const sku = texto(f.sku).toUpperCase();
    if (!RE_SKU.test(sku)) { error('Productos', f.fila, `SKU inválido: "${texto(f.sku)}"`); continue; }
    if (productos.has(sku)) { error('Productos', f.fila, `SKU repetido: ${sku}`); continue; }
    const p = { sku, fila: f.fila };
    p.nombre = texto(f.nombre);
    if (!p.nombre || p.nombre.length > 120) error('Productos', f.fila, 'Falta el nombre (máx. 120)');
    p.codigoBarras = texto(f.codigoBarras) || undefined;
    if (p.codigoBarras) {
      if (!RE_CODIGO_BARRAS.test(p.codigoBarras)) error('Productos', f.fila, `Código de barras inválido: ${p.codigoBarras}`);
      else if (codigosHoja.has(p.codigoBarras)) error('Productos', f.fila, `Código de barras repetido (también en la fila ${codigosHoja.get(p.codigoBarras)})`);
      else if (porCodigoBD.has(p.codigoBarras) && porCodigoBD.get(p.codigoBarras) !== sku) error('Productos', f.fila, `El código ${p.codigoBarras} ya es del producto ${porCodigoBD.get(p.codigoBarras)}`);
      codigosHoja.set(p.codigoBarras, f.fila);
    }
    p.categoria = intentar('Productos', f.fila, () => deLista(f.categoria, CATEGORIAS, 'Categoría'));
    p.unidad = intentar('Productos', f.fila, () => unidad(f.unidad));
    p.iva = intentar('Productos', f.fila, () => iva(f.iva));
    p.presentacion = texto(f.presentacion).slice(0, 80) || undefined;
    p.esControlado = intentar('Productos', f.fila, () => siNo(f.controlado));
    p.requiereReceta = Boolean(intentar('Productos', f.fila, () => siNo(f.requiereReceta)) || p.esControlado);
    p.requiereRefrigeracion = intentar('Productos', f.fila, () => siNo(f.refrigeracion));
    p.activo = intentar('Productos', f.fila, () => siNo(f.activo, true));
    const previo = enBD.get(sku);
    p.existe = Boolean(previo);
    if (previo && p.unidad && previo.unidad !== p.unidad) avisos.push({ hoja: 'Productos', fila: f.fila, mensaje: `${sku}: cambia la unidad de ${previo.unidad} a ${p.unidad} (se rechazará si ya tiene inventario)` });
    productos.set(sku, p);
  }
  const productoDe = sku => productos.get(sku) || enBD.get(sku);

  // Precios
  const preciosPlan = [];
  for (const f of libro.precios || []) {
    const sku = texto(f.sku).toUpperCase();
    if (!productoDe(sku)) { error('Precios', f.fila, `El SKU ${sku || '(vacío)'} no está en Productos ni en el catálogo`); continue; }
    const fila = { sku, fila: f.fila, precios: {} };
    for (const lista of CLAVES_LISTA) {
      const c = intentar('Precios', f.fila, () => {
        try {
          return pesos(f[lista]);
        } catch (e) {
          throw new Error(`Precio ${lista}: ${e.message}`);
        }
      });
      if (c !== null && c !== undefined) fila.precios[lista] = c;
    }
    if (Object.keys(fila.precios).length === 0) avisos.push({ hoja: 'Precios', fila: f.fila, mensaje: `${sku}: sin ningún precio` });
    preciosPlan.push(fila);
  }

  // Existencias
  const sucursales = await Sucursal.find({}).lean();
  const sucursalPorNombre = new Map(sucursales.map(s => [normalizar(s.nombre), s]));
  const conInventario = new Set();
  for (const s of sucursales) {
    if (await InventoryMovement.exists({ sucursal: s._id })) conInventario.add(String(s._id));
  }
  const existenciasPlan = [];
  const ahora = new Date();
  for (const f of libro.existencias || []) {
    const s = sucursalPorNombre.get(normalizar(texto(f.sucursal)));
    if (!s) { error('Existencias', f.fila, `Sucursal desconocida: "${texto(f.sucursal)}" (créala antes en el sistema)`); continue; }
    if (conInventario.has(String(s._id))) { error('Existencias', f.fila, `${s.nombre} ya tiene inventario: el inventario inicial solo se carga una vez`); continue; }
    const sku = texto(f.sku).toUpperCase();
    const p = productoDe(sku);
    if (!p) { error('Existencias', f.fila, `El SKU ${sku || '(vacío)'} no está en Productos ni en el catálogo`); continue; }
    const fila = { fila: f.fila, sucursal: s._id, sucursalNombre: s.nombre, sku, lote: texto(f.lote) || undefined };
    fila.cantidad = intentar('Existencias', f.fila, () => cantidadBase(f.cantidad, p.unidad));
    if (fila.cantidad === 0) error('Existencias', f.fila, 'La cantidad debe ser mayor que cero');
    fila.costoUnitario = intentar('Existencias', f.fila, () => {
      const c = pesos(f.costoUnitario);
      if (c === null) throw new Error('Falta el costo unitario (sin IVA, por pieza o por kg)');
      return c;
    });
    fila.caducidad = intentar('Existencias', f.fila, () => caducidad(f.caducidad));
    if (EXIGEN_LOTE.has(p.categoria) && !fila.lote) error('Existencias', f.fila, `${sku}: indica el lote (${p.categoria})`);
    if (EXIGEN_CADUCIDAD.has(p.categoria) && !fila.caducidad && fila.caducidad !== undefined) error('Existencias', f.fila, `${sku}: indica la caducidad (${p.categoria})`);
    if (fila.caducidad && estaCaducado(fila.caducidad, ahora)) {
      avisos.push({ hoja: 'Existencias', fila: f.fila, mensaje: `${sku} lote ${fila.lote || 's/l'} caducó el ${formatearLocal(fila.caducidad, 'dd/MM/yyyy')}: entra para darlo de baja` });
    }
    existenciasPlan.push(fila);
  }

  // Clientes
  const clientesPlan = [];
  const nombresClientes = new Set();
  for (const f of libro.clientes || []) {
    const c = { fila: f.fila, nombre: texto(f.nombre) };
    if (!c.nombre) { error('Clientes', f.fila, 'Falta el nombre'); continue; }
    if (nombresClientes.has(normalizar(c.nombre))) { error('Clientes', f.fila, `Cliente repetido: ${c.nombre}`); continue; }
    nombresClientes.add(normalizar(c.nombre));
    c.tipo = intentar('Clientes', f.fila, () => deLista(f.tipo || 'publico', TIPOS_CLIENTE, 'Tipo'));
    c.listaPrecios = intentar('Clientes', f.fila, () => deLista(f.listaPrecios || 'publico', CLAVES_LISTA, 'Lista de precios'));
    c.rfc = texto(f.rfc).toUpperCase() || undefined;
    if (c.rfc && !RE_RFC.test(c.rfc)) error('Clientes', f.fila, `RFC inválido: ${c.rfc}`);
    c.telefono = texto(f.telefono).slice(0, 20) || undefined;
    c.email = texto(f.correo).toLowerCase() || undefined;
    if (texto(f.saldo) && Number(texto(f.saldo).replace(/[$,]/g, '')) !== 0) {
      avisos.push({ hoja: 'Clientes', fila: f.fila, mensaje: `${c.nombre}: el saldo no se importa (crédito y cobranza llegan en la Fase 2)` });
    }
    clientesPlan.push(c);
  }

  const lista = [...productos.values()];
  return {
    errores,
    avisos,
    resumen: {
      productosNuevos: lista.filter(p => !p.existe).length,
      productosActualizados: lista.filter(p => p.existe).length,
      precios: preciosPlan.reduce((s, p) => s + Object.keys(p.precios).length, 0),
      lotes: existenciasPlan.length,
      sucursalesConInventario: [...new Set(existenciasPlan.map(e => e.sucursalNombre))],
      clientes: clientesPlan.length
    },
    plan: { productos: lista, precios: preciosPlan, existencias: existenciasPlan, clientes: clientesPlan }
  };
}

// ---- Carga ----

const CAMPOS_PRODUCTO = ['codigoBarras', 'nombre', 'categoria', 'unidad', 'presentacion', 'requiereReceta', 'esControlado', 'requiereRefrigeracion', 'iva', 'activo'];

async function aplicar(resultado, actor) {
  if (resultado.errores.length) throw new Error(`Hay ${resultado.errores.length} errores: corrígelos antes de importar`);
  const { plan } = resultado;
  const hecho = { productos: 0, precios: 0, lotes: 0, clientes: 0 };

  // 1. Productos y precios (una transacción)
  await conTransaccion(async session => {
    const idPorSku = new Map();
    for (const p of plan.productos) {
      let doc = await Producto.findOne({ sku: p.sku }).session(session);
      if (doc && doc.unidad !== p.unidad && (await inventario.tieneInventario(doc._id, session))) {
        throw new Error(`Fila ${p.fila}: ${p.sku} ya tiene inventario; no se puede cambiar su unidad`);
      }
      if (!doc) doc = new Producto({ sku: p.sku });
      for (const c of CAMPOS_PRODUCTO) doc[c] = p[c];
      await doc.save({ session });
      idPorSku.set(p.sku, doc._id);
      hecho.productos += 1;
    }
    for (const fila of plan.precios) {
      const id = idPorSku.get(fila.sku) || (await Producto.findOne({ sku: fila.sku }).session(session).lean())._id;
      await precios.fijarPreciosEnSesion(id, fila.precios, actor, session);
      hecho.precios += Object.keys(fila.precios).length;
    }
    await auditoria.registrar({ usuario: actor._id, accion: 'importacion.catalogo', entidad: 'Producto', despues: { productos: hecho.productos, precios: hecho.precios } }, session);
  });

  // 2. Inventario inicial: una transacción por sucursal
  const porSucursal = new Map();
  for (const e of plan.existencias) {
    const k = String(e.sucursal);
    if (!porSucursal.has(k)) porSucursal.set(k, []);
    porSucursal.get(k).push(e);
  }
  for (const [sucursalId, filas] of porSucursal) {
    await conTransaccion(async session => {
      if (await InventoryMovement.exists({ sucursal: new mongoose.Types.ObjectId(sucursalId) }).session(session)) {
        throw new Error(`${filas[0].sucursalNombre} ya tiene inventario: el inventario inicial solo se carga una vez`);
      }
      for (const e of filas) {
        const producto = await Producto.findOne({ sku: e.sku }).session(session).lean();
        await inventario.registrarEntrada(
          {
            sucursal: e.sucursal, producto: producto._id, cantidad: e.cantidad, costoUnitario: e.costoUnitario, lote: e.lote,
            caducidad: e.caducidad, origen: 'inventario_inicial', permitirCaducado: true, usuario: actor._id,
            referencia: { modelo: 'Importacion' }, nota: `Inventario inicial (fila ${e.fila})`
          },
          session
        );
      }
      await auditoria.registrar(
        { usuario: actor._id, accion: 'importacion.inventario_inicial', entidad: 'InventoryLayer', sucursal: filas[0].sucursal, despues: { lotes: filas.length } },
        session
      );
    });
    hecho.lotes += filas.length;
  }

  // 3. Clientes (se actualizan por RFC o, si no tiene, por nombre)
  await conTransaccion(async session => {
    for (const c of plan.clientes) {
      const filtro = c.rfc ? { rfc: c.rfc } : { nombre: c.nombre };
      let doc = await Cliente.findOne(filtro).collation({ locale: 'es', strength: 1 }).session(session);
      if (!doc) doc = new Cliente({});
      for (const k of ['nombre', 'tipo', 'listaPrecios', 'rfc', 'telefono', 'email']) doc[k] = c[k];
      await doc.save({ session });
      hecho.clientes += 1;
    }
    if (plan.clientes.length) {
      await auditoria.registrar({ usuario: actor._id, accion: 'importacion.clientes', entidad: 'Cliente', despues: { clientes: plan.clientes.length } }, session);
    }
  });

  return hecho;
}

module.exports = { validar, aplicar };

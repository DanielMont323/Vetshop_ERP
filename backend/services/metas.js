// Metas de venta: definición (dueño) y avance del mes por sucursal y por vendedor.
//
// Una venta cuenta para su VENDEDOR (Venta.vendedor; si no se eligió, el cajero que cobró). Solo ventas cobradas,
// por su total con IVA. Proyección al cierre = vendido / días transcurridos × días del mes (solo el mes en curso).
const mongoose = require('mongoose');
const Meta = require('../models/Meta');
const Venta = require('../models/Venta');
const Sucursal = require('../models/Sucursal');
const Usuario = require('../models/Usuario');
const { conAlcance, matchAlcance, sucursalDeEscritura } = require('../helpers/alcance');
const { rangoDias, diaLocal } = require('../helpers/fechas');
const { conTransaccion } = require('../helpers/transaccion');
const { solicitudInvalida, noEncontrado } = require('../helpers/errores');
const auditoria = require('./auditoria');

const aId = id => new mongoose.Types.ObjectId(String(id));

function datosMes(periodo, ahora = new Date()) {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo || '');
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw solicitudInvalida('Periodo: AAAA-MM');
  const diasMes = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  const rango = rangoDias(`${periodo}-01`, `${periodo}-${String(diasMes).padStart(2, '0')}`);
  const hoy = diaLocal(ahora);
  let transcurridos;
  if (hoy < `${periodo}-01`) transcurridos = 0;
  else if (hoy.slice(0, 7) > periodo) transcurridos = diasMes;
  else transcurridos = Number(hoy.slice(8, 10));
  return { rango, diasMes, transcurridos, enCurso: hoy.slice(0, 7) === periodo };
}

const porcentaje = (vendido, meta) => (meta ? Math.round((vendido * 1000) / meta) / 10 : null); // 1 decimal
const proyectar = (vendido, mes) => (mes.enCurso && mes.transcurridos ? Math.round((vendido / mes.transcurridos) * mes.diasMes) : null);

/** Avance del periodo para las sucursales del alcance: metas, vendido, tickets, porcentaje, proyección y ranking. */
async function avance(alcance, { periodo = diaLocal().slice(0, 7) } = {}, ahora = new Date()) {
  const mes = datosMes(periodo, ahora);
  const [metas, ventas] = await Promise.all([
    Meta.find(conAlcance({ periodo }, alcance)).lean(),
    Venta.aggregate([
      matchAlcance(alcance, { estado: 'cobrada', fecha: { $gte: mes.rango.inicio, $lt: mes.rango.fin } }),
      {
        $group: {
          _id: { sucursal: '$sucursal', vendedor: { $ifNull: ['$vendedor', '$cajero'] } },
          nombre: { $last: { $ifNull: ['$vendedorNombre', '$cajeroNombre'] } },
          vendido: { $sum: '$total' },
          tickets: { $sum: 1 }
        }
      }
    ])
  ]);
  const idsSucursal = [...new Set([...metas.map(m => String(m.sucursal)), ...ventas.map(v => String(v._id.sucursal))])];
  if (alcance.sucursalActiva && !idsSucursal.includes(String(alcance.sucursalActiva))) idsSucursal.push(String(alcance.sucursalActiva));
  const sucursales = await Sucursal.find({ _id: { $in: idsSucursal.map(aId) } }).select('nombre').sort({ nombre: 1 }).lean();
  const idsVendedor = [...new Set([...metas.filter(m => m.vendedor).map(m => String(m.vendedor)), ...ventas.map(v => String(v._id.vendedor))])];
  const nombres = new Map((await Usuario.find({ _id: { $in: idsVendedor.map(aId) } }).select('nombre').lean()).map(u => [String(u._id), u.nombre]));

  const filas = sucursales.map(s => {
    const id = String(s._id);
    const metaSuc = metas.find(m => String(m.sucursal) === id && !m.vendedor);
    const ventasSuc = ventas.filter(v => String(v._id.sucursal) === id);
    const vendido = ventasSuc.reduce((t, v) => t + v.vendido, 0);
    const tickets = ventasSuc.reduce((t, v) => t + v.tickets, 0);
    const vendedores = new Map();
    for (const m of metas.filter(x => String(x.sucursal) === id && x.vendedor)) {
      vendedores.set(String(m.vendedor), { vendedor: { id: m.vendedor, nombre: nombres.get(String(m.vendedor)) || '' }, metaId: m._id, meta: m.monto, metaTickets: m.tickets ?? null, vendido: 0, tickets: 0 });
    }
    for (const v of ventasSuc) {
      const clave = String(v._id.vendedor);
      if (!vendedores.has(clave)) vendedores.set(clave, { vendedor: { id: v._id.vendedor, nombre: nombres.get(clave) || v.nombre }, metaId: null, meta: null, metaTickets: null, vendido: 0, tickets: 0 });
      Object.assign(vendedores.get(clave), { vendido: v.vendido, tickets: v.tickets });
    }
    return {
      sucursal: { id: s._id, nombre: s.nombre },
      metaId: metaSuc?._id || null,
      meta: metaSuc?.monto ?? null,
      metaTickets: metaSuc?.tickets ?? null,
      vendido, tickets,
      porcentaje: porcentaje(vendido, metaSuc?.monto),
      proyeccion: proyectar(vendido, mes),
      vendedores: [...vendedores.values()]
        .map(x => ({ ...x, porcentaje: porcentaje(x.vendido, x.meta), proyeccion: proyectar(x.vendido, mes) }))
        .sort((a, b) => b.vendido - a.vendido || a.vendedor.nombre.localeCompare(b.vendedor.nombre, 'es'))
    };
  });
  return { periodo, diasMes: mes.diasMes, diasTranscurridos: mes.transcurridos, enCurso: mes.enCurso, sucursales: filas };
}

/** Definir (o cambiar) la meta del periodo en la sucursal de escritura; vendedor opcional. monto 0 = quitarla. */
async function fijar(alcance, actor, { periodo, vendedor, monto, tickets }) {
  const sucursal = sucursalDeEscritura(alcance);
  datosMes(periodo);
  if (vendedor) {
    const u = await Usuario.findById(aId(vendedor)).lean();
    if (!u || !u.activo) throw noEncontrado('Vendedor no encontrado');
    if (u.rol !== 'dueno' && !u.sucursales.some(x => x.equals(sucursal))) throw solicitudInvalida(`${u.nombre} no trabaja en esta sucursal`);
  }
  const filtro = { sucursal, periodo, vendedor: vendedor ? aId(vendedor) : null };
  return conTransaccion(async session => {
    const antes = await Meta.findOne(filtro).session(session).lean();
    let despues = null;
    if (monto) {
      despues = await Meta.findOneAndUpdate(filtro, { $set: { monto, tickets: tickets ?? null, usuario: actor._id } }, { new: true, upsert: true, runValidators: true, session }).lean();
    } else if (antes) {
      await Meta.deleteOne({ _id: antes._id, sucursal }, { session });
    }
    await auditoria.registrar(
      {
        usuario: actor._id, accion: 'meta.fijar', entidad: 'Meta', entidadId: despues?._id || antes?._id, sucursal,
        antes: antes ? { monto: antes.monto, tickets: antes.tickets } : null, despues: despues ? { periodo, vendedor: vendedor || null, monto, tickets } : null
      },
      session
    );
    return despues ? { id: despues._id, periodo, vendedor: despues.vendedor, monto: despues.monto, tickets: despues.tickets ?? null } : null;
  });
}

/** El avance propio del usuario en la sucursal activa (para la pantalla de inicio de la caja). */
async function miAvance(alcance, actor, ahora = new Date()) {
  const sucursal = alcance.sucursalActiva;
  if (!sucursal) return null;
  const periodo = diaLocal(ahora).slice(0, 7);
  const mes = datosMes(periodo, ahora);
  const [meta, ventas] = await Promise.all([
    Meta.findOne({ sucursal, periodo, vendedor: actor._id }).lean(),
    Venta.aggregate([
      { $match: { sucursal, estado: 'cobrada', fecha: { $gte: mes.rango.inicio, $lt: mes.rango.fin } } },
      { $match: { $expr: { $eq: [{ $ifNull: ['$vendedor', '$cajero'] }, actor._id] } } },
      { $group: { _id: null, vendido: { $sum: '$total' }, tickets: { $sum: 1 } } }
    ])
  ]);
  const vendido = ventas[0]?.vendido || 0;
  return { periodo, meta: meta?.monto ?? null, vendido, tickets: ventas[0]?.tickets || 0, porcentaje: porcentaje(vendido, meta?.monto), proyeccion: proyectar(vendido, mes) };
}

/** Quiénes pueden figurar como vendedor en la sucursal activa (para elegirlo en la caja o fijar metas). */
async function vendedores(alcance) {
  const sucursal = sucursalDeEscritura(alcance);
  const lista = await Usuario.find({ activo: true, $or: [{ sucursales: sucursal }, { rol: 'dueno' }] }).select('nombre rol').sort({ nombre: 1 }).lean();
  return lista.map(u => ({ id: u._id, nombre: u.nombre, rol: u.rol }));
}

/** Para el cobro: valida el vendedor elegido (activo y de la sucursal). */
async function validarVendedor(sucursal, vendedorId, session) {
  const u = await Usuario.findById(aId(vendedorId)).session(session || null).lean();
  if (!u || !u.activo) throw solicitudInvalida('Vendedor no encontrado');
  if (u.rol !== 'dueno' && !u.sucursales.some(x => x.equals(sucursal))) throw solicitudInvalida(`${u.nombre} no trabaja en esta sucursal`);
  return u;
}

module.exports = { avance, fijar, miAvance, vendedores, validarVendedor, datosMes };

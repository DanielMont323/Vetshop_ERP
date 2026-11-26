// Cadena de frío: equipos (refrigeradores/congeladores) por sucursal, lecturas de temperatura con acción
// correctiva cuando salen de rango, bitácora mensual por equipo y alertas del tablero.
const mongoose = require('mongoose');
const EquipoFrio = require('../models/EquipoFrio');
const LecturaTemperatura = require('../models/LecturaTemperatura');
const Compra = require('../models/Compra');
const Sucursal = require('../models/Sucursal');
const { conTransaccion } = require('../helpers/transaccion');
const { conAlcance, sucursalDeEscritura } = require('../helpers/alcance');
const { rangoDia, rangoDias, diaLocal } = require('../helpers/fechas');
const { solicitudInvalida, noEncontrado, conflicto, ErrorApp } = require('../helpers/errores');
const auditoria = require('./auditoria');

const aId = id => new mongoose.Types.ObjectId(String(id));
const filtroEscritura = (alcance, filtro) => conAlcance(filtro, { ...alcance, sucursalActiva: sucursalDeEscritura(alcance) });
const CAMPOS_EQUIPO = ['nombre', 'tipo', 'minimo', 'maximo', 'lecturasPorDia', 'activo'];

const publicoEquipo = e => ({
  id: e._id, sucursal: e.sucursal, nombre: e.nombre, tipo: e.tipo, minimo: e.minimo, maximo: e.maximo, lecturasPorDia: e.lecturasPorDia, activo: e.activo
});
const publicaLectura = l => ({
  id: l._id, sucursal: l.sucursal, equipo: { id: l.equipo, nombre: l.equipoNombre }, fecha: l.fecha, temperatura: l.temperatura, rango: l.rango,
  fueraDeRango: l.fueraDeRango, observacion: l.observacion || '', accionCorrectiva: l.accionCorrectiva || '', productosAfectados: l.productosAfectados || '',
  usuario: { id: l.usuario, nombre: l.usuarioNombre }
});

function duplicado(error) {
  if (error.code === 11000) throw conflicto('Ya hay un equipo con ese nombre en la sucursal', 'EQUIPO_DUPLICADO');
  if (error.name === 'ValidationError') throw solicitudInvalida(Object.values(error.errors)[0].message);
  throw error;
}

// ---------- Equipos ----------

/** Equipos de la sucursal (o del alcance) con su estado de hoy: lecturas, la última y si alguna salió de rango. */
async function listarEquipos(alcance, { incluirInactivos = false } = {}, ahora = new Date()) {
  const equipos = await EquipoFrio.find(conAlcance(incluirInactivos ? {} : { activo: true }, alcance)).sort({ nombre: 1 }).lean();
  const hoy = rangoDia(ahora);
  const lecturas = await LecturaTemperatura.find(conAlcance({ equipo: { $in: equipos.map(e => e._id) }, fecha: { $gte: hoy.inicio, $lt: hoy.fin } }, alcance))
    .sort({ fecha: -1 }).lean();
  const nombres = new Map((await Sucursal.find({ _id: { $in: [...new Set(equipos.map(e => String(e.sucursal)))].map(aId) } }).lean()).map(s => [String(s._id), s.nombre]));
  return equipos.map(e => {
    const propias = lecturas.filter(l => l.equipo.equals(e._id));
    return {
      ...publicoEquipo(e),
      sucursalNombre: nombres.get(String(e.sucursal)) || '',
      hoy: { lecturas: propias.length, pendientes: Math.max(0, e.lecturasPorDia - propias.length), fueraDeRango: propias.filter(l => l.fueraDeRango).length, ultima: propias[0] ? publicaLectura(propias[0]) : null }
    };
  });
}

async function crearEquipo(alcance, actor, datos) {
  const sucursal = sucursalDeEscritura(alcance);
  try {
    return await conTransaccion(async session => {
      const [e] = await EquipoFrio.create([{ ...Object.fromEntries(CAMPOS_EQUIPO.filter(k => datos[k] !== undefined).map(k => [k, datos[k]])), sucursal }], { session });
      await auditoria.registrar({ usuario: actor._id, accion: 'cadena_frio.equipo_crear', entidad: 'EquipoFrio', entidadId: e._id, sucursal, despues: publicoEquipo(e) }, session);
      return publicoEquipo(e);
    });
  } catch (error) {
    return duplicado(error);
  }
}

async function actualizarEquipo(alcance, actor, id, cambios) {
  const sucursal = sucursalDeEscritura(alcance);
  try {
    return await conTransaccion(async session => {
      const e = await EquipoFrio.findOne(filtroEscritura(alcance, { _id: aId(id) })).session(session);
      if (!e) throw noEncontrado('Equipo no encontrado');
      const antes = publicoEquipo(e);
      for (const k of CAMPOS_EQUIPO) if (cambios[k] !== undefined) e[k] = cambios[k];
      if (e.isModified()) {
        await e.save({ session });
        await auditoria.registrar({ usuario: actor._id, accion: 'cadena_frio.equipo_actualizar', entidad: 'EquipoFrio', entidadId: e._id, sucursal, antes, despues: publicoEquipo(e) }, session);
      }
      return publicoEquipo(e);
    });
  } catch (error) {
    return duplicado(error);
  }
}

// ---------- Lecturas ----------

async function registrarLectura(alcance, actor, datos) {
  const sucursal = sucursalDeEscritura(alcance);
  const equipo = await EquipoFrio.findOne(filtroEscritura(alcance, { _id: aId(datos.equipo) })).lean();
  if (!equipo) throw noEncontrado('Equipo no encontrado en esta sucursal');
  if (!equipo.activo) throw conflicto(`${equipo.nombre} está desactivado`, 'EQUIPO_INACTIVO');
  const t = datos.temperatura;
  if (typeof t !== 'number' || Math.round(t * 10) !== t * 10 || t < -40 || t > 60) throw solicitudInvalida('Temperatura en °C, de −40 a 60, con máximo un decimal');
  const fueraDeRango = t < equipo.minimo || t > equipo.maximo;
  const accion = (datos.accionCorrectiva || '').trim();
  if (fueraDeRango && accion.length < 5) {
    throw new ErrorApp(400, `${t} °C está fuera del rango de ${equipo.nombre} (${equipo.minimo} a ${equipo.maximo} °C): describe la acción correctiva`, 'ACCION_CORRECTIVA_REQUERIDA', { minimo: equipo.minimo, maximo: equipo.maximo });
  }
  return conTransaccion(async session => {
    const [l] = await LecturaTemperatura.create(
      [{
        sucursal, equipo: equipo._id, equipoNombre: equipo.nombre, fecha: new Date(), temperatura: t, rango: { minimo: equipo.minimo, maximo: equipo.maximo },
        fueraDeRango, observacion: datos.observacion, accionCorrectiva: accion || undefined, productosAfectados: datos.productosAfectados,
        usuario: actor._id, usuarioNombre: actor.nombre
      }],
      { session }
    );
    if (fueraDeRango) {
      await auditoria.registrar(
        {
          usuario: actor._id, accion: 'cadena_frio.fuera_de_rango', entidad: 'LecturaTemperatura', entidadId: l._id, sucursal,
          despues: { equipo: equipo.nombre, temperatura: t, accionCorrectiva: accion, productosAfectados: datos.productosAfectados }
        },
        session
      );
    }
    return publicaLectura(l.toObject());
  });
}

async function listarLecturas(alcance, { equipo, desde, hasta, fueraDeRango } = {}, ahora = new Date()) {
  const filtro = {};
  if (equipo) filtro.equipo = aId(equipo);
  if (fueraDeRango !== undefined) filtro.fueraDeRango = fueraDeRango;
  const r = rangoDias(desde || diaLocal(new Date(ahora.getTime() - 6 * 86400000)), hasta || diaLocal(ahora));
  filtro.fecha = { $gte: r.inicio, $lt: r.fin };
  const lista = await LecturaTemperatura.find(conAlcance(filtro, alcance)).sort({ fecha: -1 }).limit(1000).lean();
  return lista.map(publicaLectura);
}

// ---------- Bitácora mensual ----------

function rangoMes(mes) {
  const m = /^(\d{4})-(\d{2})$/.exec(mes || '');
  if (!m) throw solicitudInvalida('Mes: AAAA-MM');
  const [anio, numero] = [Number(m[1]), Number(m[2])];
  if (numero < 1 || numero > 12) throw solicitudInvalida('Mes inválido');
  const ultimo = new Date(Date.UTC(anio, numero, 0)).getUTCDate();
  return rangoDias(`${mes}-01`, `${mes}-${String(ultimo).padStart(2, '0')}`);
}

/** Lecturas del mes de un equipo y las recepciones con temperatura de llegada de su sucursal. */
async function bitacora(alcance, { equipo: equipoId, mes }) {
  const equipo = await EquipoFrio.findOne(conAlcance({ _id: aId(equipoId) }, alcance)).lean();
  if (!equipo) throw noEncontrado('Equipo no encontrado');
  const r = rangoMes(mes);
  const [lecturas, compras, sucursal] = await Promise.all([
    LecturaTemperatura.find({ sucursal: equipo.sucursal, equipo: equipo._id, fecha: { $gte: r.inicio, $lt: r.fin } }).sort({ fecha: 1 }).lean(),
    Compra.find({ sucursal: equipo.sucursal, estado: 'recibida', fechaRecepcion: { $gte: r.inicio, $lt: r.fin }, 'partidas.temperaturaLlegada': { $exists: true } })
      .sort({ fechaRecepcion: 1 }).lean(),
    Sucursal.findById(equipo.sucursal).lean()
  ]);
  const recepciones = compras.flatMap(c =>
    c.partidas
      .filter(p => p.temperaturaLlegada !== undefined && p.temperaturaLlegada !== null)
      .map(p => ({ fecha: c.fechaRecepcion, proveedor: c.proveedorNombre, factura: c.folioFactura, producto: p.nombre, lote: p.lote || '', temperatura: p.temperaturaLlegada, fueraDeRango: p.fueraDeRango }))
  );
  return {
    equipo: publicoEquipo(equipo),
    sucursal: sucursal?.nombre || '',
    mes,
    lecturas: lecturas.map(publicaLectura),
    recepciones,
    resumen: {
      lecturas: lecturas.length,
      fueraDeRango: lecturas.filter(l => l.fueraDeRango).length,
      minima: lecturas.length ? Math.min(...lecturas.map(l => l.temperatura)) : null,
      maxima: lecturas.length ? Math.max(...lecturas.map(l => l.temperatura)) : null
    }
  };
}

// ---------- Tablero ----------

async function alertas(alcance, ahora = new Date()) {
  const hoy = rangoDia(ahora);
  const hace7 = new Date(hoy.inicio.getTime() - 6 * 86400000);
  const [fuera, equipos, conLectura] = await Promise.all([
    LecturaTemperatura.countDocuments(conAlcance({ fueraDeRango: true, fecha: { $gte: hace7 } }, alcance)),
    EquipoFrio.find(conAlcance({ activo: true }, alcance)).select('_id').lean(),
    LecturaTemperatura.distinct('equipo', conAlcance({ fecha: { $gte: hoy.inicio, $lt: hoy.fin } }, alcance))
  ]);
  const leidos = new Set(conLectura.map(String));
  return { lecturasFueraDeRango: fuera, equiposSinLectura: equipos.filter(e => !leidos.has(String(e._id))).length };
}

module.exports = { listarEquipos, crearEquipo, actualizarEquipo, registrarLectura, listarLecturas, bitacora, alertas };

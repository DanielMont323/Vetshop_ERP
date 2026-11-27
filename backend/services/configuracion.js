// Configuración general (un documento). Se crea con los valores por defecto la primera vez que se pide.
const Configuracion = require('../models/Configuracion');
const { ESCALONES_PUNTOS, PREMIOS_COSTAL } = Configuracion;
const { conTransaccion } = require('../helpers/transaccion');
const { solicitudInvalida } = require('../helpers/errores');
const auditoria = require('./auditoria');

const publica = c => ({
  caja: { conceptosGasto: c.caja.conceptosGasto, topeGastoSinPin: c.caja.topeGastoSinPin },
  descuentos: { motivos: (c.descuentos?.motivos || []).map(m => ({ nombre: m.nombre, maximo: m.maximo, requierePin: m.requierePin })) },
  lealtad: {
    activa: c.lealtad?.activa ?? true,
    valorPunto: c.lealtad?.valorPunto ?? 10,
    escalones: (c.lealtad?.escalones?.length ? c.lealtad.escalones : ESCALONES_PUNTOS).map(e => ({ hasta: e.hasta ?? null, porcentaje: e.porcentaje })),
    premiosCostal: (c.lealtad?.premiosCostal?.length ? c.lealtad.premiosCostal : PREMIOS_COSTAL).map(p => ({ numero: p.numero, porcentaje: p.porcentaje }))
  }
});

// Escalones: crecientes, el último sin tope. Premios: números distintos y crecientes.
function validarLealtad(l) {
  if (l.escalones) {
    const e = l.escalones;
    if (!e.length || e[e.length - 1].hasta !== null || e.slice(0, -1).some((x, i) => x.hasta === null || (i > 0 && x.hasta <= e[i - 1].hasta))) {
      throw solicitudInvalida('Escalones de puntos: montos crecientes y el último sin tope');
    }
  }
  if (l.premiosCostal) {
    const n = l.premiosCostal.map(p => p.numero);
    if (!n.length || n.some((x, i) => i > 0 && x <= n[i - 1])) throw solicitudInvalida('Premios por costal: números crecientes sin repetir');
  }
}

async function obtenerDoc(session) {
  await Configuracion.updateOne({ clave: 'general' }, { $setOnInsert: { clave: 'general' } }, { upsert: true, session }).catch(error => {
    if (error.code !== 11000) throw error;
  });
  return Configuracion.findOne({ clave: 'general' }).session(session || null);
}

async function obtener() {
  return publica(await obtenerDoc());
}

async function actualizar(actor, { caja = {}, descuentos = {}, lealtad = {} }) {
  validarLealtad(lealtad);
  return conTransaccion(async session => {
    const c = await obtenerDoc(session);
    const antes = publica(c.toObject());
    if (caja.conceptosGasto !== undefined) c.caja.conceptosGasto = caja.conceptosGasto.map(x => String(x).trim()).filter(Boolean);
    if (caja.topeGastoSinPin !== undefined) c.caja.topeGastoSinPin = caja.topeGastoSinPin;
    for (const campo of ['activa', 'valorPunto', 'escalones', 'premiosCostal']) {
      if (lealtad[campo] !== undefined) c.set(`lealtad.${campo}`, lealtad[campo]);
    }
    if (descuentos.motivos !== undefined) c.descuentos.motivos = descuentos.motivos.map(m => ({ nombre: String(m.nombre).trim(), maximo: m.maximo, requierePin: m.requierePin !== false }));
    try {
      await c.save({ session });
    } catch (error) {
      if (error.name === 'ValidationError') throw solicitudInvalida(Object.values(error.errors)[0].message);
      throw error;
    }
    const despues = publica(c.toObject());
    await auditoria.registrar({ usuario: actor._id, accion: 'configuracion.actualizar', entidad: 'Configuracion', entidadId: c._id, antes, despues }, session);
    return despues;
  });
}

module.exports = { obtener, actualizar };

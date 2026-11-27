// Configuración general (un documento). Se crea con los valores por defecto la primera vez que se pide.
const Configuracion = require('../models/Configuracion');
const { conTransaccion } = require('../helpers/transaccion');
const { solicitudInvalida } = require('../helpers/errores');
const auditoria = require('./auditoria');

const publica = c => ({
  caja: { conceptosGasto: c.caja.conceptosGasto, topeGastoSinPin: c.caja.topeGastoSinPin },
  descuentos: { motivos: (c.descuentos?.motivos || []).map(m => ({ nombre: m.nombre, maximo: m.maximo, requierePin: m.requierePin })) }
});

async function obtenerDoc(session) {
  await Configuracion.updateOne({ clave: 'general' }, { $setOnInsert: { clave: 'general' } }, { upsert: true, session }).catch(error => {
    if (error.code !== 11000) throw error;
  });
  return Configuracion.findOne({ clave: 'general' }).session(session || null);
}

async function obtener() {
  return publica(await obtenerDoc());
}

async function actualizar(actor, { caja = {}, descuentos = {} }) {
  return conTransaccion(async session => {
    const c = await obtenerDoc(session);
    const antes = publica(c.toObject());
    if (caja.conceptosGasto !== undefined) c.caja.conceptosGasto = caja.conceptosGasto.map(x => String(x).trim()).filter(Boolean);
    if (caja.topeGastoSinPin !== undefined) c.caja.topeGastoSinPin = caja.topeGastoSinPin;
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

// Ajustes de inventario: SOLO con autorización del dueño (su usuario y PIN), siempre en bitácora.
//   entrada: crea una capa nueva (lote, caducidad, costo).
//   salida:  FEFO sobre lo vigente, o de una capa concreta (`capa`), que puede estar caducada:
//            así se da de baja la mercancía caducada o dañada de ese lote.
const mongoose = require('mongoose');
const { conTransaccion } = require('../helpers/transaccion');
const { sucursalDeEscritura } = require('../helpers/alcance');
const { solicitudInvalida, conflicto } = require('../helpers/errores');
const ConteoFisico = require('../models/ConteoFisico');
const inventario = require('./inventario');
const { verificarPin } = require('./autorizaciones');
const auditoria = require('./auditoria');

const MOTIVOS_ENTRADA = ['conteo_fisico', 'inventario_inicial', 'otro'];
// cadena_frio: producto dañado porque un equipo salió de rango (ver la acción correctiva en la bitácora)
const MOTIVOS_SALIDA = ['merma', 'caducado', 'danado', 'cadena_frio', 'conteo_fisico', 'uso_interno', 'otro'];

async function registrar(alcance, actor, datos) {
  const sucursal = sucursalDeEscritura(alcance);
  const { tipo, producto, cantidad, motivo, nota, autorizacion } = datos;
  if (tipo === 'entrada' && !MOTIVOS_ENTRADA.includes(motivo)) throw solicitudInvalida(`Motivo de entrada inválido (${MOTIVOS_ENTRADA.join(', ')})`);
  if (tipo === 'salida' && !MOTIVOS_SALIDA.includes(motivo)) throw solicitudInvalida(`Motivo de salida inválido (${MOTIVOS_SALIDA.join(', ')})`);

  // Fuera de la transacción: un PIN equivocado cuenta aunque el ajuste no se registre
  const autorizador = await verificarPin({ ...autorizacion, permiso: 'autorizar:ajuste_inventario', sucursal });

  return conTransaccion(async session => {
    // Durante un conteo físico las diferencias se corrigen al aplicarlo, no con ajustes sueltos
    if (await ConteoFisico.exists({ sucursal, abierto: true }).session(session)) {
      throw conflicto('Hay un conteo físico abierto en esta sucursal: termínalo o cancélalo antes de ajustar', 'CONTEO_EN_CURSO');
    }
    const comun = { sucursal, usuario: actor._id, motivo, nota, autorizadoPor: autorizador.id, referencia: { modelo: 'Ajuste' } };
    let movimientos;
    if (tipo === 'entrada') {
      const { movimiento } = await inventario.registrarEntrada(
        { ...comun, producto, cantidad, origen: 'ajuste_entrada', costoUnitario: datos.costoUnitario, lote: datos.lote, caducidad: datos.caducidad },
        session
      );
      movimientos = [movimiento._id];
    } else if (datos.capa) {
      const { movimiento } = await inventario.consumirDeCapa({ ...comun, capaId: datos.capa, producto, cantidad }, session);
      movimientos = [movimiento._id];
    } else {
      const r = await inventario.consumirFefo({ ...comun, tipo: 'ajuste', partidas: [{ producto, cantidad }] }, session);
      movimientos = r.map(x => x.movimiento);
    }

    await auditoria.registrar(
      {
        usuario: actor._id,
        autorizadoPor: autorizador.id,
        accion: `inventario.ajuste_${tipo}`,
        entidad: 'InventoryMovement',
        entidadId: movimientos[0],
        sucursal,
        despues: { producto: new mongoose.Types.ObjectId(String(producto)), tipo, cantidad, motivo, lote: datos.lote, capa: datos.capa, movimientos },
        motivo: nota
      },
      session
    );
    return { movimientos, autorizadoPor: autorizador.nombre };
  });
}

module.exports = { registrar, MOTIVOS_ENTRADA, MOTIVOS_SALIDA };

// Registro en la bitácora. Se llama dentro de la misma transacción que la acción auditada.
const Auditoria = require('../models/Auditoria');

async function registrar({ usuario, accion, entidad, entidadId, sucursal, antes, despues, motivo, autorizadoPor }, session) {
  const [registro] = await Auditoria.create(
    [{ usuario, accion, entidad, entidadId, sucursal, antes, despues, motivo, autorizadoPor, fecha: new Date() }],
    { session }
  );
  return registro;
}

module.exports = { registrar };

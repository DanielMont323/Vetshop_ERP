// Ejecuta `fn(session)` dentro de una transacción de Mongo.
// withTransaction reintenta automáticamente ante errores transitorios (conflictos de escritura).
// Toda operación que toque varias colecciones (venta, recepción, traspaso, ajuste, corte) va aquí.
const mongoose = require('mongoose');

async function conTransaccion(fn) {
  const session = await mongoose.startSession();
  try {
    let resultado;
    await session.withTransaction(async () => {
      resultado = await fn(session);
    });
    return resultado;
  } finally {
    await session.endSession();
  }
}

module.exports = { conTransaccion };

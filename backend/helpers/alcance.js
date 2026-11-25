// Aplica el alcance de sucursal (req.alcance, lo pone el middleware scopeSucursal) a filtros
// y pipelines. Los servicios operativos SIEMPRE construyen sus consultas con estas funciones.
//
// req.alcance = { sucursalActiva: ObjectId | null, permitidas: ObjectId[] | 'todas', esDueno }
const { solicitudInvalida } = require('./errores');

// Valor del filtro de sucursal para LECTURAS
function valorAlcance(alcance) {
  if (!alcance) throw new Error('conAlcance: falta el alcance (¿la ruta no pasa por scopeSucursal?)');
  if (alcance.sucursalActiva) return alcance.sucursalActiva;
  if (alcance.permitidas === 'todas') return { $exists: true };
  return { $in: alcance.permitidas };
}

// Filtro con alcance sobre un campo (por defecto 'sucursal'). El alcance reemplaza cualquier
// valor de ese campo que viniera en el filtro: el cliente no puede ampliar su alcance.
function conAlcance(filtro = {}, alcance, campo = 'sucursal') {
  return { ...filtro, [campo]: valorAlcance(alcance) };
}

// Para colecciones con dos campos de sucursal (Traspaso: origen / destino):
// el documento es visible si CUALQUIERA de los campos está dentro del alcance.
function conAlcanceMultiple(filtro = {}, alcance, campos) {
  const valor = valorAlcance(alcance);
  const or = { $or: campos.map(c => ({ [c]: valor })) };
  return Object.keys(filtro).length ? { $and: [filtro, or] } : or;
}

// Primera etapa obligatoria de cualquier aggregate sobre una colección operativa
function matchAlcance(alcance, filtro = {}, campo = 'sucursal') {
  return { $match: conAlcance(filtro, alcance, campo) };
}

// Sucursal en la que se ESCRIBE. El middleware ya exige X-Sucursal en escrituras;
// esto es una segunda comprobación para los servicios.
function sucursalDeEscritura(alcance) {
  if (!alcance || !alcance.sucursalActiva) {
    throw solicitudInvalida('Indica la sucursal en la que trabajas (encabezado X-Sucursal)');
  }
  return alcance.sucursalActiva;
}

module.exports = { conAlcance, conAlcanceMultiple, matchAlcance, sucursalDeEscritura };

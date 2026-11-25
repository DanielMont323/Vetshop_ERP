// Validadores reutilizables de express-validator para el dinero y las cantidades.
const { CLAVES_LISTA } = require('../models/ListaPrecios');

// Centavos: número entero de JSON (no texto, no decimales), ≥ 0
const esCentavos = v => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

// { publico: 12345, mayoreo: null } — claves de lista conocidas; valor en centavos o null (quitar)
function validarMapaPrecios(valor) {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) throw new Error('precios debe ser un objeto { lista: centavos }');
  for (const [clave, precio] of Object.entries(valor)) {
    if (!CLAVES_LISTA.includes(clave)) throw new Error(`Lista de precios desconocida: ${clave}`);
    if (precio !== null && !esCentavos(precio)) throw new Error(`El precio de ${clave} debe estar en centavos enteros (≥ 0) o null`);
  }
  return true;
}

module.exports = { esCentavos, validarMapaPrecios };

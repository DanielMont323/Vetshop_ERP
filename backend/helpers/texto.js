// Normalización de texto para búsquedas: minúsculas, sin acentos, espacios simples.
// "Croquetas  Perro ADULTO Ñ" → "croquetas perro adulto n"
function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Escapa un texto para usarlo literal dentro de una expresión regular (evita inyección de regex).
function escaparRegex(texto) {
  return String(texto).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { normalizar, escaparRegex };

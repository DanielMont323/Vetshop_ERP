// Texto sin acentos y en minúsculas para buscar
export const normalizarTexto = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

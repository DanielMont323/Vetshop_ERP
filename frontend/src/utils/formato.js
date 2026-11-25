// Formato para mostrar y capturar. El servidor SIEMPRE trabaja en centavos y gramos enteros;
// aquí solo se convierte el texto que escribe la persona.

// "$1,250.5" | "1250.50" → 125050. Devuelve null si está vacío o es inválido (más de 2 decimales).
export function pesosACentavos(texto) {
  const limpio = String(texto ?? '').trim().replace(/[$\s,]/g, '');
  if (limpio === '') return null;
  const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(limpio);
  if (!m) return NaN;
  return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
}

// 125050 → "$1,250.50"
export function formatearDinero(centavos) {
  if (centavos === null || centavos === undefined) return '—';
  const negativo = centavos < 0;
  const abs = Math.abs(centavos);
  const pesos = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negativo ? '-' : ''}$${pesos}.${String(abs % 100).padStart(2, '0')}`;
}

// 125050 → "1250.50" (para poner en un campo de captura)
export function centavosATexto(centavos) {
  if (centavos === null || centavos === undefined) return '';
  return `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;
}

// Cantidades: piezas tal cual; kg ↔ gramos con hasta 3 decimales
export function cantidadABase(texto, unidad) {
  const limpio = String(texto ?? '').trim().replace(',', '.');
  if (limpio === '') return null;
  if (unidad === 'kg') {
    const m = /^(\d+)(?:\.(\d{0,3}))?$/.exec(limpio);
    if (!m) return NaN;
    return Number(m[1]) * 1000 + Number((m[2] || '').padEnd(3, '0'));
  }
  return /^\d+$/.test(limpio) ? Number(limpio) : NaN;
}

export function baseATexto(cantidad, unidad) {
  if (cantidad === null || cantidad === undefined) return '';
  if (unidad !== 'kg') return String(cantidad);
  const kg = Math.floor(cantidad / 1000);
  const g = cantidad % 1000;
  return g ? `${kg}.${String(g).padStart(3, '0').replace(/0+$/, '')}` : String(kg);
}

export const NOMBRES_CATEGORIA = {
  medicamento: 'Medicamento',
  biologico: 'Biológico',
  alimento: 'Alimento',
  accesorio: 'Accesorio',
  higiene: 'Higiene',
  otro: 'Otro'
};

export const NOMBRES_IVA = { tasa_16: 'IVA 16 %', tasa_0: 'IVA 0 %', exento: 'Exento' };

export const LISTAS_PRECIO = [
  { clave: 'publico', nombre: 'Público' },
  { clave: 'mayoreo', nombre: 'Mayoreo' },
  { clave: 'clinica', nombre: 'Clínica' },
  { clave: 'empleado', nombre: 'Empleado' }
];

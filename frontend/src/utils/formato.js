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

// 12500 g → "12.5 kg" ; 3 → "3 pzas"
export function formatearCantidad(cantidad, unidad) {
  if (cantidad === null || cantidad === undefined) return '—';
  if (unidad === 'kg') return `${baseATexto(cantidad, 'kg')} kg`;
  return `${cantidad} ${Math.abs(cantidad) === 1 ? 'pza' : 'pzas'}`;
}

// Fechas: se muestran SIEMPRE en hora de Tepic, sin importar la zona de la computadora
const ZONA = 'America/Mazatlan';
export function formatearFecha(fecha, conHora = false) {
  if (!fecha) return '—';
  const opciones = { timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric', ...(conHora && { hour: '2-digit', minute: '2-digit', hour12: false }) };
  return new Intl.DateTimeFormat('es-MX', opciones).format(new Date(fecha));
}

export const NOMBRES_ALERTA = {
  caducado: { texto: 'Caducado', clase: 'bg-red-100 text-red-800' },
  por_caducar: { texto: 'Por caducar', clase: 'bg-amber-100 text-amber-800' },
  bajo_minimo: { texto: 'Bajo mínimo', clase: 'bg-orange-100 text-orange-800' },
  sin_existencia: { texto: 'Sin existencia', clase: 'bg-slate-200 text-slate-700' },
  vigente: { texto: 'Vigente', clase: 'bg-emerald-100 text-emerald-800' },
  sin_caducidad: { texto: 'Sin caducidad', clase: 'bg-slate-100 text-slate-700' }
};

export const NOMBRES_MOVIMIENTO = {
  entrada: 'Entrada', venta: 'Venta', cancelacion: 'Cancelación', traspaso_salida: 'Traspaso (salida)',
  traspaso_entrada: 'Traspaso (entrada)', ajuste: 'Ajuste'
};

export const NOMBRES_MOTIVO = {
  merma: 'Merma', caducado: 'Caducado', danado: 'Dañado', conteo_fisico: 'Conteo físico',
  uso_interno: 'Uso interno', inventario_inicial: 'Inventario inicial', otro: 'Otro'
};

// Fecha de hoy en Tepic como AAAA-MM-DD (para campos <input type="date">)
export function hoyLocal() {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return partes; // en-CA ya da AAAA-MM-DD
}

// Instante → AAAA-MM-DD del día en Tepic
export function diaLocalDe(fecha) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(fecha));
}

export const NOMBRES_ESTADO_COMPRA = {
  borrador: { texto: 'Borrador', clase: 'bg-slate-100 text-slate-700' },
  recibida: { texto: 'Recibida', clase: 'bg-emerald-100 text-emerald-800' },
  cancelada: { texto: 'Cancelada', clase: 'bg-red-100 text-red-800' }
};

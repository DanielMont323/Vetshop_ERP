// Recordatorios: textos, días por defecto y el enlace de WhatsApp (wa.me, sin API).

export const TIPOS_RECORDATORIO = {
  cita: 'Cita (clínica o estética)',
  alimento: 'Alimento',
  desparasitante: 'Desparasitante',
  vacuna: 'Vacuna',
  medicamento: 'Medicamento',
  otro: 'Otro'
};

// Días de aviso antes del evento y cada cuántos días se repite, por defecto
export const DIAS_ANTES = { cita: 5, alimento: 3, desparasitante: 3, vacuna: 5, medicamento: 2, otro: 1 };
export const REPETIR_POR_DEFECTO = { cita: '', alimento: '30', desparasitante: '90', vacuna: '365', medicamento: '', otro: '' };

export const ESPECIES = { perro: 'Perro', gato: 'Gato', ave: 'Ave', roedor: 'Roedor', reptil: 'Reptil', otro: 'Otro' };

export const enlaceWhatsapp = (numero, texto = '') => `https://wa.me/52${numero}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`;

// 'AAAA-MM-DD' → «lunes 2 de diciembre»
export function fechaLarga(ymd) {
  const [a, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).toLocaleDateString('es-MX', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
}

// 'AAAA-MM-DD' + días (aritmética de calendario)
export function sumarDias(ymd, dias) {
  const [a, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + Number(dias))).toISOString().slice(0, 10);
}

export function mensajeWhatsapp(r) {
  const nombre = r.cliente.nombre.split(' ')[0];
  const de = r.mascota ? ` de ${r.mascota.nombre}` : '';
  const a = r.mascota ? ` a ${r.mascota.nombre}` : '';
  const cuando = fechaLarga(r.fecha);
  const firma = ' — Huellitas Vetshop 🐾';
  switch (r.tipo) {
    case 'cita':
      return `Hola ${nombre}, te recordamos la cita${de}: ${r.descripcion}, el ${cuando}.${firma}`;
    case 'alimento':
      return `Hola ${nombre}, ya casi se termina el alimento${de} (${r.descripcion}). ¿Te lo apartamos? Lo tenemos listo para el ${cuando}.${firma}`;
    case 'vacuna':
    case 'desparasitante':
    case 'medicamento':
      return `Hola ${nombre}, te recordamos que${a} le toca ${r.descripcion} el ${cuando}. En Huellitas lo tenemos.${firma}`;
    default:
      return `Hola ${nombre}, te recordamos: ${r.descripcion} (${cuando}).${firma}`;
  }
}

// Fechas: SIEMPRE se guardan en UTC real (un Date de JS es un instante, no una hora local).
// La zona del negocio (Tepic, UTC-7 todo el año) solo se usa para MOSTRAR y para calcular
// dónde empieza y termina un día, un mes o una caducidad.
const { fromZonedTime, formatInTimeZone } = require('date-fns-tz');
const { solicitudInvalida } = require('./errores');

const ZONA = 'America/Mazatlan';
const RE_YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = n => String(n).padStart(2, '0');

function exigirFecha(fecha) {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) throw solicitudInvalida(`Fecha inválida: ${fecha}`);
  return d;
}

function ultimoDiaDelMes(anio, mes) {
  // Día 0 del mes siguiente = último día de este mes (cálculo de calendario, sin zona)
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

function validarYmd(anio, mes, dia) {
  if (anio < 2000 || anio > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > ultimoDiaDelMes(anio, mes)) {
    throw solicitudInvalida(`Fecha inválida: ${anio}-${pad(mes)}-${pad(dia)}`);
  }
}

// Instante UTC de una hora local de Tepic.
function deHoraLocal(anio, mes, dia, hh = 0, mm = 0, ss = 0, ms = 0) {
  validarYmd(anio, mes, dia);
  const texto = `${anio}-${pad(mes)}-${pad(dia)}T${pad(hh)}:${pad(mm)}:${pad(ss)}.${String(ms).padStart(3, '0')}`;
  return fromZonedTime(texto, ZONA);
}

// "AAAA-MM-DD" del día en Tepic al que pertenece un instante.
function diaLocal(fecha = new Date()) {
  return formatInTimeZone(exigirFecha(fecha), ZONA, 'yyyy-MM-dd');
}

function partesYmd(ymd) {
  const m = RE_YMD.exec(ymd || '');
  if (!m) throw solicitudInvalida(`Se esperaba una fecha AAAA-MM-DD (recibido: ${ymd})`);
  const [anio, mes, dia] = m.slice(1).map(Number);
  validarYmd(anio, mes, dia);
  return { anio, mes, dia };
}

// Rango [inicio, fin) en UTC de un día de Tepic. Acepta "AAAA-MM-DD" o un instante.
// fin es EXCLUSIVO (inicio del día siguiente): usar { $gte: inicio, $lt: fin }.
function rangoDia(diaOFecha = new Date()) {
  const ymd = typeof diaOFecha === 'string' && RE_YMD.test(diaOFecha) ? diaOFecha : diaLocal(diaOFecha);
  const { anio, mes, dia } = partesYmd(ymd);
  const inicio = deHoraLocal(anio, mes, dia);
  const siguiente = new Date(Date.UTC(anio, mes - 1, dia + 1));
  const fin = deHoraLocal(siguiente.getUTCFullYear(), siguiente.getUTCMonth() + 1, siguiente.getUTCDate());
  return { inicio, fin };
}

// Rango [inicio, fin) que cubre del día "desde" al día "hasta" (ambos incluidos).
function rangoDias(desde, hasta) {
  const { inicio } = rangoDia(desde);
  const { fin } = rangoDia(hasta);
  if (fin <= inicio) throw solicitudInvalida('La fecha final es anterior a la inicial');
  return { inicio, fin };
}

// Mostrar un instante en hora de Tepic. Patrones de date-fns (dd/MM/yyyy HH:mm por defecto).
function formatearLocal(fecha, patron = 'dd/MM/yyyy HH:mm') {
  return formatInTimeZone(exigirFecha(fecha), ZONA, patron);
}

// Caducidad capturada → instante UTC del FIN de ese día en Tepic (23:59:59.999).
// Formatos aceptados:
//   "MM/AAAA" o "M/AAAA" (también con guion) → último día de ese mes
//   "DD/MM/AAAA"                              → ese día
//   "AAAA-MM-DD"                              → ese día
// Un producto con caducidad "03/2027" se puede vender hasta el 31/03/2027 a las 23:59 de Tepic.
function parsearCaducidad(texto) {
  if (typeof texto !== 'string') throw solicitudInvalida('La caducidad debe capturarse como texto (MM/AAAA, DD/MM/AAAA o AAAA-MM-DD)');
  const t = texto.trim();
  let anio, mes, dia;
  let m;
  if ((m = /^(\d{1,2})[/-](\d{4})$/.exec(t))) {
    mes = Number(m[1]);
    anio = Number(m[2]);
    if (mes < 1 || mes > 12) throw solicitudInvalida(`Mes de caducidad inválido: ${texto}`);
    dia = ultimoDiaDelMes(anio, mes);
  } else if ((m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t))) {
    dia = Number(m[1]);
    mes = Number(m[2]);
    anio = Number(m[3]);
  } else if ((m = RE_YMD.exec(t))) {
    [anio, mes, dia] = m.slice(1).map(Number);
  } else {
    throw solicitudInvalida(`Caducidad inválida: "${texto}". Usa MM/AAAA, DD/MM/AAAA o AAAA-MM-DD`);
  }
  return deHoraLocal(anio, mes, dia, 23, 59, 59, 999);
}

// Un lote está caducado cuando el instante actual ya pasó su caducidad (que es fin de día).
function estaCaducado(caducidad, ahora = new Date()) {
  if (!caducidad) return false;
  return exigirFecha(ahora).getTime() > exigirFecha(caducidad).getTime();
}

// Días de calendario (en Tepic) desde hoy hasta el día de caducidad. 0 = caduca hoy; negativo = caducado.
function diasParaCaducar(caducidad, ahora = new Date()) {
  const a = partesYmd(diaLocal(ahora));
  const c = partesYmd(diaLocal(caducidad));
  return Math.round((Date.UTC(c.anio, c.mes - 1, c.dia) - Date.UTC(a.anio, a.mes - 1, a.dia)) / 86400000);
}

module.exports = {
  ZONA, deHoraLocal, diaLocal, rangoDia, rangoDias, formatearLocal,
  parsearCaducidad, estaCaducado, diasParaCaducar
};

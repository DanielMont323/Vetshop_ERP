// Cálculos de VISTA PREVIA de la caja (mismas reglas que el servidor: centavos enteros, half-up).
// El total que vale es el que devuelve el servidor al cobrar.
import { cadenaFrioAPI, cobranzaAPI, turnosAPI, ventasAPI } from '../services/api';

const dividir = (n, d) => Math.floor(n / d) + ((n % d) * 2 >= d ? 1 : 0);

// Precio que se cobrará según la lista del cliente (respaldo en público). null si no tiene.
export function precioPara(producto, lista) {
  if (producto.precios?.[lista] !== undefined) return { precio: producto.precios[lista], lista };
  if (producto.precios?.publico !== undefined) return { precio: producto.precios.publico, lista: 'publico' };
  return null;
}

export function importeBruto(precio, cantidad, unidad) {
  if (!precio || !cantidad) return 0;
  return unidad === 'kg' ? dividir(precio * cantidad, 1000) : precio * cantidad;
}

// "10" | "12.5" (porcentaje) → puntos base (1000 | 1250). '' → undefined. Inválido → NaN.
export function porcentajeAPuntosBase(texto) {
  const limpio = String(texto ?? '').trim().replace(',', '.');
  if (limpio === '' || limpio === '0') return undefined;
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(limpio);
  if (!m) return NaN;
  const pb = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
  return pb > 10000 ? NaN : pb;
}

export function descuentoDe(bruto, puntosBase) {
  return puntosBase ? dividir(bruto * puntosBase, 10000) : 0;
}

// Imprime un HTML (ticket o corte) en un iframe oculto, sin abrir ventanas emergentes
async function imprimirHtml(html) {
  const marco = document.createElement('iframe');
  marco.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  marco.setAttribute('sandbox', 'allow-modals allow-same-origin');
  marco.srcdoc = html;
  document.body.appendChild(marco);
  await new Promise(resolve => {
    marco.onload = resolve;
  });
  marco.contentWindow.focus();
  marco.contentWindow.print();
  setTimeout(() => marco.remove(), 60000);
}

export async function imprimirTicket(ventaId, ancho = 80) {
  const { data } = await ventasAPI.ticket(ventaId, ancho);
  await imprimirHtml(data);
}

export async function imprimirCorte(turnoId, ancho = 80) {
  const { data } = await turnosAPI.corte(turnoId, ancho);
  await imprimirHtml(data);
}

export async function imprimirAbono(abonoId, ancho = 80) {
  const { data } = await cobranzaAPI.comprobante(abonoId, ancho);
  await imprimirHtml(data);
}

export async function imprimirEstadoCuenta(clienteId, params) {
  const { data } = await cobranzaAPI.impresion(clienteId, params);
  await imprimirHtml(data);
}

export async function imprimirBitacoraFrio(params) {
  const { data } = await cadenaFrioAPI.bitacora(params);
  await imprimirHtml(data);
}

// Clave única por intento de cobro (si se reintenta, el servidor no cobra dos veces)
export const nuevaClaveOperacion = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);

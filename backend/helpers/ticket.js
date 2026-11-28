// Ticket de venta en HTML para impresora térmica de 58 u 80 mm (sin html2canvas: se imprime
// directo con window.print()). Todo texto que viene de la BD se escapa.
const { formatear } = require('./dinero');
const { baseATexto } = require('./cantidades');
const { formatearLocal } = require('./fechas');

const escapar = texto =>
  String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const METODOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', credito: 'A crédito', puntos: 'Puntos' };
const NEGOCIO = 'Huellitas Vetshop';

// Encabezado del ticket: logo, nombre, lema, RFC, dirección y teléfono de la marca (services/marcas)
function encabezado(marca = {}, sucursal = '') {
  const lineas = String(marca.direccion || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return [
    marca.logo ? `<div class="centro"><img src="${escapar(marca.logo)}" alt="" style="max-width:55%;max-height:28mm"></div>` : '',
    `<h1>${escapar(marca.nombre || NEGOCIO)}</h1>`,
    marca.lema ? `<div class="centro">${escapar(marca.lema)}</div>` : '',
    marca.rfc ? `<div class="centro">RFC: ${escapar(marca.rfc)}</div>` : '',
    ...lineas.map(l => `<div class="centro">${escapar(l)}</div>`),
    marca.telefono ? `<div class="centro">Tel. ${escapar(marca.telefono)}</div>` : '',
    sucursal ? `<div class="centro">Sucursal ${escapar(sucursal)}</div>` : ''
  ].filter(Boolean).join('\n  ');
}

function cantidadTexto(p) {
  return p.unidad === 'kg' ? `${baseATexto(p.cantidad, 'kg')} kg` : `${p.cantidad}`;
}

/**
 * @param {object} venta  venta pública (services/ventas)
 * @param {object} opciones { sucursal: nombre, ancho: 58 | 80 }
 */
function htmlTicket(venta, { sucursal, ancho = 80, urlAutofactura, marca } = {}) {
  const mm = ancho === 58 ? 58 : 80;
  const filas = venta.partidas
    .map(p => {
      const unitario = `${formatear(p.precioUnitario)}${p.unidad === 'kg' ? '/kg' : ''}`;
      const descuento = p.descuento > 0 ? `<div class="d">Descuento −${formatear(p.descuento)}</div>` : '';
      return `<div class="p"><div>${escapar(p.nombre)}</div><div class="f"><span>${cantidadTexto(p)} × ${unitario}</span><span>${formatear(p.bruto)}</span></div>${descuento}</div>`;
    })
    .join('');
  const pagos = venta.pagos.map(p => `<div class="f"><span>${METODOS[p.metodo]}</span><span>${formatear(p.monto)}</span></div>`).join('');
  const cancelada = venta.estado === 'cancelada' ? '<div class="c">*** CANCELADA ***</div>' : '';

  return `<!doctype html>
<html lang="es-MX"><head><meta charset="utf-8"><title>Ticket ${escapar(venta.serie)}-${venta.folio}</title>
<style>
  @page { size: ${mm}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body { width: ${mm}mm; margin: 0; padding: 2mm 3mm; font: ${mm === 58 ? 10 : 12}px/1.3 monospace; color: #000; }
  h1 { font-size: 1.2em; text-align: center; margin: 0; }
  .centro { text-align: center; }
  .f { display: flex; justify-content: space-between; gap: 4px; }
  .p { margin: 2px 0; }
  .d { text-align: right; }
  .t { font-weight: bold; font-size: 1.15em; }
  .c { text-align: center; font-weight: bold; margin: 4px 0; }
  hr { border: 0; border-top: 1px dashed #000; margin: 4px 0; }
</style></head>
<body>
  ${encabezado(marca, sucursal)}
  <hr>
  <div class="f"><span>Folio</span><span>${escapar(venta.serie)}-${venta.folio}</span></div>
  <div class="f"><span>Fecha</span><span>${formatearLocal(venta.fecha, 'dd/MM/yyyy HH:mm')}</span></div>
  <div class="f"><span>Atendió</span><span>${escapar(venta.cajero.nombre)}</span></div>
  <div class="f"><span>Cliente</span><span>${escapar(venta.cliente.nombre)}</span></div>
  ${cancelada}
  <hr>
  ${filas}
  <hr>
  ${venta.descuento > 0 ? `<div class="f"><span>Subtotal</span><span>${formatear(venta.subtotal)}</span></div><div class="f"><span>Descuento</span><span>−${formatear(venta.descuento)}</span></div>` : ''}
  <div class="f t"><span>TOTAL</span><span>${formatear(venta.total)}</span></div>
  <div class="f"><span>IVA incluido</span><span>${formatear(venta.iva)}</span></div>
  <hr>
  ${pagos}
  ${venta.cambio > 0 ? `<div class="f t"><span>Cambio</span><span>${formatear(venta.cambio)}</span></div>` : ''}
  ${venta.lealtad ? `<div class="f"><span>Puntos ganados</span><span>${venta.lealtad.puntosGanados || 0}</span></div><div class="f"><span>Saldo de puntos</span><span>${venta.lealtad.saldoPuntos}</span></div>` : ''}
  <hr>
  ${venta.aCredito > 0 ? `<div class="centro">Firma de conformidad (crédito):</div><br><div class="centro">______________________</div><hr>` : ''}
  ${urlAutofactura && venta.estado === 'cobrada' && !venta.aCredito ? `<div class="centro">Factura este ticket en el mes:</div><div class="centro">${escapar(urlAutofactura)}</div><div class="centro">con el folio y el total</div><hr>` : ''}
  <div class="centro">¡Gracias por su compra!</div>
</body></html>`;
}

// Comprobante de abono de un cliente (misma impresora térmica)
function htmlAbono(abono, { sucursal, saldo, ancho = 80, marca } = {}) {
  const mm = ancho === 58 ? 58 : 80;
  const filas = abono.aplicaciones
    .map(a => `<div class="f"><span>${escapar(a.folio)}</span><span>${formatear(a.monto)}</span></div>${a.bonificacion > 0 ? `<div class="d">Bonificación pronto pago −${formatear(a.bonificacion)}</div>` : ''}`)
    .join('');
  return `<!doctype html>
<html lang="es-MX"><head><meta charset="utf-8"><title>Abono ${escapar(abono.serie)}-${abono.folio}</title>
<style>
  @page { size: ${mm}mm auto; margin: 0; }
  body { width: ${mm}mm; margin: 0; padding: 2mm 3mm; font: ${mm === 58 ? 10 : 12}px/1.3 monospace; color: #000; }
  h1 { font-size: 1.2em; text-align: center; margin: 0; }
  .centro { text-align: center; } .f { display: flex; justify-content: space-between; gap: 4px; } .d { text-align: right; }
  .t { font-weight: bold; font-size: 1.15em; } .c { text-align: center; font-weight: bold; margin: 4px 0; }
  hr { border: 0; border-top: 1px dashed #000; margin: 4px 0; }
</style></head>
<body>
  ${encabezado(marca, sucursal)}
  <div class="centro">Comprobante de abono</div>
  <hr>
  <div class="f"><span>Folio</span><span>${escapar(abono.serie)}-${abono.folio}</span></div>
  <div class="f"><span>Fecha</span><span>${formatearLocal(abono.fecha, 'dd/MM/yyyy HH:mm')}</span></div>
  <div class="f"><span>Recibió</span><span>${escapar(abono.usuario.nombre)}</span></div>
  <div class="f"><span>Cliente</span><span>${escapar(abono.cliente.nombre)}</span></div>
  ${abono.estado === 'cancelado' ? '<div class="c">*** CANCELADO ***</div>' : ''}
  <hr>
  <div class="b">Aplicado a</div>
  ${filas}
  <hr>
  <div class="f t"><span>ABONO</span><span>${formatear(abono.monto)}</span></div>
  <div class="f"><span>${METODOS[abono.metodo]}</span><span>${escapar(abono.referencia)}</span></div>
  ${saldo !== undefined ? `<div class="f"><span>Saldo pendiente</span><span>${formatear(saldo)}</span></div>` : ''}
  <hr>
  <div class="centro">¡Gracias por su pago!</div>
</body></html>`;
}

module.exports = { htmlTicket, htmlAbono, escapar, encabezado };

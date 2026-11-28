// Nota de venta (remisión) en hoja carta para clientes de distribución: datos del cliente, partidas con precio
// unitario, descuentos, IVA, forma de pago, vencimiento si fue a crédito, y firma de recibido.
// Todo texto que viene de la BD se escapa.
const { formatear } = require('./dinero');
const { baseATexto } = require('./cantidades');
const { formatearLocal } = require('./fechas');
const { escapar } = require('./ticket');

const METODOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', credito: 'A crédito', puntos: 'Puntos' };

/**
 * @param venta    venta pública (sin costos)
 * @param cliente  documento del cliente (nombre, rfc, fiscal, dirección, teléfono)
 * @param extra    { sucursal, vencimiento }
 */
function htmlNotaVenta(venta, cliente, { sucursal = '', vencimiento = null } = {}) {
  const filas = venta.partidas.map(p => `
    <tr>
      <td>${escapar(p.sku)}</td>
      <td>${escapar(p.nombre)}${p.descuentoMotivo ? `<div class="m">Descuento: ${escapar(p.descuentoMotivo)}</div>` : ''}</td>
      <td class="n">${p.unidad === 'kg' ? `${baseATexto(p.cantidad, 'kg')} kg` : p.cantidad}</td>
      <td class="n">${formatear(p.precioUnitario)}${p.unidad === 'kg' ? '/kg' : ''}</td>
      <td class="n">${p.descuento > 0 ? `−${formatear(p.descuento)}` : ''}</td>
      <td class="n">${formatear(p.importe)}</td>
    </tr>`).join('');
  const pagos = venta.pagos.map(p => `${METODOS[p.metodo]} ${formatear(p.monto)}`).join(' · ');
  const fiscal = cliente.fiscal || {};
  const datos = [
    cliente.rfc && `RFC: ${escapar(cliente.rfc)}`,
    fiscal.razonSocial && escapar(fiscal.razonSocial),
    cliente.direccion && escapar(cliente.direccion),
    (cliente.telefono || cliente.whatsapp) && `Tel. ${escapar(cliente.telefono || cliente.whatsapp)}`
  ].filter(Boolean).join('<br>');

  return `<!doctype html>
<html lang="es-MX"><head><meta charset="utf-8"><title>Nota de venta ${escapar(venta.serie)}-${venta.folio}</title>
<style>
  @page { size: letter; margin: 15mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 12px/1.4 Arial, Helvetica, sans-serif; color: #111; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #047857; padding-bottom: 8px; }
  h1 { margin: 0; font-size: 20px; color: #047857; }
  h2 { margin: 0; font-size: 16px; text-align: right; }
  .caja { display: flex; gap: 16px; margin: 12px 0; }
  .caja > div { flex: 1; border: 1px solid #ccc; border-radius: 6px; padding: 8px; }
  .t { font-size: 10px; text-transform: uppercase; color: #555; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #f1f5f9; text-align: left; font-size: 11px; padding: 6px; border-bottom: 1px solid #ccc; }
  td { padding: 6px; border-bottom: 1px solid #eee; vertical-align: top; }
  .n { text-align: right; white-space: nowrap; }
  .m { font-size: 10px; color: #555; }
  .totales { margin-left: auto; width: 260px; margin-top: 8px; }
  .totales div { display: flex; justify-content: space-between; padding: 2px 0; }
  .grande { font-size: 15px; font-weight: bold; border-top: 1px solid #111; margin-top: 4px; padding-top: 4px; }
  .firma { margin-top: 60px; display: flex; justify-content: space-around; text-align: center; }
  .firma div { width: 40%; border-top: 1px solid #111; padding-top: 4px; }
  .cancelada { color: #b91c1c; font-weight: bold; font-size: 16px; text-align: center; margin: 8px 0; }
  .nota { font-size: 10px; color: #555; margin-top: 16px; }
</style></head>
<body>
  <header>
    <div><h1>Huellitas Vetshop</h1><div>${escapar(sucursal)}</div></div>
    <div><h2>NOTA DE VENTA</h2><div class="n">Folio <strong>${escapar(venta.serie)}-${venta.folio}</strong></div><div class="n">${formatearLocal(venta.fecha, 'dd/MM/yyyy HH:mm')}</div></div>
  </header>
  ${venta.estado === 'cancelada' ? '<div class="cancelada">*** VENTA CANCELADA ***</div>' : ''}
  <div class="caja">
    <div><div class="t">Cliente</div><strong>${escapar(cliente.nombre)}</strong><br>${datos}</div>
    <div><div class="t">Condiciones</div>${escapar(pagos)}${vencimiento ? `<br>Vence el <strong>${formatearLocal(vencimiento, 'dd/MM/yyyy')}</strong>` : ''}<br>Atendió: ${escapar(venta.cajero.nombre)}${venta.factura ? '<br>Facturada (CFDI)' : ''}</div>
  </div>
  <table>
    <thead><tr><th>SKU</th><th>Producto</th><th class="n">Cantidad</th><th class="n">Precio</th><th class="n">Descuento</th><th class="n">Importe</th></tr></thead>
    <tbody>${filas}</tbody>
  </table>
  <div class="totales">
    <div><span>Subtotal</span><span>${formatear(venta.subtotal)}</span></div>
    ${venta.descuento > 0 ? `<div><span>Descuento</span><span>−${formatear(venta.descuento)}</span></div>` : ''}
    <div><span>IVA incluido</span><span>${formatear(venta.iva)}</span></div>
    <div class="grande"><span>TOTAL</span><span>${formatear(venta.total)}</span></div>
    ${venta.aCredito > 0 ? `<div><span>A crédito</span><span>${formatear(venta.aCredito)}</span></div>` : ''}
  </div>
  <div class="firma"><div>Entregó</div><div>Recibí de conformidad<br>(nombre y firma)</div></div>
  <p class="nota">Precios con IVA incluido. Este documento no es un comprobante fiscal; la factura (CFDI) se emite por separado.</p>
</body></html>`;
}

module.exports = { htmlNotaVenta };

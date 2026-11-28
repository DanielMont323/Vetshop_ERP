// Nota de venta en hoja carta con el formato que pidió Carlos (Formato de nota vetshop.pdf):
//   encabezado con logo, nombre, lema, RFC y dirección de la marca; recuadros de Nota (folio) y Fecha;
//   datos del cliente (nombre, RFC, dirección, C.P., teléfono); tabla Cant · Unidad · Descripción · Precio · Total ·
//   IVA · Tasa (precios SIN IVA, IVA por renglón); Subt. sin descuento, Descuento, Total, Subtotal, IVA y TOTAL;
//   pagaré con firma del cliente y logos de las marcas al pie.
// La marca es «Vet Shop» para clientes con negocio y «Huellitas Vetshop» para ventas de mostrador (services/marcas).
// Todo texto que viene de la BD se escapa. Los logos son data URL (la CSP de la respuesta permite img-src data:).
const { formatear } = require('./dinero');
const { baseATexto } = require('./cantidades');
const { formatearLocal } = require('./fechas');
const { escapar } = require('./ticket');
const { desglosarIva } = require('../services/calculoVenta');

const numero = centavos => formatear(centavos).replace('$', '');
const lineas = texto => String(texto || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
const porcentaje = (parte, total) => (total > 0 ? Math.round((parte / total) * 1000) / 10 : 0);

// Precio y total SIN IVA de cada renglón; IVA del importe ya con descuento
function renglones(venta) {
  return venta.partidas.map(p => {
    const brutoSinIva = p.bruto - desglosarIva(p.bruto, p.tasaIva);
    const importeSinIva = p.importe - p.iva;
    const cantidad = p.unidad === 'kg' ? Number(baseATexto(p.cantidad, 'kg')) : p.cantidad;
    return {
      cantidad: p.unidad === 'kg' ? baseATexto(p.cantidad, 'kg') : String(p.cantidad),
      unidad: p.unidad === 'kg' ? 'Kg' : 'Pieza',
      nombre: p.nombre,
      precio: Math.round(brutoSinIva / cantidad),
      total: brutoSinIva,
      importeSinIva,
      iva: p.iva,
      tasa: p.tasaIva / 100,
      descuento: p.descuento,
      motivo: p.descuentoMotivo
    };
  });
}

function htmlNotaVenta(venta, cliente, { marca = {}, sucursal = '', vencimiento = null } = {}) {
  const filas = renglones(venta);
  const subtotalSinDescuento = filas.reduce((s, f) => s + f.total, 0);
  const totalSinIva = filas.reduce((s, f) => s + f.importeSinIva, 0);
  const descuentoSinIva = subtotalSinDescuento - totalSinIva;
  const fiscal = cliente.fiscal || {};
  const nombreCliente = fiscal.razonSocial || cliente.nombre;
  const folio = `${venta.serie}-${String(venta.folio).padStart(4, '0')}`;
  const tabla = filas.map(f => `
      <tr><td class="c">${escapar(f.cantidad)}</td><td class="c">${f.unidad}</td>
      <td class="c">${escapar(f.nombre)}${f.descuento > 0 && f.motivo ? `<div class="m">Descuento: ${escapar(f.motivo)}</div>` : ''}</td>
      <td class="n">${numero(f.precio)}</td><td class="n">${numero(f.total)}</td>
      <td class="n">${f.iva > 0 ? numero(f.iva) : '-'}</td><td class="n">${f.tasa}%</td></tr>`).join('');
  const pagos = venta.pagos.map(p => ({ efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', credito: 'Crédito', puntos: 'Puntos' }[p.metodo])).join(', ');

  return `<!doctype html>
<html lang="es-MX"><head><meta charset="utf-8"><title>Nota ${escapar(folio)}</title>
<style>
  @page { size: letter; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 12px/1.35 Arial, Helvetica, sans-serif; color: #000; }
  .cab { border: 1px solid #000; display: grid; grid-template-columns: 34% 1fr 24%; align-items: center; padding: 6px 10px; }
  .cab img { max-width: 100%; max-height: 120px; }
  .marca { text-align: center; font-weight: bold; font-size: 11px; line-height: 1.6; }
  .marca h1 { font-style: italic; font-size: 24px; margin: 0; }
  .marca .lema { font-style: italic; font-size: 13px; }
  .caja { border: 1px solid #000; text-align: center; padding: 4px; margin: 4px 0; }
  .caja b { font-style: italic; display: block; }
  .caja i { font-size: 14px; }
  .cliente { border: 1px solid #000; margin: 8px 0; padding: 6px 10px; display: grid; grid-template-columns: 62% 1fr; gap: 6px 12px; font-weight: bold; font-style: italic; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #bfe3f2; border: 1px solid #000; font-weight: normal; padding: 2px 4px; }
  td { border: 1px solid #000; padding: 2px 4px; }
  .c { text-align: center; } .n { text-align: right; white-space: nowrap; }
  .m { font-size: 10px; color: #444; }
  .totales { margin-left: auto; width: 340px; border-collapse: collapse; }
  .totales td:first-child { background: #bfe3f2; text-align: right; }
  .totales td:last-child { text-align: right; width: 110px; }
  .totales tr:last-child td { font-weight: bold; }
  .pagare { text-align: center; font-weight: bold; font-style: italic; margin: 22px 30px 30px; }
  .firma { width: 60%; margin: 0 auto; border-top: 2px solid #1f4e79; padding-top: 6px; text-align: center; }
  .firma div { border: 1px solid #000; width: 75%; margin: 0 auto; padding: 2px; text-transform: uppercase; }
  .pie { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 18px 28px; margin-top: 22px; }
  .pie img { max-height: 42px; max-width: 150px; }
  .extra { font-size: 10px; color: #444; margin-top: 6px; }
  .cancelada { color: #b91c1c; font-weight: bold; font-size: 16px; text-align: center; margin: 6px 0; }
</style></head>
<body>
  <div class="cab">
    <div>${marca.logo ? `<img src="${escapar(marca.logo)}" alt="">` : ''}</div>
    <div class="marca">
      <h1>${escapar(marca.nombre || 'Huellitas Vetshop')}</h1>
      ${marca.lema ? `<div class="lema">${escapar(marca.lema)}</div>` : ''}
      ${marca.rfc ? `<div>RFC: ${escapar(marca.rfc)}</div>` : ''}
      ${lineas(marca.direccion).map(l => `<div>${escapar(l)}</div>`).join('')}
      ${marca.telefono ? `<div>Tel. ${escapar(marca.telefono)}</div>` : ''}
    </div>
    <div>
      <div class="caja"><b>Nota</b><i>${escapar(folio)}</i></div>
      <div class="caja"><b>Fecha</b><i>${formatearLocal(venta.fecha, 'dd/MM/yyyy')}</i></div>
    </div>
  </div>
  ${venta.estado === 'cancelada' ? '<div class="cancelada">*** VENTA CANCELADA ***</div>' : ''}
  <div class="cliente">
    <div>Cliente: ${escapar(nombreCliente)}</div><div>${cliente.rfc ? `RFC: ${escapar(cliente.rfc)}` : ''}</div>
    <div>Dirección: ${escapar(cliente.direccion || '')}</div><div>${fiscal.codigoPostal ? `C.P: ${escapar(fiscal.codigoPostal)}` : ''}</div>
    <div>Teléfono: ${escapar(cliente.telefono || cliente.whatsapp || '')}</div><div></div>
  </div>
  <table>
    <thead><tr><th>Cant</th><th>Unidad</th><th>Descripción</th><th>Precio</th><th>Total</th><th>IVA</th><th>Tasa</th></tr></thead>
    <tbody>${tabla}</tbody>
  </table>
  <table class="totales">
    <tr><td>Subt. Sin descuento</td><td>${numero(subtotalSinDescuento)}</td></tr>
    <tr><td>Descuento</td><td>${descuentoSinIva > 0 ? `${porcentaje(descuentoSinIva, subtotalSinDescuento)}% (${numero(descuentoSinIva)})` : '0%'}</td></tr>
    <tr><td>Total</td><td>${numero(totalSinIva)}</td></tr>
    <tr><td>Subtotal</td><td>${numero(totalSinIva)}</td></tr>
    <tr><td>IVA</td><td>${numero(venta.iva)}</td></tr>
    <tr><td>TOTAL</td><td>${numero(venta.total)}</td></tr>
  </table>
  <div class="extra">Forma de pago: ${escapar(pagos)}${vencimiento ? ` · Vence el ${formatearLocal(vencimiento, 'dd/MM/yyyy')}` : ''}${venta.factura ? ' · Facturada (CFDI)' : ''}${sucursal ? ` · Sucursal ${escapar(sucursal)}` : ''} · Atendió ${escapar(venta.cajero.nombre)}</div>
  <p class="pagare">Por el presente pagaré reconozco y me obligo a pagar en esta ciudad o cualquier otra que se requiera de pago esta nota con los datos proporcionados anteriormente.</p>
  <div class="firma"><div>${escapar(nombreCliente)}</div></div>
  ${marca.pie?.length ? `<div class="pie">${marca.pie.map(src => `<img src="${escapar(src)}" alt="">`).join('')}</div>` : ''}
</body></html>`;
}

module.exports = { htmlNotaVenta, renglones };

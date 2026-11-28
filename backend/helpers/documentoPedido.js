// Pedido a proveedor en hoja carta (se imprime o se guarda como PDF desde el navegador). Texto escapado.
const { formatear } = require('./dinero');
const { baseATexto } = require('./cantidades');
const { formatearLocal } = require('./fechas');
const { escapar } = require('./ticket');

const cantidad = p => (p.unidad === 'kg' ? `${baseATexto(p.cantidad, 'kg')} kg` : `${p.cantidad} pzas`);

function htmlPedido(pedido, { sucursal = '', proveedor = {} } = {}) {
  const filas = pedido.partidas.map((p, i) => `
    <tr><td>${i + 1}</td><td>${escapar(p.sku)}</td><td>${escapar(p.nombre)}${p.presentacion ? ` <span class="m">${escapar(p.presentacion)}</span>` : ''}</td>
    <td class="n">${cantidad(p)}</td><td class="n">${p.costoEstimado ? formatear(p.costoEstimado) : ''}</td></tr>`).join('');
  return `<!doctype html>
<html lang="es-MX"><head><meta charset="utf-8"><title>Pedido ${escapar(pedido.folio)}</title>
<style>
  @page { size: letter; margin: 15mm; }
  body { margin: 0; font: 12px/1.4 Arial, Helvetica, sans-serif; color: #111; }
  header { display: flex; justify-content: space-between; border-bottom: 2px solid #047857; padding-bottom: 8px; }
  h1 { margin: 0; font-size: 20px; color: #047857; }
  h2 { margin: 0; font-size: 16px; text-align: right; }
  .caja { display: flex; gap: 16px; margin: 12px 0; }
  .caja > div { flex: 1; border: 1px solid #ccc; border-radius: 6px; padding: 8px; }
  .t { font-size: 10px; text-transform: uppercase; color: #555; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f1f5f9; text-align: left; font-size: 11px; padding: 6px; border-bottom: 1px solid #ccc; }
  td { padding: 6px; border-bottom: 1px solid #eee; }
  .n { text-align: right; white-space: nowrap; }
  .m { color: #555; font-size: 11px; }
  .nota { margin-top: 12px; }
</style></head>
<body>
  <header>
    <div><h1>Huellitas Vetshop</h1><div>${escapar(sucursal)}</div></div>
    <div><h2>PEDIDO DE COMPRA</h2><div class="n">Folio <strong>${escapar(pedido.folio)}</strong></div><div class="n">${formatearLocal(pedido.enviadoEn || pedido.creado, 'dd/MM/yyyy')}</div></div>
  </header>
  <div class="caja">
    <div><div class="t">Proveedor</div><strong>${escapar(pedido.proveedor.nombre)}</strong>${proveedor.contacto ? `<br>Atn. ${escapar(proveedor.contacto)}` : ''}${proveedor.telefono ? `<br>Tel. ${escapar(proveedor.telefono)}` : ''}${proveedor.email ? `<br>${escapar(proveedor.email)}` : ''}</div>
    <div><div class="t">Entregar en</div>${escapar(sucursal)}</div>
  </div>
  <table>
    <thead><tr><th>#</th><th>SKU</th><th>Producto</th><th class="n">Cantidad</th><th class="n">Último costo (sin IVA)</th></tr></thead>
    <tbody>${filas}</tbody>
  </table>
  ${pedido.notas ? `<p class="nota"><strong>Notas:</strong> ${escapar(pedido.notas)}</p>` : ''}
  <p class="m">Favor de confirmar existencias, precios y fecha de entrega.</p>
</body></html>`;
}

module.exports = { htmlPedido };

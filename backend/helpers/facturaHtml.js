// Representación impresa (HTML, hoja carta) de un CFDI cuando el PAC no da PDF (PAC simulado).
const { formatear } = require('./dinero');
const { formatearLocal } = require('./fechas');
const { escapar } = require('./ticket');
const { FORMAS_PAGO, USOS_CFDI, REGIMENES } = require('../config/sat');

const TIPOS = { I: 'Ingreso', E: 'Egreso (nota de crédito)', P: 'Pago (complemento)' };

function htmlFactura(f, { emisor, sucursal }) {
  const conceptos = f.conceptos
    .map(c => `<tr><td>${escapar(c.claveSat)}</td><td>${escapar(c.claveUnidad)}</td><td>${escapar(c.noIdentificacion || '')}</td><td>${escapar(c.descripcion)}</td>
      <td class="n">${c.cantidad}</td><td class="n">${formatear(c.importe)}</td><td class="n">${formatear(c.iva)}</td></tr>`)
    .join('');
  const pago = f.pago
    ? `<h2>Pago</h2><p>Fecha ${formatearLocal(f.pago.fecha, 'dd/MM/yyyy')} · ${escapar(FORMAS_PAGO[f.pago.formaPago] || f.pago.formaPago)} · ${formatear(f.pago.monto)}</p>
       <table><tr><th>Documento</th><th class="n">Parcialidad</th><th class="n">Saldo anterior</th><th class="n">Pagado</th><th class="n">Saldo insoluto</th></tr>
       ${f.pago.documentos.map(d => `<tr><td>${escapar(d.uuid)}</td><td class="n">${d.parcialidad}</td><td class="n">${formatear(d.saldoAnterior)}</td><td class="n">${formatear(d.importePagado)}</td><td class="n">${formatear(d.saldoInsoluto)}</td></tr>`).join('')}</table>`
    : '';
  const prueba = f.pac === 'simulado' ? '<div class="prueba">COMPROBANTE DE PRUEBA — SIN VALIDEZ FISCAL</div>' : '';
  return `<!doctype html>
<html lang="es-MX"><head><meta charset="utf-8"><title>Factura ${escapar(f.folioCompleto)}</title>
<style>
  @page { size: letter; margin: 12mm; }
  body { font: 11px/1.35 Arial, sans-serif; color: #000; margin: 0; }
  h1 { font-size: 17px; margin: 0; } h2 { font-size: 13px; margin: 12px 0 4px; }
  table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #aaa; padding: 3px 4px; text-align: left; }
  th { background: #eee; } .n { text-align: right; white-space: nowrap; }
  .cab { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #000; padding-bottom: 6px; }
  .prueba { border: 2px solid #b00; color: #b00; font-weight: bold; text-align: center; padding: 4px; margin: 6px 0; }
  .tot { width: 40%; margin-left: auto; margin-top: 6px; }
</style></head>
<body>
  <div class="cab">
    <div><h1>${escapar(emisor.nombre)}</h1>RFC ${escapar(emisor.rfc)} · Régimen ${escapar(emisor.regimen)} ${escapar(REGIMENES[emisor.regimen] || '')}<br>Lugar de expedición ${escapar(emisor.lugarExpedicion)} · ${escapar(sucursal)}</div>
    <div style="text-align:right"><b>${TIPOS[f.tipo]}</b><br>Folio <b>${escapar(f.folioCompleto)}</b><br>${f.fechaTimbrado ? formatearLocal(f.fechaTimbrado, 'dd/MM/yyyy HH:mm') : ''}</div>
  </div>
  ${prueba}
  ${f.estado === 'cancelada' ? '<div class="prueba">CANCELADA</div>' : ''}
  <h2>Receptor</h2>
  <p>${escapar(f.receptor.razonSocial)} · RFC ${escapar(f.receptor.rfc)} · Régimen ${escapar(f.receptor.regimen)} · CP ${escapar(f.receptor.codigoPostal)}<br>
  Uso del CFDI: ${escapar(f.receptor.usoCfdi)} ${escapar(USOS_CFDI[f.receptor.usoCfdi] || '')}</p>
  ${f.global ? `<p>Información global: periodicidad ${escapar(f.global.periodicidad)}, mes ${escapar(f.global.meses)}, año ${f.global.anio}</p>` : ''}
  ${f.relacionados ? `<p>CFDI relacionado (${escapar(f.relacionados.tipoRelacion)}): ${f.relacionados.uuids.map(escapar).join(', ')}</p>` : ''}
  ${f.tipo === 'P' ? pago : `<h2>Conceptos</h2>
  <table><tr><th>Clave SAT</th><th>Unidad</th><th>No. ident.</th><th>Descripción</th><th class="n">Cantidad</th><th class="n">Importe</th><th class="n">IVA</th></tr>${conceptos}</table>
  <table class="tot">
    <tr><td>Subtotal</td><td class="n">${formatear(f.subtotal)}</td></tr>
    <tr><td>IVA trasladado</td><td class="n">${formatear(f.iva)}</td></tr>
    <tr><td><b>Total</b></td><td class="n"><b>${formatear(f.total)}</b></td></tr>
  </table>
  <p>Forma de pago: ${escapar(f.formaPago)} ${escapar(FORMAS_PAGO[f.formaPago] || '')} · Método de pago: ${escapar(f.metodoPago)} · Moneda: MXN</p>`}
  <p>Folio fiscal (UUID): <b>${escapar(f.uuid)}</b></p>
  <p style="font-size:9px;color:#555">Este documento es una representación impresa de un CFDI.</p>
</body></html>`;
}

module.exports = { htmlFactura };

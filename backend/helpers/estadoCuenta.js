// Estado de cuenta de un cliente en HTML para imprimir en hoja carta (o guardar como PDF desde el navegador).
const { formatear } = require('./dinero');
const { formatearLocal } = require('./fechas');
const { escapar } = require('./ticket');

const NEGOCIO = 'Huellitas Vetshop';
const dia = f => (f ? formatearLocal(f, 'dd/MM/yyyy') : '');

function htmlEstadoCuenta(ec, { desde, hasta, ahora = new Date() } = {}) {
  const pendientes = ec.pendientes
    .map(c => `<tr><td>${escapar(c.folio)}</td><td>${dia(c.fecha)}</td><td>${dia(c.vencimiento)}</td><td class="n">${formatear(c.importe)}</td>
      <td class="n">${formatear(c.saldo)}</td><td class="n">${c.diasVencido > 0 ? `<b>${c.diasVencido}</b>` : 'Al corriente'}</td></tr>`)
    .join('');
  const movimientos = ec.movimientos
    .map(m => `<tr class="${m.cancelado ? 'x' : ''}"><td>${dia(m.fecha)}</td><td>${escapar(m.folio)}</td>
      <td>${m.tipo === 'cargo' ? 'Venta a crédito' : `Abono${m.aplica?.length ? ` a ${escapar(m.aplica.join(', '))}` : ''}`}${m.cancelado ? ' (cancelado)' : ''}</td>
      <td class="n">${m.cargo ? formatear(m.cargo) : ''}</td><td class="n">${m.abono ? formatear(m.abono) : ''}</td>
      <td class="n">${m.bonificacion ? formatear(m.bonificacion) : ''}</td><td class="n">${formatear(m.saldo)}</td></tr>`)
    .join('');
  const r = ec.resumen;
  const periodo = desde || hasta ? `${desde || 'inicio'} a ${hasta || 'hoy'}` : 'todos los movimientos';
  return `<!doctype html>
<html lang="es-MX"><head><meta charset="utf-8"><title>Estado de cuenta - ${escapar(ec.cliente.nombre)}</title>
<style>
  @page { size: letter; margin: 15mm; }
  body { font: 12px/1.4 Arial, sans-serif; color: #000; margin: 0; }
  h1 { font-size: 18px; margin: 0; } h2 { font-size: 14px; margin: 16px 0 6px; }
  table { width: 100%; border-collapse: collapse; } th, td { border-bottom: 1px solid #ccc; padding: 3px 4px; text-align: left; }
  th { background: #eee; } .n { text-align: right; white-space: nowrap; } .x td { color: #888; text-decoration: line-through; }
  .resumen { display: flex; gap: 24px; margin-top: 8px; } .resumen div { min-width: 110px; } .resumen b { display: block; font-size: 15px; }
  .cab { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 6px; }
</style></head>
<body>
  <div class="cab">
    <div><h1>${NEGOCIO}</h1><div>Estado de cuenta</div></div>
    <div style="text-align:right">Emitido: ${formatearLocal(ahora, 'dd/MM/yyyy HH:mm')}<br>Periodo: ${escapar(periodo)}</div>
  </div>
  <h2>${escapar(ec.cliente.nombre)}</h2>
  <div>${ec.cliente.rfc ? `RFC ${escapar(ec.cliente.rfc)} · ` : ''}${ec.cliente.telefono ? `Tel. ${escapar(ec.cliente.telefono)} · ` : ''}Crédito a ${ec.credito.dias} días${ec.credito.bonificacionProntoPago ? ` · ${ec.credito.bonificacionProntoPago / 100}% de bonificación si paga en ${ec.credito.diasProntoPago} días` : ''}</div>
  <div class="resumen">
    <div>Límite<b>${formatear(r.limite)}</b></div><div>Saldo<b>${formatear(r.saldo)}</b></div>
    <div>Vencido<b>${formatear(r.vencido)}</b></div><div>Disponible<b>${formatear(r.disponible)}</b></div>
  </div>
  <h2>Pendiente de pago</h2>
  ${pendientes ? `<table><tr><th>Venta</th><th>Fecha</th><th>Vence</th><th class="n">Importe</th><th class="n">Saldo</th><th class="n">Días vencido</th></tr>${pendientes}</table>` : '<p>Sin saldo pendiente.</p>'}
  <h2>Movimientos</h2>
  <table><tr><th>Fecha</th><th>Folio</th><th>Concepto</th><th class="n">Cargo</th><th class="n">Abono</th><th class="n">Bonificación</th><th class="n">Saldo</th></tr>
  ${desde ? `<tr><td colspan="6">Saldo inicial</td><td class="n">${formatear(ec.saldoInicial)}</td></tr>` : ''}
  ${movimientos || '<tr><td colspan="7">Sin movimientos en el periodo.</td></tr>'}</table>
</body></html>`;
}

module.exports = { htmlEstadoCuenta };

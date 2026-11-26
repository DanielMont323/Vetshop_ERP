// Corte de caja en HTML para impresora térmica (58 u 80 mm). Solo se imprime con el conteo registrado.
const { formatear } = require('./dinero');
const { formatearLocal } = require('./fechas');
const { escapar } = require('./ticket');

const METODOS = [['efectivo', 'Efectivo'], ['tarjeta', 'Tarjeta (terminal)'], ['transferencia', 'Transferencias']];

function diferenciaTexto(d) {
  if (d === 0) return 'Cuadra';
  return d > 0 ? `Sobra ${formatear(d)}` : `Falta ${formatear(-d)}`;
}

function htmlCorte(turno, { sucursal, ancho = 80 } = {}) {
  const mm = ancho === 58 ? 58 : 80;
  const c = turno.conteo;
  const filas = METODOS.map(([m, nombre]) => `
    <div class="b">${nombre}</div>
    <div class="f"><span>Esperado</span><span>${formatear(c.esperado[m])}</span></div>
    <div class="f"><span>Contado</span><span>${formatear(c.contado[m])}</span></div>
    <div class="f ${c.diferencias[m] ? 'b' : ''}"><span>Diferencia</span><span>${diferenciaTexto(c.diferencias[m])}</span></div>`).join('');
  const denominaciones = (c.denominaciones || [])
    .filter(d => d.cantidad > 0)
    .map(d => `<div class="f"><span>${d.cantidad} × ${formatear(d.denominacion)}</span><span>${formatear(d.cantidad * d.denominacion)}</span></div>`)
    .join('');
  const retiros = (turno.retiros || []).map(r => `<div class="f"><span>${escapar(r.motivo)}</span><span>${formatear(r.monto)}</span></div>`).join('');
  const cierre = turno.cierre?.autorizadoPorNombre
    ? `<hr><div class="b">Cerrado con diferencia</div><div>Justificación: ${escapar(turno.cierre.justificacion)}</div><div>Autorizó: ${escapar(turno.cierre.autorizadoPorNombre)}</div>`
    : '';

  return `<!doctype html>
<html lang="es-MX"><head><meta charset="utf-8"><title>Corte de caja</title>
<style>
  @page { size: ${mm}mm auto; margin: 0; }
  body { width: ${mm}mm; margin: 0; padding: 2mm 3mm; font: ${mm === 58 ? 10 : 12}px/1.3 monospace; color: #000; }
  h1 { font-size: 1.2em; text-align: center; margin: 0; }
  .centro { text-align: center; } .b { font-weight: bold; margin-top: 3px; }
  .f { display: flex; justify-content: space-between; gap: 4px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 4px 0; }
</style></head>
<body>
  <h1>Corte de caja</h1>
  <div class="centro">${escapar(sucursal)} · Caja ${turno.caja}</div>
  <hr>
  <div class="f"><span>Cajero</span><span>${escapar(turno.cajero.nombre)}</span></div>
  <div class="f"><span>Apertura</span><span>${formatearLocal(turno.apertura.fecha, 'dd/MM/yyyy HH:mm')}</span></div>
  <div class="f"><span>Conteo</span><span>${formatearLocal(c.fecha, 'dd/MM/yyyy HH:mm')}</span></div>
  <div class="f"><span>Fondo inicial</span><span>${formatear(turno.apertura.fondo)}</span></div>
  <div class="f"><span>Ventas</span><span>${c.ventas} (canceladas: ${c.canceladas})</span></div>
  ${c.abonos ? `<div class="f"><span>Abonos de clientes</span><span>${c.abonos}</span></div>` : ''}
  ${retiros ? `<hr><div class="b">Retiros</div>${retiros}` : ''}
  <hr>
  ${filas}
  ${denominaciones ? `<hr><div class="b">Efectivo contado</div>${denominaciones}` : ''}
  ${cierre}
  <hr>
  <div class="centro">Firma del cajero: ________________</div>
</body></html>`;
}

module.exports = { htmlCorte };

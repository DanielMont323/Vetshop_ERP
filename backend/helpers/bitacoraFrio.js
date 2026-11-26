// Bitácora mensual de temperatura de un equipo en HTML, hoja carta (formato para inspección sanitaria).
const { formatearLocal } = require('./fechas');
const { escapar } = require('./ticket');

const NEGOCIO = 'Huellitas Vetshop';
const grados = t => `${Number(t).toFixed(1)} °C`;

function htmlBitacoraFrio(b, { ahora = new Date() } = {}) {
  const e = b.equipo;
  const filas = b.lecturas
    .map(l => `<tr class="${l.fueraDeRango ? 'f' : ''}"><td>${formatearLocal(l.fecha, 'dd/MM/yyyy')}</td><td>${formatearLocal(l.fecha, 'HH:mm')}</td>
      <td class="n">${grados(l.temperatura)}</td><td>${l.fueraDeRango ? 'FUERA DE RANGO' : 'En rango'}</td><td>${escapar(l.usuario.nombre)}</td>
      <td>${escapar([l.observacion, l.accionCorrectiva && `Acción: ${l.accionCorrectiva}`, l.productosAfectados && `Productos: ${l.productosAfectados}`].filter(Boolean).join(' · '))}</td><td></td></tr>`)
    .join('');
  const recepciones = b.recepciones
    .map(r => `<tr class="${r.fueraDeRango ? 'f' : ''}"><td>${formatearLocal(r.fecha, 'dd/MM/yyyy HH:mm')}</td><td>${escapar(r.proveedor)}</td><td>${escapar(r.factura)}</td>
      <td>${escapar(r.producto)}</td><td>${escapar(r.lote)}</td><td class="n">${grados(r.temperatura)}</td></tr>`)
    .join('');
  const s = b.resumen;
  return `<!doctype html>
<html lang="es-MX"><head><meta charset="utf-8"><title>Bitácora de temperatura - ${escapar(e.nombre)} - ${escapar(b.mes)}</title>
<style>
  @page { size: letter; margin: 12mm; }
  body { font: 11px/1.35 Arial, sans-serif; color: #000; margin: 0; }
  h1 { font-size: 17px; margin: 0; } h2 { font-size: 13px; margin: 14px 0 6px; }
  table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #999; padding: 3px 4px; text-align: left; vertical-align: top; }
  th { background: #eee; } .n { text-align: right; white-space: nowrap; } .f td { font-weight: bold; }
  .cab { display: flex; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 8px; }
</style></head>
<body>
  <div class="cab">
    <div><h1>${NEGOCIO}</h1><div>Bitácora de temperatura · ${escapar(b.sucursal)}</div></div>
    <div style="text-align:right">Mes: <b>${escapar(b.mes)}</b><br>Impreso: ${formatearLocal(ahora, 'dd/MM/yyyy HH:mm')}</div>
  </div>
  <div><b>${escapar(e.nombre)}</b> (${e.tipo}) · Rango permitido: ${grados(e.minimo)} a ${grados(e.maximo)} · Lecturas por día: ${e.lecturasPorDia}</div>
  <div>Lecturas: ${s.lecturas} · Fuera de rango: ${s.fueraDeRango}${s.lecturas ? ` · Mínima ${grados(s.minima)} · Máxima ${grados(s.maxima)}` : ''}</div>
  <h2>Lecturas</h2>
  <table><tr><th>Fecha</th><th>Hora</th><th class="n">Temperatura</th><th>Estado</th><th>Registró</th><th>Observaciones / acción correctiva</th><th>Firma</th></tr>
  ${filas || '<tr><td colspan="7">Sin lecturas en el mes.</td></tr>'}</table>
  ${recepciones ? `<h2>Recepciones de productos refrigerados (temperatura de llegada)</h2>
  <table><tr><th>Fecha</th><th>Proveedor</th><th>Factura</th><th>Producto</th><th>Lote</th><th class="n">Temperatura</th></tr>${recepciones}</table>` : ''}
  <p style="margin-top:24px">Responsable sanitario: ______________________________</p>
</body></html>`;
}

module.exports = { htmlBitacoraFrio };

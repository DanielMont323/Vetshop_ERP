import { useCallback, useEffect, useState } from 'react';
import { FileSpreadsheet, Target } from 'lucide-react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { mensajeDeError, reportesAPI } from '../services/api';
import { baseATexto, formatearDinero, hoyLocal } from '../utils/formato';
import GraficaBarras from '../components/reportes/GraficaBarras';

const AGRUPAR = [['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes'], ['anio', 'Año']];
const METODOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', credito: 'A crédito' };
const CANALES = { publico: 'Público', distribucion: 'Distribución' };

const primeroDelMes = () => `${hoyLocal().slice(0, 8)}01`;
// Etiqueta corta del periodo: '2026-11-25' → '25/11', '2026-11' → '11/2026'; semana y año tal cual
const etiquetaPeriodo = p => (/^\d{4}-\d{2}-\d{2}$/.test(p) ? `${p.slice(8)}/${p.slice(5, 7)}` : /^\d{4}-\d{2}$/.test(p) ? `${p.slice(5)}/${p.slice(0, 4)}` : p);

// Tabla de filas con ventas, total, costo y margen. `nombre(fila)` da la primera columna.
function TablaMargen({ titulo, filas, nombre, encabezado }) {
  return (
    <div className="bg-white rounded-xl shadow overflow-x-auto">
      <h3 className="font-semibold px-4 pt-3">{titulo}</h3>
      <table className="w-full text-sm mt-2">
        <thead className="bg-slate-100 text-left">
          <tr>
            <th className="px-3 py-2">{encabezado}</th><th className="px-3 py-2 text-right">Ventas</th><th className="px-3 py-2 text-right">Total</th>
            <th className="px-3 py-2 text-right">Costo</th><th className="px-3 py-2 text-right">Margen</th><th className="px-3 py-2 text-right">%</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="px-3 py-2">{nombre(f)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{f.ventas}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatearDinero(f.total)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatearDinero(f.costo)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatearDinero(f.margen)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{f.base > 0 ? `${f.margenPorcentaje}` : '—'}</td>
            </tr>
          ))}
          {filas.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-500">Sin ventas en el periodo.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// Reportes de ventas (dueño): rango de fechas, agrupación, desgloses y Excel para el contador.
export default function Reportes() {
  const { sucursalActiva } = useAuth();
  const [desde, setDesde] = useState(primeroDelMes);
  const [hasta, setHasta] = useState(hoyLocal);
  const [agrupar, setAgrupar] = useState('dia');
  const [datos, setDatos] = useState(null);
  const [descargando, setDescargando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await reportesAPI.ventas({ desde, hasta, agrupar });
      setDatos(r.data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo cargar el reporte'));
    }
  }, [desde, hasta, agrupar]);

  useEffect(() => {
    cargar();
  }, [cargar, sucursalActiva]);

  const descargar = async () => {
    setDescargando(true);
    try {
      const r = await reportesAPI.excel({ desde, hasta, agrupar });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ventas_${desde}_${hasta}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo generar el Excel'));
    } finally {
      setDescargando(false);
    }
  };

  const t = datos?.totales;

  return (
    <section className="space-y-4">
      {/* Filtros en una sola fila, arriba de todo */}
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="text-lg font-semibold mr-auto">Reportes de ventas</h2>
        <Link to="/metas" className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"><Target size={16} aria-hidden="true" /> Metas</Link>
        <label className="text-sm">Desde<input type="date" className="block rounded-lg border border-slate-300 px-2 py-1.5" value={desde} max={hasta} onChange={e => setDesde(e.target.value)} /></label>
        <label className="text-sm">Hasta<input type="date" className="block rounded-lg border border-slate-300 px-2 py-1.5" value={hasta} min={desde} max={hoyLocal()} onChange={e => setHasta(e.target.value)} /></label>
        <label className="text-sm">Agrupar por
          <select className="block rounded-lg border border-slate-300 px-2 py-1.5" value={agrupar} onChange={e => setAgrupar(e.target.value)}>
            {AGRUPAR.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
          </select>
        </label>
        <button type="button" onClick={descargar} disabled={descargando} className="flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-3 py-2 hover:bg-emerald-700 disabled:opacity-60">
          <FileSpreadsheet size={16} aria-hidden="true" /> {descargando ? 'Generando…' : 'Excel'}
        </button>
      </div>

      {!datos && <p className="text-slate-500">Cargando…</p>}
      {datos && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              ['Vendido (con IVA)', formatearDinero(t.total)],
              ['Ventas', t.ventas],
              ['Ticket promedio', formatearDinero(t.ticketPromedio)],
              ['Costo de lo vendido', formatearDinero(t.costo)],
              ['Margen', `${formatearDinero(t.margen)}${t.base > 0 ? ` · ${t.margenPorcentaje} %` : ''}`]
            ].map(([titulo, valor]) => (
              <div key={titulo} className="bg-white rounded-xl shadow p-4">
                <p className="text-sm text-slate-500">{titulo}</p>
                <p className="text-xl font-semibold tabular-nums text-slate-900">{valor}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl shadow p-4">
            <h3 className="font-semibold mb-2">Ventas por {AGRUPAR.find(a => a[0] === agrupar)[1].toLowerCase()}</h3>
            <GraficaBarras datos={datos.periodos} etiqueta={etiquetaPeriodo} />
          </div>

          <TablaMargen titulo={`Por ${AGRUPAR.find(a => a[0] === agrupar)[1].toLowerCase()} (tabla)`} encabezado="Periodo" filas={datos.periodos.filter(f => f.ventas > 0)} nombre={f => etiquetaPeriodo(f.periodo)} />
          <div className="grid lg:grid-cols-2 gap-4">
            <TablaMargen titulo="Por sucursal" encabezado="Sucursal" filas={datos.sucursales} nombre={f => f.sucursal.nombre} />
            <TablaMargen titulo="Por cajero" encabezado="Cajero" filas={datos.cajeros} nombre={f => f.cajero.nombre} />
            <TablaMargen titulo="Público vs distribución" encabezado="Canal" filas={datos.canales} nombre={f => CANALES[f.canal]} />
            <div className="bg-white rounded-xl shadow overflow-x-auto">
              <h3 className="font-semibold px-4 pt-3">Por forma de pago</h3>
              <table className="w-full text-sm mt-2">
                <thead className="bg-slate-100 text-left"><tr><th className="px-3 py-2">Forma de pago</th><th className="px-3 py-2 text-right">Ventas</th><th className="px-3 py-2 text-right">Cobrado</th></tr></thead>
                <tbody>
                  {datos.formasPago.map(f => (
                    <tr key={f.metodo} className="border-t border-slate-100">
                      <td className="px-3 py-2">{METODOS[f.metodo]}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{f.ventas}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatearDinero(f.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow overflow-x-auto">
            <h3 className="font-semibold px-4 pt-3">Productos más vendidos</h3>
            <table className="w-full text-sm mt-2">
              <thead className="bg-slate-100 text-left">
                <tr><th className="px-3 py-2">Producto</th><th className="px-3 py-2 text-right">Cantidad</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-right">Margen</th></tr>
              </thead>
              <tbody>
                {datos.productos.map(p => (
                  <tr key={String(p.producto)} className="border-t border-slate-100">
                    <td className="px-3 py-2">{p.nombre} <span className="font-mono text-xs text-slate-500">{p.sku}</span></td>
                    <td className="px-3 py-2 text-right tabular-nums">{baseATexto(p.cantidad, p.unidad)} {p.unidad === 'kg' ? 'kg' : 'pzas'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatearDinero(p.total)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatearDinero(p.margen)}</td>
                  </tr>
                ))}
                {datos.productos.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-500">Sin ventas en el periodo.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

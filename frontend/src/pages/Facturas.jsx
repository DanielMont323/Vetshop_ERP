import { useCallback, useEffect, useState } from 'react';
import { FilePlus2, Globe2, Receipt, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { facturasAPI, mensajeDeError } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { formatearDinero, formatearFecha, hoyLocal } from '../utils/formato';
import { ESTADOS_FACTURA, MODALIDADES, TIPOS_CFDI } from '../utils/sat';
import NuevaFactura from '../components/facturas/NuevaFactura';
import FacturaGlobal from '../components/facturas/FacturaGlobal';
import FacturaDetalle from '../components/facturas/FacturaDetalle';

const COLOR = { timbrada: 'bg-emerald-100 text-emerald-800', cancelada: 'bg-slate-100 text-slate-600', error: 'bg-red-100 text-red-800', pendiente: 'bg-amber-100 text-amber-800' };
const primeroDelMes = () => `${hoyLocal().slice(0, 7)}-01`;

// Facturación CFDI: facturas emitidas de la sucursal, factura a cliente, global y detalle.
export default function Facturas() {
  const { sucursalActiva } = useAuth();
  const [filtros, setFiltros] = useState({ desde: primeroDelMes(), hasta: hoyLocal(), tipo: '', q: '' });
  const [datos, setDatos] = useState(null);
  const [panel, setPanel] = useState(null); // 'nueva' | 'global' | id de factura

  const cargar = useCallback(async () => {
    try {
      const { data } = await facturasAPI.listar({ ...filtros, tipo: filtros.tipo || undefined, q: filtros.q.trim() || undefined, limite: 100 });
      setDatos(data);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudieron cargar las facturas'));
    }
  }, [filtros]);

  useEffect(() => {
    const t = setTimeout(cargar, 250);
    return () => clearTimeout(t);
  }, [cargar, sucursalActiva]);

  const cambiar = (k, v) => setFiltros(f => ({ ...f, [k]: v }));
  const cerrarYRecargar = id => {
    setPanel(id || null);
    cargar();
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold mr-auto flex items-center gap-2"><Receipt size={20} aria-hidden="true" /> Facturación</h2>
        <button type="button" onClick={() => setPanel('global')} disabled={!sucursalActiva} className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50"><Globe2 size={16} /> Factura global</button>
        <button type="button" onClick={() => setPanel('nueva')} disabled={!sucursalActiva} className="flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-3 py-2 text-sm hover:bg-emerald-700 disabled:opacity-50"><FilePlus2 size={16} /> Facturar a cliente</button>
      </div>
      {!sucursalActiva && <p className="text-sm text-amber-800">Elige una sucursal arriba para facturar.</p>}

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label>Desde <input type="date" className="ml-1 rounded-lg border border-slate-300 px-2 py-1" value={filtros.desde} max={filtros.hasta} onChange={e => cambiar('desde', e.target.value)} /></label>
        <label>Hasta <input type="date" className="ml-1 rounded-lg border border-slate-300 px-2 py-1" value={filtros.hasta} max={hoyLocal()} onChange={e => cambiar('hasta', e.target.value)} /></label>
        <label>Tipo
          <select className="ml-1 rounded-lg border border-slate-300 px-2 py-1" value={filtros.tipo} onChange={e => cambiar('tipo', e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(TIPOS_CFDI).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
        </label>
        <label className="relative flex-1 min-w-56">
          <Search size={16} className="absolute left-3 top-2 text-slate-400" aria-hidden="true" />
          <span className="sr-only">Buscar</span>
          <input className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-1" placeholder="RFC, razón social o UUID" value={filtros.q} onChange={e => cambiar('q', e.target.value)} />
        </label>
      </div>

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr>
            <th className="px-3 py-2">Folio</th><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Receptor</th>
            <th className="px-3 py-2">Pago</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2">Estado</th>
          </tr></thead>
          <tbody>
            {datos?.datos.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-slate-500">Sin facturas en el periodo.</td></tr>}
            {datos?.datos.map(f => (
              <tr key={f.id} onClick={() => setPanel(f.id)} className="border-t border-slate-100 cursor-pointer hover:bg-emerald-50">
                <td className="px-3 py-2 font-mono">{f.folioCompleto}</td>
                <td className="px-3 py-2">{formatearFecha(f.fechaTimbrado || f.creada, true)}</td>
                <td className="px-3 py-2">{TIPOS_CFDI[f.tipo]}{f.tipo === 'I' && <span className="text-xs text-slate-500"> · {MODALIDADES[f.modalidad]}</span>}</td>
                <td className="px-3 py-2">{f.receptor.razonSocial}<span className="block text-xs text-slate-500 font-mono">{f.receptor.rfc}</span></td>
                <td className="px-3 py-2">{f.tipo === 'P' ? '—' : `${f.metodoPago}${f.metodoPago === 'PPD' && f.saldo ? ` · saldo ${formatearDinero(f.saldo)}` : ''}`}</td>
                <td className="px-3 py-2 text-right tabular-nums">{f.tipo === 'P' ? formatearDinero(f.pago?.monto || 0) : formatearDinero(f.total)}</td>
                <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs ${COLOR[f.estado]}`}>{ESTADOS_FACTURA[f.estado]}</span>{f.pac === 'simulado' && <span className="ml-1 text-xs text-slate-500">prueba</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {panel === 'nueva' && <NuevaFactura alCerrar={() => setPanel(null)} alEmitir={f => cerrarYRecargar(f.id)} />}
      {panel === 'global' && <FacturaGlobal alCerrar={() => setPanel(null)} alEmitir={f => cerrarYRecargar(f.id)} />}
      {panel && panel !== 'nueva' && panel !== 'global' && <FacturaDetalle id={panel} alCerrar={() => setPanel(null)} alCambiar={cargar} alAbrir={setPanel} />}
    </section>
  );
}

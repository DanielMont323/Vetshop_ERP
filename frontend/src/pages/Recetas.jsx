import { useCallback, useEffect, useState } from 'react';
import { Paperclip, Plus, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { mensajeDeError, recetasAPI } from '../services/api';
import { NOMBRES_ESTADO_RECETA, formatearFecha } from '../utils/formato';
import RecetaFormulario from '../components/recetas/RecetaFormulario';
import RecetaDetalle from '../components/recetas/RecetaDetalle';

const FILTROS = [['', 'Todas'], ['pendiente', 'Pendientes'], ['validada', 'Validadas'], ['surtida', 'Surtidas'], ['cancelada', 'Canceladas']];

// Recetas de la sucursal activa: historial filtrable, captura, validación y archivo.
export default function Recetas() {
  const { sucursalActiva } = useAuth();
  const [estado, setEstado] = useState('');
  const [q, setQ] = useState('');
  const [lista, setLista] = useState({ datos: [], total: 0 });
  const [formulario, setFormulario] = useState(null); // null | 'nueva' | receta
  const [detalle, setDetalle] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const r = await recetasAPI.listar({ estado: estado || undefined, q: q.trim() || undefined, limite: 100 });
      setLista({ datos: r.data.datos, total: r.data.total });
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudieron cargar las recetas'));
    }
  }, [estado, q]);

  useEffect(() => {
    const t = setTimeout(cargar, 250);
    return () => clearTimeout(t);
  }, [cargar, sucursalActiva]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold mr-auto">Recetas</h2>
        <button type="button" onClick={() => setFormulario('nueva')} className="flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-3 py-2 hover:bg-emerald-700"><Plus size={18} /> Nueva receta</button>
      </div>
      <div className="flex flex-wrap gap-3 items-center">
        <label className="relative flex-1 min-w-60">
          <Search size={16} className="absolute left-3 top-3 text-slate-400" aria-hidden="true" />
          <span className="sr-only">Buscar</span>
          <input className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2" placeholder="Paciente, propietario, médico o cédula" value={q} onChange={e => setQ(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2" role="tablist">
          {FILTROS.map(([v, t]) => (
            <button key={v} type="button" role="tab" aria-selected={estado === v} onClick={() => setEstado(v)}
              className={`rounded-lg px-3 py-1.5 text-sm border ${estado === v ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-slate-300'}`}>{t}</button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr><th className="px-3 py-2">Folio</th><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Paciente</th><th className="px-3 py-2">Propietario</th><th className="px-3 py-2">Médico</th><th className="px-3 py-2">Medicamentos</th><th className="px-3 py-2">Estado</th></tr>
          </thead>
          <tbody>
            {lista.datos.map(r => (
              <tr key={r.id} onClick={() => setDetalle(r)} className="border-t border-slate-100 cursor-pointer hover:bg-emerald-50">
                <td className="px-3 py-2 font-mono">R-{r.folio}{r.archivo && <Paperclip size={12} className="inline ml-1 text-slate-500" aria-label="Con archivo" />}</td>
                <td className="px-3 py-2">{formatearFecha(r.fechaReceta)}</td>
                <td className="px-3 py-2">{r.paciente.nombre} <span className="text-slate-500">({r.paciente.especie})</span></td>
                <td className="px-3 py-2">{r.propietario.nombre}</td>
                <td className="px-3 py-2">{r.medico.nombre}</td>
                <td className="px-3 py-2">{r.partidas.map(p => p.nombre).join(', ')}</td>
                <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs ${NOMBRES_ESTADO_RECETA[r.estado].clase}`}>{NOMBRES_ESTADO_RECETA[r.estado].texto}</span></td>
              </tr>
            ))}
            {lista.datos.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No hay recetas.</td></tr>}
          </tbody>
        </table>
      </div>

      {formulario && (
        <RecetaFormulario receta={formulario === 'nueva' ? null : formulario} alCerrar={() => setFormulario(null)}
          alGuardar={r => { setFormulario(null); cargar(); setDetalle(r); }} />
      )}
      {detalle && !formulario && (
        <RecetaDetalle receta={detalle} alCerrar={() => setDetalle(null)} alCambiar={cargar} alEditar={r => { setDetalle(null); setFormulario(r); }} />
      )}
    </section>
  );
}

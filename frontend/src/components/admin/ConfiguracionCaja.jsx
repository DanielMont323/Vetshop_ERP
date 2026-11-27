import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { configuracionAPI, mensajeDeError } from '../../services/api';
import { centavosATexto, pesosACentavos } from '../../utils/formato';

// Administración → Caja (dueño): conceptos de gasto de caja y tope de gastos sin PIN por turno.
export default function ConfiguracionCaja() {
  const [conceptos, setConceptos] = useState([]);
  const [nuevo, setNuevo] = useState('');
  const [tope, setTope] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    configuracionAPI.obtener().then(r => {
      setConceptos(r.data.datos.caja.conceptosGasto);
      setTope(centavosATexto(r.data.datos.caja.topeGastoSinPin));
    }).catch(e => toast.error(mensajeDeError(e, 'No se pudo cargar la configuración')));
  }, []);

  const agregar = () => {
    const c = nuevo.trim();
    if (!c) return;
    if (conceptos.some(x => x.toLowerCase() === c.toLowerCase())) return toast.error('Ese concepto ya está');
    setConceptos([...conceptos, c]);
    setNuevo('');
  };

  const guardar = async e => {
    e.preventDefault();
    const centavos = pesosACentavos(tope || '0');
    if (Number.isNaN(centavos)) return toast.error('Tope en pesos, máximo 2 decimales');
    setGuardando(true);
    try {
      await configuracionAPI.actualizar({ caja: { conceptosGasto: conceptos, topeGastoSinPin: centavos } });
      toast.success('Configuración guardada');
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo guardar'));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <form onSubmit={guardar} className="bg-white rounded-xl shadow p-4 space-y-4 max-w-xl">
      <div>
        <h3 className="font-semibold">Gastos de caja</h3>
        <p className="text-sm text-slate-600">Conceptos que el cajero elige con un botón (mandadito, garrafón…). Los gastos salen del efectivo y aparecen en el corte.</p>
      </div>
      <ul className="flex flex-wrap gap-2">
        {conceptos.map(c => (
          <li key={c} className="flex items-center gap-1 rounded-full border border-slate-300 pl-3 pr-1 py-1 text-sm">
            {c}
            <button type="button" onClick={() => setConceptos(conceptos.filter(x => x !== c))} aria-label={`Quitar ${c}`} className="text-slate-500 p-0.5" disabled={conceptos.length === 1}><X size={14} /></button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Nuevo concepto" value={nuevo} onChange={e => setNuevo(e.target.value)} maxLength={40} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), agregar())} />
        <button type="button" onClick={agregar} className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"><Plus size={16} /> Agregar</button>
      </div>
      <label className="block text-sm"><span className="font-medium">Tope de gastos sin PIN por turno</span>
        <input className="mt-1 w-40 rounded-lg border border-slate-300 px-3 py-2 text-right tabular-nums" inputMode="decimal" value={tope} onChange={e => setTope(e.target.value)} />
        <span className="block text-xs text-slate-500 mt-1">Arriba de este monto, cada gasto pide tu usuario y PIN. Con $0, todos lo piden.</span></label>
      <button type="submit" disabled={guardando} className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">Guardar</button>
    </form>
  );
}

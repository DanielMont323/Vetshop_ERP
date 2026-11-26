import { useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cadenaFrioAPI, mensajeDeError } from '../../services/api';

const PRESETS = { refrigerador: { minimo: '2', maximo: '8' }, congelador: { minimo: '-25', maximo: '-15' } };
const num = t => Number(String(t).trim().replace(',', '.').replace('−', '-'));

// Alta o cambios de un equipo de frío (solo dueño).
export default function EquipoFormulario({ equipo, alCerrar, alGuardar }) {
  const [f, setF] = useState({
    nombre: equipo?.nombre || '', tipo: equipo?.tipo || 'refrigerador',
    minimo: String(equipo?.minimo ?? 2), maximo: String(equipo?.maximo ?? 8), lecturasPorDia: String(equipo?.lecturasPorDia ?? 2), activo: equipo?.activo ?? true
  });
  const [enviando, setEnviando] = useState(false);
  const cambiarTipo = tipo => setF({ ...f, tipo, ...(equipo ? {} : PRESETS[tipo]) });

  const enviar = async e => {
    e.preventDefault();
    const cuerpo = { nombre: f.nombre.trim(), tipo: f.tipo, minimo: num(f.minimo), maximo: num(f.maximo), lecturasPorDia: Number(f.lecturasPorDia), ...(equipo && { activo: f.activo }) };
    if ([cuerpo.minimo, cuerpo.maximo].some(Number.isNaN) || cuerpo.maximo <= cuerpo.minimo) return toast.error('Revisa el rango: el máximo debe ser mayor que el mínimo');
    setEnviando(true);
    try {
      if (equipo) await cadenaFrioAPI.actualizarEquipo(equipo.id, cuerpo);
      else await cadenaFrioAPI.crearEquipo(cuerpo);
      toast.success('Equipo guardado');
      alGuardar();
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo guardar el equipo'));
    } finally {
      setEnviando(false);
    }
  };

  const campo = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2';
  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true">
      <form onSubmit={enviar} className="bg-white rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{equipo ? equipo.nombre : 'Nuevo equipo de frío'}</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500"><X /></button>
        </div>
        <fieldset disabled={enviando} className="grid grid-cols-2 gap-3">
          <label className="col-span-2 block text-sm"><span className="font-medium">Nombre</span>
            <input className={campo} value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} required maxLength={60} placeholder="Refri vacunas" autoFocus /></label>
          <label className="block text-sm"><span className="font-medium">Tipo</span>
            <select className={campo} value={f.tipo} onChange={e => cambiarTipo(e.target.value)}>
              <option value="refrigerador">Refrigerador</option>
              <option value="congelador">Congelador</option>
            </select></label>
          <label className="block text-sm"><span className="font-medium">Lecturas por día</span>
            <input type="number" min={1} max={12} className={campo} value={f.lecturasPorDia} onChange={e => setF({ ...f, lecturasPorDia: e.target.value })} /></label>
          <label className="block text-sm"><span className="font-medium">Mínimo (°C)</span>
            <input className={campo} inputMode="decimal" value={f.minimo} onChange={e => setF({ ...f, minimo: e.target.value })} /></label>
          <label className="block text-sm"><span className="font-medium">Máximo (°C)</span>
            <input className={campo} inputMode="decimal" value={f.maximo} onChange={e => setF({ ...f, maximo: e.target.value })} /></label>
          {equipo && <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.activo} onChange={e => setF({ ...f, activo: e.target.checked })} /> Activo</label>}
        </fieldset>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Cancelar</button>
          <button type="submit" disabled={enviando} className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">Guardar</button>
        </div>
      </form>
    </div>
  );
}

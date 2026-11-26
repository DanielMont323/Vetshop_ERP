import { useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cadenaFrioAPI, mensajeDeError } from '../../services/api';

// "4.5" | "-18" | "4,5" → número con un decimal; null si vacío; NaN si inválido
function leerGrados(texto) {
  const limpio = String(texto).trim().replace(',', '.').replace('−', '-');
  if (limpio === '') return null;
  if (!/^-?\d{1,2}(\.\d)?$/.test(limpio)) return NaN;
  return Number(limpio);
}

// Registrar la temperatura de un equipo. Fuera de rango pide la acción correctiva y los productos afectados.
export default function LecturaFormulario({ equipo, alCerrar, alGuardar }) {
  const [texto, setTexto] = useState('');
  const [observacion, setObservacion] = useState('');
  const [accion, setAccion] = useState('');
  const [productos, setProductos] = useState('');
  const [enviando, setEnviando] = useState(false);

  const t = leerGrados(texto);
  const fuera = typeof t === 'number' && !Number.isNaN(t) && (t < equipo.minimo || t > equipo.maximo);
  let error = null;
  if (t === null) error = 'Escribe la temperatura';
  else if (Number.isNaN(t)) error = 'Temperatura en °C con máximo un decimal (p. ej. 4.5 o -18)';
  else if (fuera && accion.trim().length < 5) error = 'Fuera de rango: describe la acción correctiva';

  const enviar = async e => {
    e.preventDefault();
    if (error) return;
    setEnviando(true);
    try {
      await cadenaFrioAPI.registrar({
        equipo: equipo.id, temperatura: t, observacion: observacion.trim() || undefined,
        ...(fuera && { accionCorrectiva: accion.trim(), productosAfectados: productos.trim() || undefined })
      });
      toast.success(fuera ? 'Lectura fuera de rango registrada con su acción correctiva' : 'Lectura registrada');
      alGuardar();
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo registrar la lectura'), { duration: 6000 });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true">
      <form onSubmit={enviar} className="bg-white rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{equipo.nombre}</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500"><X /></button>
        </div>
        <p className="text-sm text-slate-600">Rango permitido: {equipo.minimo} a {equipo.maximo} °C</p>
        <fieldset disabled={enviando} className="space-y-3">
          <label className="block text-sm"><span className="font-medium">Temperatura (°C)</span>
            <input className={`mt-1 w-full rounded-lg border px-3 py-2 text-2xl text-right tabular-nums ${fuera ? 'border-red-400 text-red-700' : 'border-slate-300'}`} inputMode="decimal" value={texto} onChange={e => setTexto(e.target.value)} autoFocus placeholder="4.5" /></label>
          {fuera && (
            <div className="rounded-lg bg-red-50 p-3 space-y-2">
              <p className="text-sm font-medium text-red-800">Fuera de rango. Registra qué se hizo.</p>
              <textarea className="w-full rounded border border-slate-300 px-2 py-1 text-sm" rows={2} placeholder="Acción correctiva (p. ej. se cerró la puerta, se movieron las vacunas al otro refri)" value={accion} onChange={e => setAccion(e.target.value)} maxLength={500} />
              <textarea className="w-full rounded border border-slate-300 px-2 py-1 text-sm" rows={2} placeholder="Productos afectados (o «ninguno»)" value={productos} onChange={e => setProductos(e.target.value)} maxLength={500} />
              <p className="text-xs text-red-800">Si algún producto se dañó, dalo de baja en Existencias con el motivo «Cadena de frío».</p>
            </div>
          )}
          <label className="block text-sm"><span className="font-medium">Observación (opcional)</span>
            <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={observacion} onChange={e => setObservacion(e.target.value)} maxLength={300} placeholder="Apertura, cierre…" /></label>
        </fieldset>
        {error && texto && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Cancelar</button>
          <button type="submit" disabled={Boolean(error) || enviando} className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">{enviando ? 'Guardando…' : 'Registrar'}</button>
        </div>
      </form>
    </div>
  );
}

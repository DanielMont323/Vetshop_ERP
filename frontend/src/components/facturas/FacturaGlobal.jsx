import { useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { facturasAPI, mensajeDeError } from '../../services/api';
import { hoyLocal } from '../../utils/formato';
import { nuevaClaveOperacion } from '../../utils/caja';
import { useDialogo } from '../../contexts/DialogoContext';

const ayer = () => {
  const [a, m, d] = hoyLocal().split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d - 1)).toISOString().slice(0, 10);
};

// Factura global de público en general: las ventas de contado sin factura de días ya cerrados (un solo mes).
export default function FacturaGlobal({ alCerrar, alEmitir }) {
  const { confirmar } = useDialogo();
  const [periodicidad, setPeriodicidad] = useState('dia');
  const [desde, setDesde] = useState(ayer());
  const [hasta, setHasta] = useState(ayer());
  const [clave] = useState(nuevaClaveOperacion);
  const [enviando, setEnviando] = useState(false);

  let error = null;
  if (!desde || !hasta || desde > hasta) error = 'Revisa las fechas';
  else if (desde.slice(0, 7) !== hasta.slice(0, 7)) error = 'La factura global es de un solo mes';
  else if (hasta >= hoyLocal()) error = 'Solo días ya cerrados (hasta ayer)';

  const emitir = async e => {
    e.preventDefault();
    if (error || !(await confirmar(`Se facturarán a público en general todas las ventas de contado sin factura del ${desde} al ${hasta}. ¿Continuar?`, { textoAceptar: 'Timbrar global' }))) return;
    setEnviando(true);
    try {
      const { data } = await facturasAPI.global({ claveOperacion: clave, periodicidad, desde, hasta });
      toast.success(`Factura global ${data.datos.folioCompleto}: ${data.datos.ventas.length} ventas`);
      alEmitir(data.datos);
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo emitir la factura global'), { duration: 8000 });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true">
      <form onSubmit={emitir} className="bg-white rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Factura global</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500"><X /></button>
        </div>
        <p className="text-sm text-slate-600">Incluye las ventas de contado que nadie facturó (público en general). Las ventas a crédito se facturan a su cliente.</p>
        <fieldset disabled={enviando} className="grid grid-cols-2 gap-3">
          <label className="col-span-2 block text-sm"><span className="font-medium">Periodicidad</span>
            <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={periodicidad} onChange={e => setPeriodicidad(e.target.value)}>
              <option value="dia">Diaria</option><option value="semana">Semanal</option><option value="quincena">Quincenal</option><option value="mes">Mensual</option>
            </select></label>
          <label className="block text-sm"><span className="font-medium">Desde</span>
            <input type="date" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={desde} max={ayer()} onChange={e => setDesde(e.target.value)} /></label>
          <label className="block text-sm"><span className="font-medium">Hasta</span>
            <input type="date" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={hasta} max={ayer()} onChange={e => setHasta(e.target.value)} /></label>
        </fieldset>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Cancelar</button>
          <button type="submit" disabled={Boolean(error) || enviando} className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">{enviando ? 'Timbrando…' : 'Timbrar'}</button>
        </div>
      </form>
    </div>
  );
}

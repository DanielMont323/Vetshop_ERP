import { useState } from 'react';
import toast from 'react-hot-toast';
import { conteosAPI, mensajeDeError } from '../../services/api';
import { formatearDinero } from '../../utils/formato';

// Aplicar el conteo: el dueño autoriza con su PIN y se generan los ajustes de entrada y salida por lote.
export default function AplicarConteo({ conteo, alCerrar, alAplicar }) {
  const r = conteo.resumen;
  const [usuario, setUsuario] = useState('');
  const [pin, setPin] = useState('');
  const [enCero, setEnCero] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const enviar = async e => {
    e.preventDefault();
    setEnviando(true);
    try {
      const { data } = await conteosAPI.aplicar(conteo.id, { autorizacion: { usuario: usuario.trim(), pin }, noContadosEnCero: enCero });
      toast.success(`Conteo aplicado: ${data.datos.aplicacion.movimientos.length} ajuste(s)`);
      alAplicar(data.datos);
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo aplicar el conteo'), { duration: 6000 });
      setPin('');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true">
      <form onSubmit={enviar} className="bg-white rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-semibold">Aplicar conteo {conteo.folio}</h2>
        <ul className="text-sm space-y-1">
          <li>{r.conDiferencia} lote(s) con diferencia</li>
          <li>Faltante a costo: <b>{formatearDinero(r.faltante)}</b> · Sobrante a costo: <b>{formatearDinero(r.sobrante)}</b></li>
        </ul>
        {r.pendientes > 0 && (
          <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            <input type="checkbox" className="mt-1" checked={enCero} onChange={e => setEnCero(e.target.checked)} />
            <span>Quedan {r.pendientes} lote(s) sin contar. Márcalo para tomarlos como <b>cero</b> (saldrán del inventario); si no, vuelve a captura.</span>
          </label>
        )}
        <p className="text-sm text-slate-600">Se registrará una salida o entrada por cada lote con diferencia (motivo «Conteo físico»). No se puede deshacer.</p>
        <fieldset disabled={enviando} className="grid grid-cols-2 gap-2">
          <input className="rounded-lg border border-slate-300 px-3 py-2" placeholder="Usuario del dueño" aria-label="Usuario del dueño" value={usuario} onChange={e => setUsuario(e.target.value)} required autoComplete="off" />
          <input className="rounded-lg border border-slate-300 px-3 py-2" type="password" inputMode="numeric" placeholder="PIN" aria-label="PIN del dueño" value={pin} onChange={e => setPin(e.target.value)} required autoComplete="off" />
        </fieldset>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Volver</button>
          <button type="submit" disabled={enviando || (r.pendientes > 0 && !enCero)} className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">{enviando ? 'Aplicando…' : 'Aplicar ajustes'}</button>
        </div>
      </form>
    </div>
  );
}

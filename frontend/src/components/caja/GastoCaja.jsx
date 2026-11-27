import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { configuracionAPI, mensajeDeError, turnosAPI } from '../../services/api';
import { formatearDinero, pesosACentavos } from '../../utils/formato';

// Gasto de caja (mandadito, garrafón…): concepto con un botón, monto y detalle. Sin PIN mientras no pase del tope
// del turno; si lo pasa, el servidor responde AUTORIZACION_REQUERIDA y aquí se piden usuario y PIN del dueño.
export default function GastoCaja({ turnoId, alCerrar, alRegistrar }) {
  const [config, setConfig] = useState(null);
  const [concepto, setConcepto] = useState('');
  const [monto, setMonto] = useState('');
  const [detalle, setDetalle] = useState('');
  const [pidePin, setPidePin] = useState(null); // detalles del tope cuando hace falta PIN
  const [usuario, setUsuario] = useState('');
  const [pin, setPin] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    configuracionAPI.obtener().then(r => setConfig(r.data.datos.caja)).catch(e => toast.error(mensajeDeError(e, 'No se pudo cargar la configuración')));
  }, []);

  const centavos = pesosACentavos(monto);
  const error = !concepto ? 'Elige el concepto' : !centavos || Number.isNaN(centavos) ? 'Escribe el monto' : pidePin && (!usuario.trim() || !pin) ? 'Falta usuario y PIN del dueño' : null;

  const enviar = async e => {
    e.preventDefault();
    if (error) return;
    setEnviando(true);
    try {
      const { data } = await turnosAPI.retirar(turnoId, {
        tipo: 'gasto', concepto, monto: centavos, motivo: detalle.trim() || undefined,
        ...(pidePin && { autorizacion: { usuario: usuario.trim(), pin } })
      });
      toast.success(`Gasto registrado: ${data.datos.motivo} · ${formatearDinero(data.datos.monto)}`);
      alRegistrar?.(data.datos);
      alCerrar();
    } catch (err) {
      if (err.response?.data?.codigo === 'AUTORIZACION_REQUERIDA' && !pidePin) {
        setPidePin(err.response.data.detalles || {});
      } else {
        toast.error(mensajeDeError(err, 'No se pudo registrar el gasto'));
        setPin('');
      }
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true" onKeyDown={e => e.key === 'Escape' && alCerrar()}>
      <form onSubmit={enviar} className="bg-white rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Gasto de caja</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500"><X /></button>
        </div>
        {!config ? <p className="text-slate-500">Cargando…</p> : (
          <fieldset disabled={enviando} className="space-y-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Concepto">
              {config.conceptosGasto.map(c => (
                <button key={c} type="button" onClick={() => setConcepto(c)} aria-pressed={concepto === c}
                  className={`rounded-lg border px-3 py-2 text-sm ${concepto === c ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-300 hover:bg-slate-50'}`}>{c}</button>
              ))}
            </div>
            <label className="block text-sm"><span className="font-medium">Monto</span>
              <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-lg tabular-nums" inputMode="decimal" placeholder="$0.00" value={monto} onChange={e => setMonto(e.target.value)} autoFocus /></label>
            <label className="block text-sm"><span className="font-medium">Detalle (opcional)</span>
              <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={detalle} onChange={e => setDetalle(e.target.value)} maxLength={150} placeholder="¿Para qué fue?" /></label>
            <p className="text-xs text-slate-500">Hasta {formatearDinero(config.topeGastoSinPin)} por turno sin autorización del dueño.</p>
            {pidePin && (
              <div className="rounded-lg bg-amber-50 p-3 grid grid-cols-2 gap-2">
                <p className="col-span-2 text-sm text-amber-900">
                  Pasa del tope sin PIN (quedan {formatearDinero(pidePin.disponible ?? 0)} de {formatearDinero(pidePin.tope ?? config.topeGastoSinPin)}): autoriza el dueño.
                </p>
                <input className="rounded border border-slate-300 px-2 py-1" placeholder="Usuario del dueño" aria-label="Usuario del dueño" value={usuario} onChange={e => setUsuario(e.target.value)} autoComplete="off" />
                <input className="rounded border border-slate-300 px-2 py-1" type="password" inputMode="numeric" placeholder="PIN" aria-label="PIN del dueño" value={pin} onChange={e => setPin(e.target.value)} autoComplete="off" />
              </div>
            )}
          </fieldset>
        )}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Cancelar</button>
          <button type="submit" disabled={Boolean(error) || enviando} className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">{enviando ? 'Registrando…' : 'Registrar gasto'}</button>
        </div>
      </form>
    </div>
  );
}

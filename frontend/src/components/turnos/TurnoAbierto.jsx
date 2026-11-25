import { useState } from 'react';
import toast from 'react-hot-toast';
import { mensajeDeError, turnosAPI } from '../../services/api';
import { formatearDinero, formatearFecha, pesosACentavos } from '../../utils/formato';
import ConteoDenominaciones, { aDenominaciones, conteoVacio } from './ConteoDenominaciones';

const campo = 'rounded border border-slate-300 px-2 py-1.5';

// Turno abierto del cajero: datos, retiros de efectivo y corte ciego (sin mostrar lo esperado).
export default function TurnoAbierto({ turno, alCambiar, alContar }) {
  const [retiro, setRetiro] = useState({ monto: '', motivo: '', usuario: '', pin: '' });
  const [conteo, setConteo] = useState(conteoVacio);
  const [tarjeta, setTarjeta] = useState('');
  const [transferencia, setTransferencia] = useState('');
  const [enviando, setEnviando] = useState(false);

  const retirar = async e => {
    e.preventDefault();
    const monto = pesosACentavos(retiro.monto);
    if (!monto || Number.isNaN(monto)) return toast.error('Monto inválido');
    setEnviando(true);
    try {
      await turnosAPI.retirar(turno.id, { monto, motivo: retiro.motivo.trim(), autorizacion: { usuario: retiro.usuario.trim(), pin: retiro.pin } });
      toast.success('Retiro registrado');
      setRetiro({ monto: '', motivo: '', usuario: '', pin: '' });
      alCambiar();
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo registrar el retiro'));
      setRetiro(r => ({ ...r, pin: '' }));
    } finally {
      setEnviando(false);
    }
  };

  const contar = async e => {
    e.preventDefault();
    const { lista, error } = aDenominaciones(conteo);
    if (error) return toast.error(error);
    const t = pesosACentavos(tarjeta) ?? 0;
    const tr = pesosACentavos(transferencia) ?? 0;
    if (Number.isNaN(t) || Number.isNaN(tr)) return toast.error('Usa pesos con máximo 2 decimales');
    if (!window.confirm('El conteo se registra UNA sola vez y no se puede corregir. ¿Ya contaste todo?')) return;
    setEnviando(true);
    try {
      const r = await turnosAPI.contar(turno.id, { denominaciones: lista, tarjeta: t, transferencia: tr });
      alContar(r.data.datos);
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo registrar el conteo'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow p-4 grid sm:grid-cols-4 gap-3 text-sm">
        <div><p className="text-slate-500">Caja</p><p className="font-semibold">{turno.caja}</p></div>
        <div><p className="text-slate-500">Abierto</p><p className="font-semibold">{formatearFecha(turno.apertura.fecha, true)}</p></div>
        <div><p className="text-slate-500">Fondo inicial</p><p className="font-semibold tabular-nums">{formatearDinero(turno.apertura.fondo)}</p></div>
        <div><p className="text-slate-500">Ventas</p><p className="font-semibold">{turno.ventas ?? '—'}</p></div>
        {turno.retiros.length > 0 && (
          <div className="sm:col-span-4">
            <p className="text-slate-500">Retiros</p>
            {turno.retiros.map((r, i) => <p key={i}>{formatearFecha(r.fecha, true)} · {formatearDinero(r.monto)} · {r.motivo}</p>)}
          </div>
        )}
      </div>

      <form onSubmit={retirar} className="bg-white rounded-xl shadow p-4 space-y-2">
        <h3 className="font-semibold">Retiro de efectivo</h3>
        <fieldset disabled={enviando} className="grid sm:grid-cols-[8rem_1fr_10rem_6rem_auto] gap-2">
          <input className={campo} inputMode="decimal" placeholder="$ monto" aria-label="Monto del retiro" value={retiro.monto} onChange={e => setRetiro({ ...retiro, monto: e.target.value })} required />
          <input className={campo} placeholder="Motivo" aria-label="Motivo del retiro" value={retiro.motivo} onChange={e => setRetiro({ ...retiro, motivo: e.target.value })} required minLength={3} maxLength={200} />
          <input className={campo} placeholder="Usuario del dueño" aria-label="Usuario del dueño para el retiro" value={retiro.usuario} onChange={e => setRetiro({ ...retiro, usuario: e.target.value })} required autoComplete="off" />
          <input className={campo} type="password" inputMode="numeric" placeholder="PIN" aria-label="PIN del dueño para el retiro" value={retiro.pin} onChange={e => setRetiro({ ...retiro, pin: e.target.value })} required autoComplete="off" />
          <button type="submit" className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50">Retirar</button>
        </fieldset>
      </form>

      <form onSubmit={contar} className="bg-white rounded-xl shadow p-4 space-y-3">
        <h3 className="font-semibold">Corte de caja (conteo ciego)</h3>
        <p className="text-sm text-slate-600">Cuenta el efectivo de la caja (incluido el fondo) y captura los totales de la terminal y de las transferencias recibidas. No verás lo esperado hasta registrar el conteo.</p>
        <ConteoDenominaciones conteo={conteo} alCambiar={setConteo} deshabilitado={enviando} />
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block text-sm"><span className="font-medium">Total de la terminal (tarjeta)</span>
            <input className={`mt-1 w-full ${campo}`} inputMode="decimal" placeholder="$0.00" value={tarjeta} onChange={e => setTarjeta(e.target.value)} disabled={enviando} /></label>
          <label className="block text-sm"><span className="font-medium">Total de transferencias recibidas</span>
            <input className={`mt-1 w-full ${campo}`} inputMode="decimal" placeholder="$0.00" value={transferencia} onChange={e => setTransferencia(e.target.value)} disabled={enviando} /></label>
        </div>
        <button type="submit" disabled={enviando} className="w-full rounded-lg bg-emerald-600 text-white font-semibold py-2 hover:bg-emerald-700 disabled:opacity-60">Registrar conteo y hacer corte</button>
      </form>
    </div>
  );
}

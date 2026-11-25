import { useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { mensajeDeError, ventasAPI } from '../../services/api';
import { centavosATexto, formatearDinero, pesosACentavos } from '../../utils/formato';

const METODOS = [['efectivo', 'Efectivo'], ['tarjeta', 'Tarjeta'], ['transferencia', 'Transferencia']];

// Corrige la forma de pago de una venta (p. ej. se registró efectivo y era tarjeta).
// Requiere motivo y usuario + PIN del dueño; solo mientras el turno de la venta siga abierto.
export default function CorregirFormaPago({ venta, alCerrar, alGuardar }) {
  const inicial = Object.fromEntries(METODOS.map(([m]) => [m, centavosATexto(venta.pagos.filter(p => p.metodo === m).reduce((s, p) => s + p.monto, 0) || null)]));
  const [montos, setMontos] = useState(inicial);
  const [motivo, setMotivo] = useState('');
  const [usuario, setUsuario] = useState('');
  const [pin, setPin] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async e => {
    e.preventDefault();
    const pagos = [];
    for (const [m] of METODOS) {
      const c = pesosACentavos(montos[m]);
      if (Number.isNaN(c)) return toast.error('Usa pesos con máximo 2 decimales');
      if (c) pagos.push({ metodo: m, monto: c });
    }
    if (!pagos.length) return toast.error('Indica al menos un pago');
    setEnviando(true);
    try {
      await ventasAPI.cambiarFormaPago(venta.id, { pagos, motivo: motivo.trim(), autorizacion: { usuario: usuario.trim(), pin } });
      toast.success(`Forma de pago de ${venta.serie}-${venta.folio} corregida`);
      alGuardar();
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo corregir'));
      setPin('');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true">
      <form onSubmit={enviar} className="bg-white rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Corregir forma de pago · {venta.serie}-{venta.folio}</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500"><X /></button>
        </div>
        <p className="text-sm">Total de la venta: <strong>{formatearDinero(venta.total)}</strong>. Captura cómo se pagó realmente.</p>
        <fieldset disabled={enviando} className="space-y-2">
          {METODOS.map(([m, nombre]) => (
            <label key={m} className="grid grid-cols-[8rem_1fr] items-center gap-2 text-sm">
              {nombre}
              <input className="rounded border border-slate-300 px-2 py-1 text-right tabular-nums" inputMode="decimal" placeholder="$0.00" value={montos[m]} onChange={e => setMontos({ ...montos, [m]: e.target.value })} />
            </label>
          ))}
          <input className="w-full rounded border border-slate-300 px-2 py-1" placeholder="Motivo de la corrección" aria-label="Motivo de la corrección" value={motivo} onChange={e => setMotivo(e.target.value)} required minLength={3} maxLength={300} />
          <div className="rounded-lg bg-amber-50 p-3 grid grid-cols-2 gap-2">
            <p className="col-span-2 text-sm text-amber-900">Autorización del dueño</p>
            <input className="rounded border border-slate-300 px-2 py-1" placeholder="Usuario" aria-label="Usuario del dueño" value={usuario} onChange={e => setUsuario(e.target.value)} required autoComplete="off" />
            <input className="rounded border border-slate-300 px-2 py-1" type="password" inputMode="numeric" placeholder="PIN" aria-label="PIN del dueño" value={pin} onChange={e => setPin(e.target.value)} required autoComplete="off" />
          </div>
        </fieldset>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Volver</button>
          <button type="submit" disabled={enviando} className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">Guardar corrección</button>
        </div>
      </form>
    </div>
  );
}

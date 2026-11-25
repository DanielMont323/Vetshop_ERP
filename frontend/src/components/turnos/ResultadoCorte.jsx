import { useState } from 'react';
import { Printer } from 'lucide-react';
import toast from 'react-hot-toast';
import { mensajeDeError, turnosAPI } from '../../services/api';
import { formatearDinero, formatearFecha } from '../../utils/formato';
import { imprimirCorte } from '../../utils/caja';

const METODOS = [['efectivo', 'Efectivo'], ['tarjeta', 'Tarjeta (terminal)'], ['transferencia', 'Transferencias']];

function Diferencia({ valor }) {
  if (valor === 0) return <span className="text-emerald-700 font-medium">Cuadra</span>;
  return <span className="text-red-700 font-semibold">{valor > 0 ? `Sobra ${formatearDinero(valor)}` : `Falta ${formatearDinero(-valor)}`}</span>;
}

// Resultado del corte: esperado vs contado por forma de pago. Si hay diferencia y sigue "contado",
// pide justificación + usuario y PIN del dueño para cerrar.
export default function ResultadoCorte({ turno, alCerrar }) {
  const [justificacion, setJustificacion] = useState('');
  const [usuario, setUsuario] = useState('');
  const [pin, setPin] = useState('');
  const [enviando, setEnviando] = useState(false);
  const c = turno.conteo;

  const cerrar = async e => {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await turnosAPI.cerrar(turno.id, { justificacion: justificacion.trim(), autorizacion: { usuario: usuario.trim(), pin } });
      toast.success('Turno cerrado con la diferencia autorizada');
      alCerrar(r.data.datos);
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo cerrar el turno'));
      setPin('');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Corte de caja {turno.caja ? `· Caja ${turno.caja}` : ''} · {turno.cajero.nombre}</h3>
        <button type="button" onClick={() => imprimirCorte(turno.id).catch(e => toast.error(mensajeDeError(e, 'No se pudo imprimir')))} className="flex items-center gap-1 text-sm text-emerald-700 underline">
          <Printer size={14} /> Imprimir corte
        </button>
      </div>
      <p className="text-sm text-slate-600">
        Conteo: {formatearFecha(c.fecha, true)} · {c.ventas} venta{c.ventas === 1 ? '' : 's'} · {c.canceladas} cancelada{c.canceladas === 1 ? '' : 's'}
      </p>
      <table className="w-full text-sm">
        <thead className="bg-slate-100 text-left">
          <tr><th className="px-3 py-2">Forma de pago</th><th className="px-3 py-2 text-right">Esperado</th><th className="px-3 py-2 text-right">Contado</th><th className="px-3 py-2 text-right">Diferencia</th></tr>
        </thead>
        <tbody>
          {METODOS.map(([m, nombre]) => (
            <tr key={m} className="border-t border-slate-100">
              <td className="px-3 py-2">{nombre}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatearDinero(c.esperado[m])}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatearDinero(c.contado[m])}</td>
              <td className="px-3 py-2 text-right"><Diferencia valor={c.diferencias[m]} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      {turno.estado === 'cerrado' && turno.cierre?.justificacion && (
        <p className="text-sm">Cerrado con diferencia. Justificación: <em>{turno.cierre.justificacion}</em> · Autorizó {turno.cierre.autorizadoPorNombre}</p>
      )}
      {turno.estado === 'cerrado' && !turno.cierre?.justificacion && <p className="text-sm text-emerald-700">Todo cuadró: el turno quedó cerrado.</p>}

      {turno.estado === 'contado' && (
        <form onSubmit={cerrar} className="rounded-lg bg-amber-50 p-3 space-y-2">
          <p className="text-sm text-amber-900">Hay diferencia. Para cerrar el turno explica qué pasó y que autorice el dueño.</p>
          <textarea className="w-full rounded border border-slate-300 px-2 py-1" rows={2} placeholder="¿Qué pasó?" aria-label="Justificación" value={justificacion} onChange={e => setJustificacion(e.target.value)} required minLength={5} maxLength={500} />
          <div className="grid sm:grid-cols-[1fr_8rem_auto] gap-2">
            <input className="rounded border border-slate-300 px-2 py-1" placeholder="Usuario del dueño" aria-label="Usuario del dueño" value={usuario} onChange={e => setUsuario(e.target.value)} required autoComplete="off" />
            <input className="rounded border border-slate-300 px-2 py-1" type="password" inputMode="numeric" placeholder="PIN" aria-label="PIN del dueño" value={pin} onChange={e => setPin(e.target.value)} required autoComplete="off" />
            <button type="submit" disabled={enviando} className="rounded-lg bg-emerald-600 text-white px-4 py-1.5 hover:bg-emerald-700 disabled:opacity-60">Cerrar turno</button>
          </div>
        </form>
      )}
    </div>
  );
}

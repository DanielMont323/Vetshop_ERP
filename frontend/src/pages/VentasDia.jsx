import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Printer, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { mensajeDeError, ventasAPI } from '../services/api';
import { formatearDinero, formatearFecha, hoyLocal } from '../utils/formato';
import { imprimirNota, imprimirTicket } from '../utils/caja';
import CorregirFormaPago from '../components/caja/CorregirFormaPago';

const METODOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', credito: 'A crédito', puntos: 'Puntos' };

// Ventas: el cajero ve las suyas de hoy; el dueño elige el día y ve todas (con margen).
export default function VentasDia() {
  const { puede, sucursalActiva } = useAuth();
  const verTodas = puede('ventas:ver_todas');
  const [dia, setDia] = useState(hoyLocal());
  const [ventas, setVentas] = useState([]);
  const [cancelando, setCancelando] = useState(null);
  const [corrigiendo, setCorrigiendo] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const r = await ventasAPI.listar({ ...(verTodas && { desde: dia, hasta: dia }), limite: 200 });
      setVentas(r.data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudieron cargar las ventas'));
    }
  }, [dia, verTodas]);

  useEffect(() => {
    cargar();
  }, [cargar, sucursalActiva]);

  // La lista no trae los pagos: se piden al abrir la corrección
  const abrirCorreccion = async id => {
    try {
      setCorrigiendo((await ventasAPI.obtener(id)).data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo abrir la venta'));
    }
  };

  const cobradas = ventas.filter(v => v.estado === 'cobrada');
  const total = cobradas.reduce((s, v) => s + v.total, 0);
  const costo = cobradas.reduce((s, v) => s + (v.costo || 0), 0);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold mr-auto">{verTodas ? 'Ventas' : 'Mis ventas de hoy'}</h2>
        {verTodas && <input type="date" className="rounded-lg border border-slate-300 px-3 py-2" value={dia} max={hoyLocal()} onChange={e => setDia(e.target.value)} aria-label="Día" />}
        <Link to="/caja" className="rounded-lg bg-emerald-600 text-white px-3 py-2 hover:bg-emerald-700">Ir a caja</Link>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl shadow p-4"><p className="text-sm text-slate-500">Ventas cobradas</p><p className="text-2xl font-semibold">{cobradas.length}</p></div>
        <div className="bg-white rounded-xl shadow p-4"><p className="text-sm text-slate-500">Total</p><p className="text-2xl font-semibold tabular-nums">{formatearDinero(total)}</p></div>
        {verTodas && <div className="bg-white rounded-xl shadow p-4"><p className="text-sm text-slate-500">Costo de lo vendido</p><p className="text-2xl font-semibold tabular-nums">{formatearDinero(costo)}</p></div>}
      </div>

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="px-3 py-2">Folio</th><th className="px-3 py-2">Hora</th><th className="px-3 py-2">Cliente</th>
              {verTodas && <th className="px-3 py-2">Cajero</th>}
              <th className="px-3 py-2">Pago</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {ventas.map(v => (
              <tr key={v.id} className={`border-t border-slate-100 ${v.estado === 'cancelada' ? 'text-slate-400' : ''}`}>
                <td className="px-3 py-2 font-mono">{v.serie}-{v.folio}</td>
                <td className="px-3 py-2">{formatearFecha(v.fecha, true).split(', ')[1]}</td>
                <td className="px-3 py-2">{v.cliente.nombre}</td>
                {verTodas && <td className="px-3 py-2">{v.cajero.nombre}</td>}
                <td className="px-3 py-2">{v.metodos.map(m => METODOS[m]).join(' + ')}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${v.estado === 'cancelada' ? 'line-through' : ''}`}>{formatearDinero(v.total)}</td>
                <td className="px-3 py-2">{v.estado === 'cancelada' ? <span className="rounded px-2 py-0.5 text-xs bg-red-100 text-red-800">Cancelada</span> : 'Cobrada'}</td>
                <td className="px-3 py-2 flex gap-2 justify-end">
                  <button type="button" onClick={() => imprimirTicket(v.id).catch(e => toast.error(mensajeDeError(e, 'No se pudo imprimir')))} aria-label={`Reimprimir ticket ${v.folio}`} className="text-slate-500 hover:text-slate-800"><Printer size={16} /></button>
                  <button type="button" onClick={() => imprimirNota(v.id).catch(e => toast.error(mensajeDeError(e, 'No se pudo imprimir')))} aria-label={`Nota de venta ${v.folio}`} title="Nota de venta (hoja carta)" className="text-slate-500 hover:text-slate-800"><FileText size={16} /></button>
                  {v.estado === 'cobrada' && puede('ventas:cobrar') && (
                    <>
                      <button type="button" onClick={() => abrirCorreccion(v.id)} className="text-xs text-slate-700 underline">Forma de pago</button>
                      <button type="button" onClick={() => setCancelando(v)} className="text-xs text-red-700 underline">Cancelar</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {ventas.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">No hay ventas.</td></tr>}
          </tbody>
        </table>
      </div>

      {corrigiendo && <CorregirFormaPago venta={corrigiendo} alCerrar={() => setCorrigiendo(null)} alGuardar={() => { setCorrigiendo(null); cargar(); }} />}
      {cancelando && <CancelarVenta venta={cancelando} alCerrar={() => setCancelando(null)} alCancelar={() => { setCancelando(null); cargar(); }} />}
    </section>
  );
}

function CancelarVenta({ venta, alCerrar, alCancelar }) {
  const [motivo, setMotivo] = useState('');
  const [usuario, setUsuario] = useState('');
  const [pin, setPin] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async e => {
    e.preventDefault();
    setEnviando(true);
    try {
      await ventasAPI.cancelar(venta.id, { motivo: motivo.trim(), autorizacion: { usuario: usuario.trim(), pin } });
      toast.success(`Venta ${venta.serie}-${venta.folio} cancelada; la mercancía regresó al inventario`);
      alCancelar();
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo cancelar'));
      setPin('');
    } finally {
      setEnviando(false);
    }
  };

  const campo = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2';
  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true">
      <form onSubmit={enviar} className="bg-white rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Cancelar venta {venta.serie}-{venta.folio}</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500"><X /></button>
        </div>
        <p className="text-sm">Total {formatearDinero(venta.total)}. La mercancía regresa a sus lotes y el dinero se devuelve al cliente.</p>
        <fieldset disabled={enviando} className="space-y-3">
          <label className="block"><span className="text-sm font-medium">Motivo</span>
            <input className={campo} value={motivo} onChange={e => setMotivo(e.target.value)} required minLength={3} maxLength={300} autoFocus /></label>
          <div className="rounded-lg bg-amber-50 p-3 grid grid-cols-2 gap-2">
            <p className="col-span-2 text-sm text-amber-900">Autorización del dueño</p>
            <input className="rounded border border-slate-300 px-2 py-1" placeholder="Usuario" aria-label="Usuario del dueño" value={usuario} onChange={e => setUsuario(e.target.value)} required autoComplete="off" />
            <input className="rounded border border-slate-300 px-2 py-1" type="password" inputMode="numeric" placeholder="PIN" aria-label="PIN del dueño" value={pin} onChange={e => setPin(e.target.value)} required autoComplete="off" />
          </div>
        </fieldset>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Volver</button>
          <button type="submit" disabled={enviando} className="rounded-lg bg-red-600 text-white px-4 py-2 hover:bg-red-700 disabled:opacity-60">{enviando ? 'Cancelando…' : 'Cancelar venta'}</button>
        </div>
      </form>
    </div>
  );
}

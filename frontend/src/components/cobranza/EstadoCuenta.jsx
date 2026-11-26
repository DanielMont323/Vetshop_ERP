import { useCallback, useEffect, useState } from 'react';
import { Plus, Printer, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cobranzaAPI, mensajeDeError } from '../../services/api';
import { formatearDinero, formatearFecha } from '../../utils/formato';
import { imprimirAbono, imprimirEstadoCuenta } from '../../utils/caja';
import AbonoFormulario from './AbonoFormulario';

const METODOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' };

// Estado de cuenta de un cliente: resumen, ventas pendientes, movimientos, abonar e imprimir.
export default function EstadoCuenta({ clienteId, alCambiar, alCerrar }) {
  const [ec, setEc] = useState(null);
  const [abonando, setAbonando] = useState(false);
  const [cancelando, setCancelando] = useState(null);

  const cargar = useCallback(async () => {
    try {
      setEc((await cobranzaAPI.estadoCuenta(clienteId)).data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo cargar el estado de cuenta'));
    }
  }, [clienteId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const actualizar = () => {
    cargar();
    alCambiar?.();
  };

  if (!ec) return <p className="text-slate-500">Cargando estado de cuenta…</p>;
  const r = ec.resumen;
  const imprimir = () => imprimirEstadoCuenta(clienteId).catch(e => toast.error(mensajeDeError(e, 'No se pudo imprimir')));

  return (
    <div className="bg-white rounded-xl shadow p-4 space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h3 className="text-lg font-semibold">{ec.cliente.nombre}</h3>
          <p className="text-sm text-slate-600">
            {ec.credito.activo ? `Crédito a ${ec.credito.dias} días` : 'Crédito desactivado'}
            {ec.credito.bonificacionProntoPago > 0 && ` · ${ec.credito.bonificacionProntoPago / 100} % de bonificación si liquida en ${ec.credito.diasProntoPago} días`}
          </p>
        </div>
        <button type="button" onClick={imprimir} className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"><Printer size={16} /> Imprimir</button>
        <button type="button" onClick={() => setAbonando(true)} disabled={r.saldo === 0} className="flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-3 py-2 text-sm hover:bg-emerald-700 disabled:opacity-50"><Plus size={16} /> Registrar abono</button>
        <button type="button" onClick={alCerrar} aria-label="Cerrar estado de cuenta" className="text-slate-500 p-2"><X size={18} /></button>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[['Límite', r.limite], ['Saldo', r.saldo], ['Vencido', r.vencido, r.vencido > 0], ['Disponible', r.disponible]].map(([t, v, alerta]) => (
          <div key={t} className={`rounded-lg border p-3 ${alerta ? 'border-red-200 bg-red-50' : 'border-slate-200'}`}>
            <dt className="text-xs text-slate-500">{t}</dt>
            <dd className={`text-xl font-semibold tabular-nums ${alerta ? 'text-red-700' : ''}`}>{formatearDinero(v)}</dd>
          </div>
        ))}
      </dl>

      <div>
        <h4 className="font-medium mb-1">Ventas pendientes de pago</h4>
        {ec.pendientes.length === 0 ? <p className="text-sm text-slate-500">Sin saldo pendiente.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left"><tr>
                <th className="px-3 py-2">Venta</th><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Vence</th>
                <th className="px-3 py-2 text-right">Importe</th><th className="px-3 py-2 text-right">Saldo</th><th className="px-3 py-2 text-right">Para liquidar hoy</th>
              </tr></thead>
              <tbody>
                {ec.pendientes.map(c => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono">{c.folio}</td>
                    <td className="px-3 py-2">{formatearFecha(c.fecha)}</td>
                    <td className={`px-3 py-2 ${c.diasVencido > 0 ? 'text-red-700 font-medium' : ''}`}>{formatearFecha(c.vencimiento)}{c.diasVencido > 0 && ` · ${c.diasVencido} días vencido`}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatearDinero(c.importe)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatearDinero(c.saldo)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatearDinero(c.paraLiquidar)}
                      {c.bonificacionHoy > 0 && <span className="block text-xs text-emerald-700">bonificación {formatearDinero(c.bonificacionHoy)} hasta {formatearFecha(c.prontoPago.fechaLimite)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h4 className="font-medium mb-1">Movimientos</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left"><tr>
              <th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Folio</th><th className="px-3 py-2">Concepto</th>
              <th className="px-3 py-2 text-right">Cargo</th><th className="px-3 py-2 text-right">Abono</th><th className="px-3 py-2 text-right">Saldo</th><th />
            </tr></thead>
            <tbody>
              {ec.movimientos.length === 0 && <tr><td colSpan={7} className="px-3 py-3 text-slate-500">Sin movimientos.</td></tr>}
              {[...ec.movimientos].reverse().map(m => (
                <tr key={`${m.tipo}-${m.id}`} className={`border-t border-slate-100 ${m.cancelado ? 'text-slate-400 line-through' : ''}`}>
                  <td className="px-3 py-2">{formatearFecha(m.fecha, true)}</td>
                  <td className="px-3 py-2 font-mono">{m.folio}</td>
                  <td className="px-3 py-2">
                    {m.tipo === 'cargo' ? 'Venta a crédito' : `Abono (${METODOS[m.metodo]}${m.referencia ? ` ${m.referencia}` : ''})`}
                    {m.bonificacion > 0 && <span className="block text-xs text-emerald-700">Bonificación pronto pago {formatearDinero(m.bonificacion)}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.cargo ? formatearDinero(m.cargo) : ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.abono ? formatearDinero(m.abono) : ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatearDinero(m.saldo)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap no-underline">
                    {m.tipo === 'abono' && (
                      <>
                        <button type="button" onClick={() => imprimirAbono(m.id).catch(e => toast.error(mensajeDeError(e, 'No se pudo imprimir')))} className="text-emerald-700 underline text-xs mr-2">Comprobante</button>
                        {!m.cancelado && <button type="button" onClick={() => setCancelando(m)} className="text-red-700 underline text-xs">Cancelar</button>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {abonando && <AbonoFormulario estado={ec} alCerrar={() => setAbonando(false)} alRegistrar={() => { setAbonando(false); actualizar(); }} />}
      {cancelando && <CancelarAbono abono={cancelando} alCerrar={() => setCancelando(null)} alCancelar={() => { setCancelando(null); actualizar(); }} />}
    </div>
  );
}

function CancelarAbono({ abono, alCerrar, alCancelar }) {
  const [motivo, setMotivo] = useState('');
  const [usuario, setUsuario] = useState('');
  const [pin, setPin] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async e => {
    e.preventDefault();
    setEnviando(true);
    try {
      await cobranzaAPI.cancelarAbono(abono.id, { motivo: motivo.trim(), autorizacion: { usuario: usuario.trim(), pin } });
      toast.success(`Abono ${abono.folio} cancelado`);
      alCancelar();
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo cancelar el abono'), { duration: 6000 });
      setPin('');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true">
      <form onSubmit={enviar} className="bg-white rounded-xl shadow-lg w-full max-w-md p-6 space-y-3">
        <h2 className="text-lg font-semibold">Cancelar abono {abono.folio} · {formatearDinero(abono.abono)}</h2>
        <p className="text-sm text-slate-600">El saldo vuelve a quedar pendiente. Solo se puede mientras siga abierto el turno en que se recibió.</p>
        <fieldset disabled={enviando} className="space-y-3">
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Motivo" aria-label="Motivo" value={motivo} onChange={e => setMotivo(e.target.value)} required minLength={3} maxLength={300} />
          <div className="grid grid-cols-2 gap-2">
            <input className="rounded-lg border border-slate-300 px-3 py-2" placeholder="Usuario del dueño" aria-label="Usuario del dueño" value={usuario} onChange={e => setUsuario(e.target.value)} required autoComplete="off" />
            <input className="rounded-lg border border-slate-300 px-3 py-2" type="password" inputMode="numeric" placeholder="PIN" aria-label="PIN del dueño" value={pin} onChange={e => setPin(e.target.value)} required autoComplete="off" />
          </div>
        </fieldset>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Volver</button>
          <button type="submit" disabled={enviando} className="rounded-lg bg-red-600 text-white px-4 py-2 hover:bg-red-700 disabled:opacity-60">Cancelar abono</button>
        </div>
      </form>
    </div>
  );
}

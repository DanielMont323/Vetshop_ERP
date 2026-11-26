import { useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cobranzaAPI, mensajeDeError } from '../../services/api';
import { centavosATexto, formatearDinero, pesosACentavos } from '../../utils/formato';
import { imprimirAbono, nuevaClaveOperacion } from '../../utils/caja';

// Registrar un abono. Se aplica a las ventas que vencen primero; si con él se liquida una venta dentro del
// plazo de pronto pago, el servidor aplica la bonificación. Efectivo y tarjeta entran al corte del turno.
export default function AbonoFormulario({ estado, alCerrar, alRegistrar }) {
  const totalLiquidar = estado.pendientes.reduce((s, c) => s + c.paraLiquidar, 0);
  const bonificacionTotal = estado.pendientes.reduce((s, c) => s + c.bonificacionHoy, 0);
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState('efectivo');
  const [referencia, setReferencia] = useState('');
  const [imprimir, setImprimir] = useState(true);
  const [clave] = useState(nuevaClaveOperacion);
  const [enviando, setEnviando] = useState(false);

  const centavos = pesosACentavos(monto);
  let error = null;
  if (centavos === null || centavos === 0) error = 'Indica el monto';
  else if (Number.isNaN(centavos)) error = 'Usa pesos con máximo 2 decimales';
  else if (centavos > totalLiquidar) error = `Lo máximo que se puede abonar hoy es ${formatearDinero(totalLiquidar)}`;

  const enviar = async e => {
    e.preventDefault();
    if (error) return;
    setEnviando(true);
    try {
      const r = await cobranzaAPI.abonar({ claveOperacion: clave, cliente: estado.cliente.id, monto: centavos, metodo, referencia: referencia.trim() || undefined });
      const abono = r.data.datos;
      toast.success(`Abono ${abono.serie}-${abono.folio} registrado${abono.bonificacion ? ` · bonificación ${formatearDinero(abono.bonificacion)}` : ''}`, { duration: 6000 });
      if (imprimir) imprimirAbono(abono.id).catch(() => toast.error('No se pudo imprimir el comprobante'));
      alRegistrar(abono);
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo registrar el abono'), { duration: 6000 });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true">
      <form onSubmit={enviar} className="bg-white rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Abono de {estado.cliente.nombre}</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500"><X /></button>
        </div>
        <p className="text-sm text-slate-600">
          Saldo {formatearDinero(estado.resumen.saldo)}. Para liquidar todo hoy: <b>{formatearDinero(totalLiquidar)}</b>
          {bonificacionTotal > 0 && <span className="text-emerald-700"> (incluye {formatearDinero(bonificacionTotal)} de bonificación por pronto pago)</span>}
        </p>
        <fieldset disabled={enviando} className="space-y-3">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <label className="block text-sm"><span className="font-medium">Monto</span>
              <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-lg tabular-nums" inputMode="decimal" placeholder="$0.00" value={monto} onChange={e => setMonto(e.target.value)} autoFocus /></label>
            <button type="button" onClick={() => setMonto(centavosATexto(totalLiquidar))} className="self-end rounded-lg border border-slate-300 px-3 py-2 text-sm">Liquidar todo</button>
          </div>
          <label className="block text-sm"><span className="font-medium">Forma de pago</span>
            <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={metodo} onChange={e => setMetodo(e.target.value)}>
              <option value="efectivo">Efectivo</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="transferencia">Transferencia</option>
            </select></label>
          {metodo !== 'efectivo' && (
            <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder={metodo === 'tarjeta' ? 'Últimos 4 dígitos / autorización' : 'Folio de la transferencia'} value={referencia} onChange={e => setReferencia(e.target.value)} maxLength={40} />
          )}
          <p className="text-xs text-slate-500">{metodo === 'transferencia' ? 'Si tienes turno abierto, entra a tu corte como transferencia.' : 'Entra al corte de tu turno.'}</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={imprimir} onChange={e => setImprimir(e.target.checked)} /> Imprimir comprobante</label>
        </fieldset>
        {error && monto && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Cancelar</button>
          <button type="submit" disabled={Boolean(error) || enviando} className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">{enviando ? 'Registrando…' : 'Registrar abono'}</button>
        </div>
      </form>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { centavosATexto, formatearDinero, pesosACentavos } from '../../utils/formato';

const campo = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-lg tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-500';

// Captura de pagos (mixtos). El cambio solo sale del efectivo. F12 o Enter cobra; Esc cierra.
// Si el cliente tiene crédito, aparece «A crédito» (lo que queda a su cuenta). Si el servidor responde que
// rebasa el límite o tiene vencido (creditoPendiente), se pide el PIN del dueño y se vuelve a cobrar.
export default function PanelCobro({ total, cliente, pideAutorizacion, creditoPendiente, cobrando, alCobrar, alCerrar }) {
  const conCredito = Boolean(cliente?.credito?.activo);
  const [efectivo, setEfectivo] = useState(centavosATexto(total));
  const [tarjeta, setTarjeta] = useState('');
  const [refTarjeta, setRefTarjeta] = useState('');
  const [transferencia, setTransferencia] = useState('');
  const [refTransferencia, setRefTransferencia] = useState('');
  const [credito, setCredito] = useState('');
  const [autorizador, setAutorizador] = useState('');
  const [pin, setPin] = useState('');
  const [autorizadorCredito, setAutorizadorCredito] = useState('');
  const [pinCredito, setPinCredito] = useState('');
  const primero = useRef(null);

  useEffect(() => {
    primero.current?.select();
  }, []);

  const montos = {
    efectivo: pesosACentavos(efectivo) ?? 0,
    tarjeta: pesosACentavos(tarjeta) ?? 0,
    transferencia: pesosACentavos(transferencia) ?? 0,
    credito: conCredito ? pesosACentavos(credito) ?? 0 : 0
  };
  const invalido = Object.values(montos).some(Number.isNaN);
  const otros = montos.tarjeta + montos.transferencia + montos.credito;
  const pagado = montos.efectivo + otros;
  const falta = Math.max(0, total - pagado);
  const cambio = Math.max(0, pagado - total);
  let error = null;
  if (invalido) error = 'Usa pesos con máximo 2 decimales';
  else if (falta > 0) error = `Faltan ${formatearDinero(falta)}`;
  else if (otros > total) error = 'Tarjeta, transferencia y crédito no pueden exceder el total';
  else if (pideAutorizacion && (!autorizador.trim() || !pin)) error = 'El descuento necesita usuario y PIN del dueño';
  else if (creditoPendiente && montos.credito > 0 && (!autorizadorCredito.trim() || !pinCredito)) error = 'El crédito necesita usuario y PIN del dueño';

  const cobrar = () => {
    if (error || cobrando) return;
    const pagos = [
      montos.efectivo > 0 && { metodo: 'efectivo', monto: montos.efectivo },
      montos.tarjeta > 0 && { metodo: 'tarjeta', monto: montos.tarjeta, referencia: refTarjeta.trim() || undefined },
      montos.transferencia > 0 && { metodo: 'transferencia', monto: montos.transferencia, referencia: refTransferencia.trim() || undefined },
      montos.credito > 0 && { metodo: 'credito', monto: montos.credito }
    ].filter(Boolean);
    alCobrar(
      pagos,
      pideAutorizacion ? { usuario: autorizador.trim(), pin } : undefined,
      creditoPendiente && montos.credito > 0 ? { usuario: autorizadorCredito.trim(), pin: pinCredito } : undefined
    );
  };

  const teclas = e => {
    if (e.key === 'F12' || (e.key === 'Enter' && e.target.tagName === 'INPUT')) {
      e.preventDefault();
      cobrar();
    } else if (e.key === 'Escape') {
      alCerrar();
    }
  };

  // "Exacto": el método elegido cubre lo que falta
  const exacto = (setter, actual) => setter(centavosATexto((pesosACentavos(actual) || 0) + falta));
  const todoACredito = () => {
    setEfectivo('');
    setTarjeta('');
    setTransferencia('');
    setCredito(centavosATexto(total));
  };

  const filas = [
    ['Efectivo', efectivo, setEfectivo, null, null, primero],
    ['Tarjeta', tarjeta, setTarjeta, refTarjeta, setRefTarjeta],
    ['Transferencia', transferencia, setTransferencia, refTransferencia, setRefTransferencia],
    conCredito && ['A crédito', credito, setCredito]
  ].filter(Boolean);

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true" onKeyDown={teclas}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Cobrar</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500 hover:text-slate-800"><X /></button>
        </div>
        <p className="text-center text-4xl font-bold tabular-nums">{formatearDinero(total)}</p>
        {conCredito && (
          <div className="flex items-center justify-between rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
            <span>{cliente.nombre} tiene crédito a {cliente.credito.dias} días</span>
            <button type="button" onClick={todoACredito} className="rounded border border-sky-300 bg-white px-2 py-1 text-xs font-medium">Todo a crédito</button>
          </div>
        )}

        <fieldset disabled={cobrando} className="space-y-3">
          {filas.map(([texto, valor, setValor, ref, setRef, refInput]) => (
            <div key={texto} className="grid grid-cols-[7rem_1fr_auto] gap-2 items-center">
              <label htmlFor={`pago-${texto}`} className="font-medium">{texto}</label>
              <input id={`pago-${texto}`} ref={refInput} className={campo} inputMode="decimal" placeholder="$0.00" value={valor} onChange={e => setValor(e.target.value)} />
              <button type="button" onClick={() => exacto(setValor, valor)} className="rounded border border-slate-300 px-2 py-1 text-xs">Exacto</button>
              {setRef && (pesosACentavos(valor) || 0) > 0 && (
                <input className="col-start-2 rounded border border-slate-300 px-2 py-1 text-sm" placeholder={texto === 'Tarjeta' ? 'Últimos 4 dígitos / autorización' : 'Folio de la transferencia'} value={ref} onChange={e => setRef(e.target.value)} maxLength={40} />
              )}
            </div>
          ))}

          {pideAutorizacion && (
            <div className="rounded-lg bg-amber-50 p-3 grid grid-cols-2 gap-2">
              <p className="col-span-2 text-sm text-amber-900">La venta tiene descuento: autoriza el dueño</p>
              <input className="rounded border border-slate-300 px-2 py-1" placeholder="Usuario del dueño" aria-label="Usuario del dueño" value={autorizador} onChange={e => setAutorizador(e.target.value)} autoComplete="off" />
              <input className="rounded border border-slate-300 px-2 py-1" type="password" inputMode="numeric" placeholder="PIN" aria-label="PIN del dueño" value={pin} onChange={e => setPin(e.target.value)} autoComplete="off" />
            </div>
          )}

          {creditoPendiente && montos.credito > 0 && (
            <div className="rounded-lg bg-amber-50 p-3 grid grid-cols-2 gap-2">
              <p className="col-span-2 text-sm text-amber-900">
                {creditoPendiente.mensaje}. Saldo {formatearDinero(creditoPendiente.saldo)} · vencido {formatearDinero(creditoPendiente.vencido)} · límite {formatearDinero(creditoPendiente.limite)}
              </p>
              <input className="rounded border border-slate-300 px-2 py-1" placeholder="Usuario del dueño" aria-label="Usuario del dueño para el crédito" value={autorizadorCredito} onChange={e => setAutorizadorCredito(e.target.value)} autoComplete="off" />
              <input className="rounded border border-slate-300 px-2 py-1" type="password" inputMode="numeric" placeholder="PIN" aria-label="PIN del dueño para el crédito" value={pinCredito} onChange={e => setPinCredito(e.target.value)} autoComplete="off" />
            </div>
          )}
        </fieldset>

        <div className="flex items-center justify-between text-lg">
          <span>Cambio</span>
          <span className="text-2xl font-semibold tabular-nums text-emerald-700">{formatearDinero(cambio)}</span>
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        <button type="button" onClick={cobrar} disabled={Boolean(error) || cobrando} className="w-full rounded-lg bg-emerald-600 text-white text-lg font-semibold py-3 hover:bg-emerald-700 disabled:opacity-50">
          {cobrando ? 'Cobrando…' : 'Cobrar (F12)'}
        </button>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cuentasPagarAPI, mensajeDeError } from '../../services/api';
import { centavosATexto, formatearDinero, formatearFecha, hoyLocal, pesosACentavos } from '../../utils/formato';
import { nuevaClaveOperacion } from '../../utils/caja';

// Registrar un pago a un proveedor. Se aplica a las facturas mostradas, de la que vence primero a la última;
// se permiten pagos parciales.
export default function PagoProveedorFormulario({ proveedor, cuentas, alCerrar, alPagar }) {
  const total = cuentas.reduce((s, c) => s + c.saldo, 0);
  const [monto, setMonto] = useState(centavosATexto(total));
  const [metodo, setMetodo] = useState('transferencia');
  const [referencia, setReferencia] = useState('');
  const [nota, setNota] = useState('');
  const [fecha, setFecha] = useState(hoyLocal());
  const [clave] = useState(nuevaClaveOperacion);
  const [enviando, setEnviando] = useState(false);

  const centavos = pesosACentavos(monto);
  let error = null;
  if (!centavos) error = 'Indica el monto';
  else if (Number.isNaN(centavos)) error = 'Usa pesos con máximo 2 decimales';
  else if (centavos > total) error = `Lo máximo es ${formatearDinero(total)}`;
  else if (!fecha || fecha > hoyLocal()) error = 'La fecha no puede ser futura';

  const enviar = async e => {
    e.preventDefault();
    if (error) return;
    setEnviando(true);
    try {
      await cuentasPagarAPI.pagar({
        claveOperacion: clave, proveedor: proveedor.id, monto: centavos, metodo, fecha,
        referencia: referencia.trim() || undefined, nota: nota.trim() || undefined, cuentas: cuentas.map(c => c.id)
      });
      toast.success(`Pago de ${formatearDinero(centavos)} a ${proveedor.nombre} registrado`);
      alPagar();
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo registrar el pago'), { duration: 6000 });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true">
      <form onSubmit={enviar} className="bg-white rounded-xl shadow-lg w-full max-w-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Pago a {proveedor.nombre}</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500"><X /></button>
        </div>
        <ul className="text-sm divide-y divide-slate-100 max-h-40 overflow-y-auto rounded border border-slate-200">
          {cuentas.map(c => (
            <li key={c.id} className="flex justify-between px-3 py-1">
              <span className="font-mono">{c.folioFactura}</span>
              <span className="text-slate-500">vence {formatearFecha(c.vencimiento)}</span>
              <span className="tabular-nums">{formatearDinero(c.saldo)}</span>
            </li>
          ))}
        </ul>
        <fieldset disabled={enviando} className="grid grid-cols-2 gap-3">
          <label className="block text-sm"><span className="font-medium">Monto</span>
            <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-right tabular-nums" inputMode="decimal" value={monto} onChange={e => setMonto(e.target.value)} /></label>
          <label className="block text-sm"><span className="font-medium">Fecha del pago</span>
            <input type="date" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" max={hoyLocal()} value={fecha} onChange={e => setFecha(e.target.value)} /></label>
          <label className="block text-sm"><span className="font-medium">Forma de pago</span>
            <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={metodo} onChange={e => setMetodo(e.target.value)}>
              <option value="transferencia">Transferencia</option>
              <option value="cheque">Cheque</option>
              <option value="efectivo">Efectivo</option>
            </select></label>
          <label className="block text-sm"><span className="font-medium">Referencia</span>
            <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder={metodo === 'cheque' ? 'Número de cheque' : 'Folio o rastreo'} value={referencia} onChange={e => setReferencia(e.target.value)} maxLength={60} /></label>
          <label className="col-span-2 block text-sm"><span className="font-medium">Nota (opcional)</span>
            <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={nota} onChange={e => setNota(e.target.value)} maxLength={300} /></label>
        </fieldset>
        {metodo === 'efectivo' && <p className="text-xs text-slate-500">Si el efectivo sale de una caja, regístralo también como retiro en el turno.</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Cancelar</button>
          <button type="submit" disabled={Boolean(error) || enviando} className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">{enviando ? 'Registrando…' : 'Registrar pago'}</button>
        </div>
      </form>
    </div>
  );
}

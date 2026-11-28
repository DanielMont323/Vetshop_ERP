import { useState } from 'react';
import { CheckCircle2, MessageCircle, RefreshCw, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cobranzaAPI, mensajeDeError } from '../../services/api';
import { formatearDinero, formatearFecha } from '../../utils/formato';
import { enlaceWhatsapp } from '../../utils/recordatorios';

const METODOS = { efectivo: 'efectivo', tarjeta: 'tarjeta', transferencia: 'transferencia' };

// Texto para WhatsApp: lo cobrado, a qué ventas y facturas se aplicó, complementos de pago y el saldo que queda
export function mensajeAbono(d) {
  const lineas = [
    `Hola ${d.cliente.nombre}, recibimos su pago de ${formatearDinero(d.abono.monto)} (${METODOS[d.abono.metodo]}) el ${formatearFecha(d.abono.fecha)}, folio ${d.abono.folio}. ¡Gracias!`,
    '',
    'Se aplicó a:',
    ...d.ventas.map(v => `• Venta ${v.folio}: ${formatearDinero(v.monto)}${v.bonificacion ? ` + bonificación ${formatearDinero(v.bonificacion)}` : ''}${v.factura ? ` (factura ${v.factura.folio})` : ''}`)
  ];
  const timbrados = d.complementos.filter(c => c.estado === 'timbrado');
  if (timbrados.length) {
    lineas.push('', 'Complemento de pago:', ...timbrados.map(c => `• ${c.folio} de la factura ${c.folioFactura}${c.uuid ? ` (UUID ${c.uuid})` : ''}`));
  }
  lineas.push('', `Saldo pendiente: ${formatearDinero(d.saldo)}`, '— Huellitas Vetshop 🐾');
  return lineas.join('\n');
}

// Después de registrar un abono: qué cubrió, complementos de pago (con reintento) y envío por WhatsApp
export default function AbonoResultado({ detalle: inicial, alCerrar }) {
  const [d, setD] = useState(inicial);
  const [reintentando, setReintentando] = useState(false);
  const pendientesDeComplemento = d.complementos.filter(c => c.estado === 'error' && !d.complementos.some(x => x.factura === c.factura && x.estado === 'timbrado'));

  const reintentar = async () => {
    setReintentando(true);
    try {
      setD((await cobranzaAPI.reintentarComplementos(d.abono.id)).data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo timbrar'));
    } finally {
      setReintentando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true" onKeyDown={e => e.key === 'Escape' && alCerrar()}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2"><CheckCircle2 className="text-emerald-600" size={20} /> Abono {d.abono.folio}</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500"><X /></button>
        </div>
        <p className="text-sm">{d.cliente.nombre} pagó <strong>{formatearDinero(d.abono.monto)}</strong>{d.abono.bonificacion > 0 && <> y se bonificaron {formatearDinero(d.abono.bonificacion)}</>}.</p>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th className="py-1">Venta</th><th className="py-1">Factura</th><th className="py-1 text-right">Aplicado</th></tr></thead>
          <tbody>
            {d.ventas.map(v => (
              <tr key={v.folio} className="border-t border-slate-100"><td className="py-1">{v.folio}</td><td className="py-1">{v.factura ? `${v.factura.folio} (${v.factura.metodoPago})` : '—'}</td><td className="py-1 text-right tabular-nums">{formatearDinero(v.monto)}</td></tr>
            ))}
          </tbody>
        </table>
        {d.complementos.length > 0 && (
          <div className="rounded-lg bg-slate-50 p-3 text-sm space-y-1">
            <p className="font-medium">Complementos de pago</p>
            {d.complementos.map((c, i) => (
              <p key={i} className={c.estado === 'timbrado' ? 'text-emerald-700' : 'text-red-700'}>
                {c.estado === 'timbrado' ? `✓ ${c.folio} de la factura ${c.folioFactura} por ${formatearDinero(c.monto)}` : `✗ Factura ${c.folioFactura}: ${c.mensaje}`}
              </p>
            ))}
            {pendientesDeComplemento.length > 0 && (
              <button type="button" onClick={reintentar} disabled={reintentando} className="mt-1 flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-60"><RefreshCw size={14} /> {reintentando ? 'Timbrando…' : 'Reintentar complemento'}</button>
            )}
          </div>
        )}
        <p className="text-sm">Saldo pendiente: <strong>{formatearDinero(d.saldo)}</strong></p>
        <div className="flex justify-end gap-3">
          {d.cliente.whatsapp
            ? <a href={enlaceWhatsapp(d.cliente.whatsapp, mensajeAbono(d))} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700"><MessageCircle size={16} /> Enviar por WhatsApp</a>
            : <span className="self-center text-xs text-slate-500">Sin WhatsApp registrado</span>}
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Listo</button>
        </div>
      </div>
    </div>
  );
}

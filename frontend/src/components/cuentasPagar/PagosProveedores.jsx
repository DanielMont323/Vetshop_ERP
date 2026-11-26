import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { cuentasPagarAPI, mensajeDeError } from '../../services/api';
import { formatearDinero, formatearFecha, hoyLocal } from '../../utils/formato';

const METODOS = { transferencia: 'Transferencia', cheque: 'Cheque', efectivo: 'Efectivo' };
const haceDias = dias => {
  const [a, m, d] = hoyLocal().split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d - dias)).toISOString().slice(0, 10);
};

// Historial de pagos a proveedores, con cancelación (se capturó mal).
export default function PagosProveedores({ alCambiar }) {
  const [desde, setDesde] = useState(haceDias(30));
  const [hasta, setHasta] = useState(hoyLocal());
  const [pagos, setPagos] = useState([]);

  const cargar = useCallback(async () => {
    try {
      setPagos((await cuentasPagarAPI.pagos({ desde, hasta })).data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudieron cargar los pagos'));
    }
  }, [desde, hasta]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const cancelar = async pago => {
    const motivo = window.prompt(`Motivo para cancelar el pago de ${formatearDinero(pago.monto)} a ${pago.proveedor.nombre}:`);
    if (!motivo || motivo.trim().length < 3) return;
    try {
      await cuentasPagarAPI.cancelarPago(pago.id, { motivo: motivo.trim() });
      toast.success('Pago cancelado: las facturas vuelven a quedar pendientes');
      cargar();
      alCambiar();
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo cancelar el pago'));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 items-end text-sm">
        <label>Desde <input type="date" className="ml-1 rounded-lg border border-slate-300 px-2 py-1" value={desde} max={hasta} onChange={e => setDesde(e.target.value)} /></label>
        <label>Hasta <input type="date" className="ml-1 rounded-lg border border-slate-300 px-2 py-1" value={hasta} max={hoyLocal()} onChange={e => setHasta(e.target.value)} /></label>
      </div>
      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr>
            <th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Proveedor</th><th className="px-3 py-2">Forma</th>
            <th className="px-3 py-2">Facturas</th><th className="px-3 py-2 text-right">Monto</th><th className="px-3 py-2">Registró</th><th />
          </tr></thead>
          <tbody>
            {pagos.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-slate-500">Sin pagos en el periodo.</td></tr>}
            {pagos.map(p => (
              <tr key={p.id} className={`border-t border-slate-100 ${p.estado === 'cancelado' ? 'text-slate-400' : ''}`}>
                <td className="px-3 py-2">{formatearFecha(p.fecha)}</td>
                <td className="px-3 py-2">{p.proveedor.nombre}{p.nota && <span className="block text-xs text-slate-500">{p.nota}</span>}</td>
                <td className="px-3 py-2">{METODOS[p.metodo]}{p.referencia && ` · ${p.referencia}`}</td>
                <td className="px-3 py-2 font-mono text-xs">{p.aplicaciones.map(a => a.folioFactura).join(', ')}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${p.estado === 'cancelado' ? 'line-through' : ''}`}>{formatearDinero(p.monto)}</td>
                <td className="px-3 py-2">{p.usuario.nombre}</td>
                <td className="px-3 py-2 text-right">
                  {p.estado === 'cancelado'
                    ? <span className="text-xs">Cancelado: {p.cancelacion.motivo}</span>
                    : <button type="button" onClick={() => cancelar(p)} className="text-red-700 underline text-xs">Cancelar</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

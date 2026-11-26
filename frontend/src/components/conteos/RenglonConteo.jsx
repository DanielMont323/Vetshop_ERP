import { useState } from 'react';
import toast from 'react-hot-toast';
import { conteosAPI, mensajeDeError } from '../../services/api';
import { baseATexto, cantidadABase, formatearCantidad, formatearDinero, formatearFecha } from '../../utils/formato';

// Un lote del conteo: muestra lo contado y permite sumar (otra persona contó más) o reemplazar (recontar).
export default function RenglonConteo({ conteoId, renglon: r, editable, verDiferencias, alCapturar, alTerminar }) {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async modo => {
    const cantidad = cantidadABase(texto, r.unidad);
    if (cantidad === null || Number.isNaN(cantidad)) return toast.error(r.unidad === 'kg' ? 'Cantidad en kg, hasta 3 decimales' : 'Cantidad en piezas (entero)');
    setEnviando(true);
    try {
      const { data } = await conteosAPI.capturar(conteoId, { renglon: r.id, cantidad, modo });
      alCapturar(r.id, { contado: data.datos.contado, fechaCaptura: data.datos.fechaCaptura });
      setTexto('');
      alTerminar();
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo capturar'));
    } finally {
      setEnviando(false);
    }
  };

  const contado = r.contado === null ? <span className="text-slate-400">—</span> : formatearCantidad(r.contado, r.unidad);
  const colorDif = !r.diferencia ? 'text-slate-500' : r.diferencia < 0 ? 'text-red-700 font-medium' : 'text-amber-700 font-medium';

  return (
    <tr className="border-t border-slate-100 align-middle">
      <td className="px-3 py-2">{r.nombre}<span className="block text-xs text-slate-500 font-mono">{r.sku}{r.codigoBarras ? ` · ${r.codigoBarras}` : ''}</span></td>
      <td className="px-3 py-2 font-mono">{r.lote || '—'}</td>
      <td className="px-3 py-2">{r.caducidad ? formatearFecha(r.caducidad) : '—'}</td>
      {verDiferencias && <td className="px-3 py-2 text-right tabular-nums">{formatearCantidad(r.esperado, r.unidad)}</td>}
      <td className="px-3 py-2 text-right tabular-nums">{contado}</td>
      {verDiferencias && (
        <>
          <td className={`px-3 py-2 text-right tabular-nums ${colorDif}`}>{r.diferencia === null ? '—' : `${r.diferencia > 0 ? '+' : ''}${baseATexto(r.diferencia, r.unidad)}`}</td>
          <td className={`px-3 py-2 text-right tabular-nums ${colorDif}`}>{r.valor ? formatearDinero(r.valor) : '—'}</td>
        </>
      )}
      {editable && (
        <td className="px-3 py-2">
          <div className="flex items-center gap-1">
            <input
              data-captura
              className="w-24 rounded border border-slate-300 px-2 py-1 text-right tabular-nums"
              inputMode="decimal"
              placeholder={r.unidad === 'kg' ? 'kg' : 'pzas'}
              aria-label={`Cantidad contada de ${r.nombre} lote ${r.lote || 'sin lote'}`}
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), enviar('sumar'))}
              disabled={enviando}
            />
            <button type="button" onClick={() => enviar('sumar')} disabled={enviando || !texto} className="rounded bg-emerald-600 text-white px-2 py-1 text-xs disabled:opacity-50" title="Suma a lo ya contado">Sumar</button>
            {r.contado !== null && <button type="button" onClick={() => enviar('reemplazar')} disabled={enviando || !texto} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50" title="Reemplaza lo contado (recontar)">Recontar</button>}
          </div>
        </td>
      )}
    </tr>
  );
}

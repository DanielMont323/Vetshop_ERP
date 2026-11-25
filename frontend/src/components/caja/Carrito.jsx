import { FileText, Trash2 } from 'lucide-react';
import { formatearDinero } from '../../utils/formato';

const celda = 'w-full rounded border border-slate-300 px-2 py-1 text-right tabular-nums';

// Líneas del carrito con vista previa de importe. `calculos[i]` = { precio, lista, bruto, descuento, importe, error }
export default function Carrito({ lineas, calculos, alCambiar, alQuitar }) {
  if (lineas.length === 0) {
    return (
      <div className="h-full grid place-items-center text-slate-400 text-center p-8">
        <p>Escanea un producto o presiona <kbd className="rounded border px-1">F2</kbd> para buscar.</p>
      </div>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-100 text-left sticky top-0">
        <tr>
          <th className="px-2 py-2">Producto</th>
          <th className="px-2 py-2 w-24 text-right">Cantidad</th>
          <th className="px-2 py-2 w-28 text-right">Precio</th>
          <th className="px-2 py-2 w-20 text-right">Desc. %</th>
          <th className="px-2 py-2 w-28 text-right">Importe</th>
          <th className="px-2 py-2 w-8" />
        </tr>
      </thead>
      <tbody>
        {lineas.map((l, i) => {
          const c = calculos[i];
          return (
            <tr key={l.clave} className={`border-t border-slate-100 align-top ${c.error ? 'bg-red-50' : ''}`}>
              <td className="px-2 py-1.5">
                <span className="flex items-center gap-1">
                  {l.producto.nombre}
                  {l.producto.requiereReceta && <FileText size={14} className="text-amber-600" aria-label="Requiere receta" />}
                </span>
                <span className="text-xs font-mono text-slate-500">{l.producto.sku}</span>
                {c.lista && c.lista !== 'publico' && <span className="text-xs text-emerald-700"> · precio {c.lista}</span>}
                {c.error && <span className="block text-xs text-red-700">{c.error}</span>}
              </td>
              <td className="px-2 py-1.5">
                <input
                  id={`cantidad-${l.clave}`}
                  className={celda}
                  inputMode="decimal"
                  aria-label={`Cantidad de ${l.producto.nombre}`}
                  placeholder={l.producto.unidad === 'kg' ? 'kg' : 'pzas'}
                  value={l.cantidad}
                  onChange={e => alCambiar(i, 'cantidad', e.target.value)}
                />
                {l.producto.unidad === 'kg' && <span className="block text-right text-xs text-slate-500">kg</span>}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {c.precio === null ? '—' : formatearDinero(c.precio)}
                {l.producto.unidad === 'kg' && <span className="text-xs text-slate-500">/kg</span>}
              </td>
              <td className="px-2 py-1.5">
                <input
                  className={celda}
                  inputMode="decimal"
                  aria-label={`Descuento de ${l.producto.nombre}`}
                  value={l.descuento}
                  onChange={e => alCambiar(i, 'descuento', e.target.value)}
                />
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {c.descuento > 0 && <span className="block text-xs text-slate-500 line-through">{formatearDinero(c.bruto)}</span>}
                {formatearDinero(c.importe)}
              </td>
              <td className="px-2 py-1.5">
                <button type="button" onClick={() => alQuitar(i)} aria-label={`Quitar ${l.producto.nombre}`} className="text-slate-400 hover:text-red-600">
                  <Trash2 size={16} />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

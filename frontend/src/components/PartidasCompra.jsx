import { Trash2 } from 'lucide-react';
import { formatearDinero } from '../utils/formato';

const celda = 'w-full rounded border border-slate-300 px-2 py-1';

// Tabla editable de partidas de una compra. `partidas` son filas de captura (texto); `importes` el
// cálculo de vista previa por fila (centavos o null).
export default function PartidasCompra({ partidas, importes, editable, alCambiar, alQuitar }) {
  if (partidas.length === 0) {
    return <p className="text-sm text-slate-500 py-4 text-center">Agrega productos con el lector o escribiendo su nombre.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-100 text-left">
          <tr>
            <th className="px-2 py-2">Producto</th>
            <th className="px-2 py-2 w-24">Cantidad</th>
            <th className="px-2 py-2 w-28">Costo s/IVA</th>
            <th className="px-2 py-2 w-28">Lote</th>
            <th className="px-2 py-2 w-28">Caducidad</th>
            <th className="px-2 py-2 w-20">Temp. °C</th>
            <th className="px-2 py-2 w-28 text-right">Importe</th>
            {editable && <th className="px-2 py-2 w-8" />}
          </tr>
        </thead>
        <tbody>
          {partidas.map((p, i) => (
            <tr key={p.clave} className={`border-t border-slate-100 ${p.fueraDeRango ? 'bg-red-50' : ''}`}>
              <td className="px-2 py-1">
                {p.nombre} <span className="font-mono text-xs text-slate-500">{p.sku}</span>
                {p.fueraDeRango && <span className="block text-xs text-red-700">Llegó fuera de 2–8 °C</span>}
              </td>
              {['cantidad', 'costo', 'lote', 'caducidad', 'temperatura'].map(campo => (
                <td key={campo} className="px-2 py-1">
                  {editable ? (
                    <input
                      className={celda}
                      aria-label={`${campo} de ${p.nombre}`}
                      inputMode={['cantidad', 'costo', 'temperatura'].includes(campo) ? 'decimal' : undefined}
                      placeholder={{ cantidad: p.unidad === 'kg' ? 'kg' : 'pzas', costo: p.unidad === 'kg' ? '$/kg' : '$', caducidad: 'MM/AAAA', lote: '', temperatura: '' }[campo]}
                      value={p[campo]}
                      onChange={e => alCambiar(i, campo, e.target.value)}
                    />
                  ) : (
                    <span>{p[campo] || '—'}</span>
                  )}
                </td>
              ))}
              <td className="px-2 py-1 text-right tabular-nums">{importes[i] === null ? '—' : formatearDinero(importes[i])}</td>
              {editable && (
                <td className="px-2 py-1">
                  <button type="button" onClick={() => alQuitar(i)} aria-label={`Quitar ${p.nombre}`} className="text-slate-400 hover:text-red-600">
                    <Trash2 size={16} />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

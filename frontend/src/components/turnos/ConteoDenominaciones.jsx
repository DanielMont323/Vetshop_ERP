import { formatearDinero } from '../../utils/formato';

// Billetes y monedas de México, en centavos (mismo orden que el servidor)
export const DENOMINACIONES = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50];

export const conteoVacio = () => Object.fromEntries(DENOMINACIONES.map(d => [d, '']));

// { 20000: '3', ... } → [{ denominacion, cantidad }] (solo las capturadas) o { error }
export function aDenominaciones(conteo) {
  const lista = [];
  for (const d of DENOMINACIONES) {
    const texto = String(conteo[d] ?? '').trim();
    if (texto === '') continue;
    if (!/^\d+$/.test(texto)) return { error: `Cantidad inválida en ${formatearDinero(d)}` };
    lista.push({ denominacion: d, cantidad: Number(texto) });
  }
  return { lista };
}

export function totalConteo(conteo) {
  return DENOMINACIONES.reduce((s, d) => s + d * (/^\d+$/.test(String(conteo[d] ?? '').trim()) ? Number(conteo[d]) : 0), 0);
}

// Captura de billetes y monedas con el total
export default function ConteoDenominaciones({ conteo, alCambiar, deshabilitado }) {
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {DENOMINACIONES.map(d => (
          <label key={d} className="flex items-center gap-2 text-sm">
            <span className="w-16 text-right tabular-nums">{formatearDinero(d).replace('.00', '')}</span>
            <span className="text-slate-400">×</span>
            <input
              className="w-16 rounded border border-slate-300 px-2 py-1 text-right tabular-nums"
              inputMode="numeric"
              aria-label={`Cantidad de ${formatearDinero(d)}`}
              value={conteo[d]}
              disabled={deshabilitado}
              onChange={e => alCambiar({ ...conteo, [d]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <p className="mt-2 text-right font-semibold tabular-nums">Total contado: {formatearDinero(totalConteo(conteo))}</p>
    </div>
  );
}

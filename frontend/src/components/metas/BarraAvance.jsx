import { formatearDinero } from '../../utils/formato';

// Medidor de avance contra la meta: una sola serie (mismo azul validado de las gráficas), pista gris,
// 8 px de alto con extremos redondeados. El texto lleva el dato (nunca solo el color). Si la proyección
// rebasa la barra, una marca vertical indica dónde terminaría el mes.
const SERIE = '#2a78d6';

export default function BarraAvance({ vendido, meta, proyeccion, etiqueta }) {
  if (!meta) return <p className="text-sm text-slate-500">Sin meta · vendido {formatearDinero(vendido)}</p>;
  const pct = Math.min(100, (vendido / meta) * 100);
  const pctProy = proyeccion ? Math.min(100, (proyeccion / meta) * 100) : null;
  return (
    <div className="space-y-1">
      <div className="flex justify-between gap-2 text-sm">
        <span className="text-slate-700">{etiqueta}{formatearDinero(vendido)} de {formatearDinero(meta)}</span>
        <span className="font-semibold tabular-nums text-slate-900">{((vendido / meta) * 100).toFixed(1)} %</span>
      </div>
      <div
        className="relative h-2 rounded-full bg-slate-200"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={meta}
        aria-valuenow={vendido}
        aria-label={`Avance: ${formatearDinero(vendido)} de ${formatearDinero(meta)}`}
      >
        <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: SERIE }} />
        {pctProy !== null && pctProy > pct && (
          <div className="absolute -top-1 h-4 w-0.5 bg-slate-500" style={{ left: `calc(${pctProy}% - 1px)` }} title="Proyección al cierre" />
        )}
      </div>
      {proyeccion !== null && proyeccion !== undefined && (
        <p className="text-xs text-slate-500">
          Proyección al cierre del mes: {formatearDinero(proyeccion)} ({((proyeccion / meta) * 100).toFixed(0)} %)
        </p>
      )}
    </div>
  );
}

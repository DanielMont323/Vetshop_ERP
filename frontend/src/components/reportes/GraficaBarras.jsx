import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatearDinero } from '../../utils/formato';

// Una sola serie (el título la nombra; sin leyenda). Color: slot 1 de la paleta de referencia,
// validado contra el fondo blanco (contraste ≥ 3:1). Barras ≤ 24 px, esquina redondeada al final,
// cuadrícula y ejes discretos, tooltip al pasar el cursor.
const SERIE = '#2a78d6';
const TINTA_SECUNDARIA = '#52514e';
const CUADRICULA = '#e7e5e4';

// $1,234 → "$1.2k" en el eje (el valor exacto va en el tooltip)
function compacto(centavos) {
  const pesos = centavos / 100;
  if (Math.abs(pesos) >= 1000) return `$${(pesos / 1000).toFixed(pesos >= 10000 ? 0 : 1)}k`;
  return `$${Math.round(pesos)}`;
}

function Globo({ active, payload, label, etiqueta }) {
  if (!active || !payload?.length) return null;
  const fila = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow">
      <p className="font-medium text-slate-900">{etiqueta ? etiqueta(label) : label}</p>
      <p className="text-slate-700 tabular-nums">Total: {formatearDinero(fila.total)}</p>
      <p className="text-slate-500 tabular-nums">{fila.ventas} venta{fila.ventas === 1 ? '' : 's'}</p>
    </div>
  );
}

export default function GraficaBarras({ datos, clave = 'periodo', etiqueta, alto = 220 }) {
  return (
    <div style={{ width: '100%', height: alto }}>
      <ResponsiveContainer>
        <BarChart data={datos} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke={CUADRICULA} />
          <XAxis dataKey={clave} tickFormatter={etiqueta} tick={{ fill: TINTA_SECUNDARIA, fontSize: 12 }} axisLine={{ stroke: CUADRICULA }} tickLine={false} />
          <YAxis tickFormatter={compacto} tick={{ fill: TINTA_SECUNDARIA, fontSize: 12 }} axisLine={false} tickLine={false} width={56} />
          <Tooltip content={<Globo etiqueta={etiqueta} />} cursor={{ fill: 'rgba(42, 120, 214, 0.08)' }} />
          <Bar dataKey="total" fill={SERIE} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Search, Snowflake } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { existenciasAPI, mensajeDeError } from '../services/api';
import { NOMBRES_ALERTA, formatearCantidad, formatearFecha } from '../utils/formato';
import LotesProducto from '../components/LotesProducto';

const FILTROS = [
  ['', 'Todo'],
  ['caducado', 'Caducados'],
  ['por_caducar', 'Por caducar (30 días)'],
  ['bajo_minimo', 'Bajo mínimo'],
  ['sin_existencia', 'Sin existencia']
];

// Existencias de la sucursal activa, con alertas. Clic en una fila: lotes, movimientos y ajuste.
export default function Existencias() {
  const { sucursalActiva } = useAuth();
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('');
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [abierto, setAbierto] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await existenciasAPI.listar({ q: q.trim() || undefined, estado: estado || undefined });
      setFilas(res.data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudieron cargar las existencias'));
    } finally {
      setCargando(false);
    }
  }, [q, estado]);

  useEffect(() => {
    const t = setTimeout(cargar, 300);
    return () => clearTimeout(t);
  }, [cargar, sucursalActiva]);

  const varias = new Set(filas.map(f => f.sucursal.id)).size > 1;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Existencias</h2>

      <div className="flex flex-wrap gap-3 items-center">
        <label className="relative flex-1 min-w-60">
          <Search size={16} className="absolute left-3 top-3 text-slate-400" aria-hidden="true" />
          <span className="sr-only">Buscar</span>
          <input className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2" placeholder="Nombre, SKU o código de barras" value={q} onChange={e => setQ(e.target.value)} autoFocus />
        </label>
        <div className="flex flex-wrap gap-2" role="tablist">
          {FILTROS.map(([valor, texto]) => (
            <button
              key={valor}
              type="button"
              role="tab"
              aria-selected={estado === valor}
              onClick={() => setEstado(valor)}
              className={`rounded-lg px-3 py-1.5 text-sm border ${estado === valor ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-slate-300'}`}
            >
              {texto}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="px-3 py-2">Producto</th>
              {varias && <th className="px-3 py-2">Sucursal</th>}
              <th className="px-3 py-2 text-right">Existencia</th>
              <th className="px-3 py-2 text-right">Mínimo</th>
              <th className="px-3 py-2">Próxima caducidad</th>
              <th className="px-3 py-2">Alertas</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(f => (
              <tr key={`${f.sucursal.id}-${f.producto.id}`} onClick={() => setAbierto(f.producto)} className="border-t border-slate-100 cursor-pointer hover:bg-emerald-50">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    {f.producto.nombre}
                    {f.producto.requiereRefrigeracion && <Snowflake size={14} className="text-sky-600" aria-label="Refrigeración" />}
                  </span>
                  <span className="text-xs font-mono text-slate-500">{f.producto.sku}</span>
                </td>
                {varias && <td className="px-3 py-2">{f.sucursal.nombre}</td>}
                <td className="px-3 py-2 text-right tabular-nums font-medium">{formatearCantidad(f.existencia, f.producto.unidad)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">{f.minimo ? formatearCantidad(f.minimo, f.producto.unidad) : '—'}</td>
                <td className="px-3 py-2">{formatearFecha(f.proximaCaducidad)}</td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-1">
                    {f.alertas.map(a => (
                      <span key={a} className={`rounded px-2 py-0.5 text-xs ${NOMBRES_ALERTA[a].clase}`}>
                        {NOMBRES_ALERTA[a].texto}
                        {a === 'caducado' && ` (${formatearCantidad(f.caducado, f.producto.unidad)})`}
                        {a === 'por_caducar' && ` (${formatearCantidad(f.porCaducar, f.producto.unidad)})`}
                      </span>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
            {!cargando && filas.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No hay existencias que coincidan.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {abierto && <LotesProducto producto={abierto} alCerrar={() => setAbierto(null)} alCambiar={cargar} />}
    </section>
  );
}

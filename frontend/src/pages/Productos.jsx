import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Snowflake, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { mensajeDeError, productosAPI } from '../services/api';
import { NOMBRES_CATEGORIA, formatearDinero } from '../utils/formato';
import ProductoFormulario from '../components/ProductoFormulario';

const POR_PAGINA = 50;

export default function Productos() {
  const { puede } = useAuth();
  const [q, setQ] = useState('');
  const [categoria, setCategoria] = useState('');
  const [verInactivos, setVerInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [resultado, setResultado] = useState({ datos: [], total: 0 });
  const [cargando, setCargando] = useState(false);
  const [abierto, setAbierto] = useState(null); // null | 'nuevo' | producto

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const params = { q: q.trim() || undefined, categoria: categoria || undefined, activo: verInactivos ? undefined : true, pagina, limite: POR_PAGINA };
      const res = await productosAPI.buscar(params);
      setResultado({ datos: res.data.datos, total: res.data.total });
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudieron cargar los productos'));
    } finally {
      setCargando(false);
    }
  }, [q, categoria, verInactivos, pagina]);

  // Espera 300 ms después de teclear para no consultar en cada letra
  useEffect(() => {
    const t = setTimeout(cargar, 300);
    return () => clearTimeout(t);
  }, [cargar]);

  const alGuardar = () => {
    setAbierto(null);
    cargar();
  };

  const paginas = Math.max(1, Math.ceil(resultado.total / POR_PAGINA));

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold mr-auto">Productos</h2>
        {puede('catalogo:gestionar') && (
          <button type="button" onClick={() => setAbierto('nuevo')} className="flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-3 py-2 hover:bg-emerald-700">
            <Plus size={18} aria-hidden="true" /> Nuevo producto
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <label className="relative flex-1 min-w-60">
          <Search size={16} className="absolute left-3 top-3 text-slate-400" aria-hidden="true" />
          <span className="sr-only">Buscar</span>
          <input
            className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2"
            placeholder="Nombre, SKU o código de barras"
            value={q}
            onChange={e => { setQ(e.target.value); setPagina(1); }}
            autoFocus
          />
        </label>
        <select className="rounded-lg border border-slate-300 px-3 py-2" value={categoria} onChange={e => { setCategoria(e.target.value); setPagina(1); }}>
          <option value="">Todas las categorías</option>
          {Object.entries(NOMBRES_CATEGORIA).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={verInactivos} onChange={e => { setVerInactivos(e.target.checked); setPagina(1); }} />
          Incluir inactivos
        </label>
      </div>

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Categoría</th>
              <th className="px-3 py-2">Unidad</th>
              <th className="px-3 py-2 text-right">Precio público</th>
            </tr>
          </thead>
          <tbody>
            {resultado.datos.map(p => (
              <tr key={p.id} onClick={() => setAbierto(p)} className={`border-t border-slate-100 cursor-pointer hover:bg-emerald-50 ${p.activo ? '' : 'text-slate-400'}`}>
                <td className="px-3 py-2 font-mono">{p.sku}</td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    {p.nombre}
                    {p.requiereReceta && <FileText size={14} className="text-amber-600" aria-label="Requiere receta" />}
                    {p.requiereRefrigeracion && <Snowflake size={14} className="text-sky-600" aria-label="Refrigeración" />}
                    {!p.activo && <span className="text-xs">(inactivo)</span>}
                  </span>
                  {p.presentacion && <span className="block text-xs text-slate-500">{p.presentacion}</span>}
                </td>
                <td className="px-3 py-2">{NOMBRES_CATEGORIA[p.categoria]}</td>
                <td className="px-3 py-2">{p.unidad === 'kg' ? 'Kilo' : 'Pieza'}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatearDinero(p.precios.publico)}
                  {p.unidad === 'kg' && p.precios.publico !== undefined && <span className="text-xs text-slate-500"> /kg</span>}
                </td>
              </tr>
            ))}
            {!cargando && resultado.datos.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">No hay productos que coincidan.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-600">
        <span>{resultado.total} producto{resultado.total === 1 ? '' : 's'}</span>
        <div className="flex items-center gap-2">
          <button type="button" disabled={pagina <= 1} onClick={() => setPagina(p => p - 1)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">Anterior</button>
          <span>Página {pagina} de {paginas}</span>
          <button type="button" disabled={pagina >= paginas} onClick={() => setPagina(p => p + 1)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">Siguiente</button>
        </div>
      </div>

      {abierto && (
        <ProductoFormulario producto={abierto === 'nuevo' ? null : abierto} alCerrar={() => setAbierto(null)} alGuardar={alGuardar} />
      )}
    </section>
  );
}

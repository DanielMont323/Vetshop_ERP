import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { listasPreciosAPI, mensajeDeError, productosAPI } from '../services/api';
import { LISTAS_PRECIO, centavosATexto, formatearDinero, pesosACentavos } from '../utils/formato';

// Revisar y capturar los precios de una lista. Un precio vacío = se cobra el de público.
export default function ListasPrecios() {
  const { puede } = useAuth();
  const editable = puede('catalogo:gestionar');
  const [listas, setListas] = useState([]);
  const [clave, setClave] = useState('publico');
  const [q, setQ] = useState('');
  const [productos, setProductos] = useState([]);
  const [borradores, setBorradores] = useState({}); // productoId → texto capturado
  const [guardando, setGuardando] = useState(null);

  const cargarListas = useCallback(() => {
    listasPreciosAPI.listar().then(res => setListas(res.data.datos)).catch(() => {});
  }, []);

  const cargarProductos = useCallback(async () => {
    try {
      const res = await productosAPI.buscar({ q: q.trim() || undefined, activo: true, limite: 100 });
      setProductos(res.data.datos);
      setBorradores({});
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudieron cargar los productos'));
    }
  }, [q]);

  useEffect(cargarListas, [cargarListas]);
  useEffect(() => {
    const t = setTimeout(cargarProductos, 300);
    return () => clearTimeout(t);
  }, [cargarProductos]);

  const guardar = async producto => {
    const texto = borradores[producto.id];
    const centavos = pesosACentavos(texto);
    if (Number.isNaN(centavos)) return toast.error('Usa pesos con máximo 2 decimales');
    setGuardando(producto.id);
    try {
      if (centavos === null) await listasPreciosAPI.quitar(clave, producto.id);
      else await listasPreciosAPI.fijar(clave, producto.id, centavos);
      setProductos(lista => lista.map(p => (p.id === producto.id ? { ...p, precios: { ...p.precios, [clave]: centavos ?? undefined } } : p)));
      setBorradores(({ [producto.id]: _omitido, ...resto }) => resto);
      cargarListas();
      toast.success('Precio guardado');
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo guardar el precio'));
    } finally {
      setGuardando(null);
    }
  };

  const nombreLista = LISTAS_PRECIO.find(l => l.clave === clave)?.nombre;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Listas de precios</h2>

      <div className="flex flex-wrap gap-2" role="tablist">
        {LISTAS_PRECIO.map(l => {
          const total = listas.find(x => x.clave === l.clave)?.totalPrecios ?? 0;
          return (
            <button
              key={l.clave}
              type="button"
              role="tab"
              aria-selected={clave === l.clave}
              onClick={() => { setClave(l.clave); setBorradores({}); }}
              className={`rounded-lg px-3 py-2 text-sm border ${clave === l.clave ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-slate-300'}`}
            >
              {l.nombre} <span className="opacity-75">({total})</span>
            </button>
          );
        })}
      </div>

      <label className="relative block max-w-md">
        <Search size={16} className="absolute left-3 top-3 text-slate-400" aria-hidden="true" />
        <span className="sr-only">Buscar producto</span>
        <input className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2" placeholder="Buscar producto" value={q} onChange={e => setQ(e.target.value)} />
      </label>

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2 text-right">Público</th>
              <th className="px-3 py-2 text-right">{nombreLista} (con IVA)</th>
              {editable && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {productos.map(p => {
              const actual = p.precios[clave];
              const enEdicion = borradores[p.id] !== undefined;
              return (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    {p.nombre} <span className="text-xs text-slate-500 font-mono">{p.sku}</span>
                    {p.unidad === 'kg' && <span className="text-xs text-slate-500"> · por kg</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatearDinero(p.precios.publico)}</td>
                  <td className="px-3 py-2 text-right">
                    {editable ? (
                      <input
                        aria-label={`Precio ${nombreLista} de ${p.nombre}`}
                        className="w-28 rounded border border-slate-300 px-2 py-1 text-right tabular-nums"
                        inputMode="decimal"
                        placeholder={clave === 'publico' ? 'sin precio' : 'usa público'}
                        value={enEdicion ? borradores[p.id] : centavosATexto(actual)}
                        onChange={e => setBorradores(b => ({ ...b, [p.id]: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && guardar(p)}
                      />
                    ) : (
                      <span className="tabular-nums">{actual === undefined ? 'usa público' : formatearDinero(actual)}</span>
                    )}
                  </td>
                  {editable && (
                    <td className="px-3 py-2">
                      {enEdicion && (
                        <button type="button" disabled={guardando === p.id} onClick={() => guardar(p)} className="rounded bg-emerald-600 text-white px-2 py-1 disabled:opacity-60">
                          Guardar
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Se muestran hasta 100 productos; usa la búsqueda para encontrar el resto.</p>
    </section>
  );
}

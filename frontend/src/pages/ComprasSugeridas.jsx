import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ShoppingBag } from 'lucide-react';
import toast from 'react-hot-toast';
import { comprasAPI, mensajeDeError } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { NOMBRES_CATEGORIA, baseATexto, cantidadABase, formatearCantidad, formatearDinero } from '../utils/formato';
import CompraFormulario from '../components/CompraFormulario';

const dividir = (n, d) => Math.floor(n / d) + ((n % d) * 2 >= d ? 1 : 0);
const importe = (costo, cantidad, unidad) => (costo === null || !cantidad ? 0 : unidad === 'kg' ? dividir(costo * cantidad, 1000) : costo * cantidad);

// Compras sugeridas de la sucursal, agrupadas por proveedor habitual. Cada grupo se convierte en un
// borrador de compra (se completa folio, lotes y caducidades al recibir).
export default function ComprasSugeridas() {
  const { sucursalActiva } = useAuth();
  const [parametros, setParametros] = useState({ dias: 30, cobertura: 15, categoria: '', todos: false });
  const [datos, setDatos] = useState(null);
  const [cantidades, setCantidades] = useState({});
  const [borrador, setBorrador] = useState(null);

  const cargar = useCallback(async () => {
    if (!sucursalActiva) return;
    try {
      const { data } = await comprasAPI.sugeridas({ ...parametros, categoria: parametros.categoria || undefined, todos: parametros.todos || undefined });
      setDatos(data);
      setCantidades(Object.fromEntries(data.datos.map(f => [f.producto.id, baseATexto(f.sugerido, f.producto.unidad)])));
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudieron calcular las compras sugeridas'));
    }
  }, [parametros, sucursalActiva]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const grupos = useMemo(() => {
    const mapa = new Map();
    for (const f of datos?.datos || []) {
      const clave = f.proveedor?.id || 'sin';
      if (!mapa.has(clave)) mapa.set(clave, { proveedor: f.proveedor, filas: [] });
      mapa.get(clave).filas.push(f);
    }
    return [...mapa.values()];
  }, [datos]);

  const cantidadDe = f => cantidadABase(cantidades[f.producto.id], f.producto.unidad);

  const crearBorrador = grupo => {
    const partidas = grupo.filas
      .map(f => ({ f, cantidad: cantidadDe(f) }))
      .filter(({ cantidad }) => cantidad && !Number.isNaN(cantidad))
      .map(({ f, cantidad }) => ({
        producto: f.producto.id, sku: f.producto.sku, nombre: f.producto.nombre, unidad: f.producto.unidad, tasaIva: f.producto.tasaIva,
        cantidad, costoUnitario: f.ultimoCosto ?? 0
      }));
    if (!partidas.length) return toast.error('Indica al menos una cantidad a pedir');
    setBorrador({
      estado: 'borrador', proveedor: { id: grupo.proveedor?.id || '' }, folioFactura: '', fechaFactura: new Date().toISOString(), condicionPago: 'contado', diasCredito: 0,
      observaciones: 'Desde compras sugeridas', partidas
    });
  };

  const cambiar = (k, v) => setParametros(p => ({ ...p, [k]: v }));

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/compras" className="flex items-center gap-1 text-sm text-slate-600"><ArrowLeft size={16} /> Recepción</Link>
        <h2 className="text-lg font-semibold mr-auto flex items-center gap-2"><ShoppingBag size={20} aria-hidden="true" /> Compras sugeridas{datos ? ` · ${datos.sucursal.nombre}` : ''}</h2>
      </div>
      {!sucursalActiva && <p className="text-sm text-amber-800">Elige una sucursal arriba para calcular sus compras sugeridas.</p>}

      <div className="bg-white rounded-xl shadow p-4 flex flex-wrap items-end gap-4 text-sm">
        <label>Ventas de los últimos
          <select className="ml-2 rounded-lg border border-slate-300 px-2 py-1" value={parametros.dias} onChange={e => cambiar('dias', Number(e.target.value))}>
            {[30, 60, 90].map(d => <option key={d} value={d}>{d} días</option>)}
          </select>
        </label>
        <label>Cubrir
          <input type="number" min={1} max={120} className="mx-2 w-20 rounded-lg border border-slate-300 px-2 py-1" value={parametros.cobertura} onChange={e => cambiar('cobertura', Math.min(120, Math.max(1, Number(e.target.value) || 1)))} />
          días
        </label>
        <label>Categoría
          <select className="ml-2 rounded-lg border border-slate-300 px-2 py-1" value={parametros.categoria} onChange={e => cambiar('categoria', e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(NOMBRES_CATEGORIA).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={parametros.todos} onChange={e => cambiar('todos', e.target.checked)} /> Mostrar también lo que no hace falta</label>
      </div>
      <p className="text-xs text-slate-500">
        Sugerido = lo necesario para cubrir los días indicados con la venta diaria (o hasta el máximo si el producto lo tiene), menos lo que hay
        (sin los lotes que caducan antes) y lo que viene en camino. Mínimos y máximos se configuran en cada producto.
      </p>

      {datos && (
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="bg-white rounded-xl shadow p-3"><dt className="text-xs text-slate-500">Productos por pedir</dt><dd className="text-xl font-semibold">{datos.totales.productos}</dd></div>
          <div className="bg-white rounded-xl shadow p-3"><dt className="text-xs text-slate-500">Costo estimado (sin IVA)</dt><dd className="text-xl font-semibold tabular-nums">{formatearDinero(datos.totales.costoEstimado)}</dd></div>
          {datos.almacenes.length > 0 && <div className="bg-white rounded-xl shadow p-3"><dt className="text-xs text-slate-500">Hay en almacén (pídelos por traspaso)</dt><dd className="text-xl font-semibold">{datos.totales.conAlmacen}</dd></div>}
        </dl>
      )}

      {datos && grupos.length === 0 && <p className="text-slate-500">No hace falta pedir nada con estos parámetros.</p>}
      {grupos.map(g => {
        const total = g.filas.reduce((s, f) => s + importe(f.ultimoCosto, cantidadDe(f), f.producto.unidad), 0);
        return (
          <div key={g.proveedor?.id || 'sin'} className="bg-white rounded-xl shadow overflow-x-auto">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-100">
              <h3 className="font-semibold mr-auto">{g.proveedor ? g.proveedor.nombre : 'Sin proveedor habitual (nunca se ha recibido)'}</h3>
              <span className="text-sm tabular-nums">Estimado: {formatearDinero(total)}</span>
              <button type="button" onClick={() => crearBorrador(g)} className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-sm hover:bg-emerald-700">Crear borrador de compra</button>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left"><tr>
                <th className="px-3 py-2">Producto</th><th className="px-3 py-2 text-right">Venta/día</th><th className="px-3 py-2 text-right">Existencia</th>
                <th className="px-3 py-2 text-right">En camino</th><th className="px-3 py-2 text-right">Mín / Máx</th>
                {datos.almacenes.length > 0 && <th className="px-3 py-2 text-right">En almacén</th>}
                <th className="px-3 py-2 text-right">Último costo</th><th className="px-3 py-2">Pedir</th>
              </tr></thead>
              <tbody>
                {g.filas.map(f => {
                  const u = f.producto.unidad;
                  return (
                    <tr key={f.producto.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{f.producto.nombre}<span className="block text-xs text-slate-500 font-mono">{f.producto.sku}{f.producto.presentacion ? ` · ${f.producto.presentacion}` : ''}</span></td>
                      <td className="px-3 py-2 text-right tabular-nums">{u === 'kg' ? `${(f.ventaDiaria / 1000).toFixed(2)} kg` : f.ventaDiaria}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatearCantidad(f.existencia, u)}
                        {f.porCaducar > 0 && <span className="block text-xs text-amber-700">+{formatearCantidad(f.porCaducar, u)} por caducar</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{f.enCamino ? formatearCantidad(f.enCamino, u) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{f.minimo || f.maximo ? `${baseATexto(f.minimo, u) || 0} / ${f.maximo ? baseATexto(f.maximo, u) : '—'}` : '—'}</td>
                      {datos.almacenes.length > 0 && <td className={`px-3 py-2 text-right tabular-nums ${f.enAlmacen && f.sugerido ? 'text-emerald-700 font-medium' : ''}`}>{f.enAlmacen ? formatearCantidad(f.enAlmacen, u) : '—'}</td>}
                      <td className="px-3 py-2 text-right tabular-nums">{f.ultimoCosto !== null ? formatearDinero(f.ultimoCosto) : '—'}</td>
                      <td className="px-3 py-2">
                        <input
                          className="w-24 rounded border border-slate-300 px-2 py-1 text-right tabular-nums"
                          inputMode="decimal"
                          aria-label={`Cantidad a pedir de ${f.producto.nombre}`}
                          value={cantidades[f.producto.id] ?? ''}
                          onChange={e => setCantidades(c => ({ ...c, [f.producto.id]: e.target.value }))}
                        />
                        <span className="ml-1 text-xs text-slate-500">{u === 'kg' ? 'kg' : 'pzas'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      {borrador && <CompraFormulario compra={borrador} alCerrar={() => setBorrador(null)} alGuardar={() => { setBorrador(null); toast.success('Borrador guardado en Recepción'); cargar(); }} />}
    </section>
  );
}

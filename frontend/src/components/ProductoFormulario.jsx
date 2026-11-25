import { useState } from 'react';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { mensajeDeError, productosAPI } from '../services/api';
import {
  LISTAS_PRECIO, NOMBRES_CATEGORIA, NOMBRES_IVA,
  baseATexto, cantidadABase, centavosATexto, pesosACentavos
} from '../utils/formato';

const campo = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500';

function estadoInicial(p) {
  return {
    sku: p?.sku || '',
    codigoBarras: p?.codigoBarras || '',
    nombre: p?.nombre || '',
    categoria: p?.categoria || 'accesorio',
    unidad: p?.unidad || 'pieza',
    presentacion: p?.presentacion || '',
    iva: p?.iva || 'tasa_16',
    requiereReceta: p?.requiereReceta || false,
    esControlado: p?.esControlado || false,
    requiereRefrigeracion: p?.requiereRefrigeracion || false,
    activo: p?.activo ?? true,
    precios: Object.fromEntries(LISTAS_PRECIO.map(l => [l.clave, centavosATexto(p?.precios?.[l.clave])])),
    minimos: Object.fromEntries((p?.minimos || []).map(m => [m.sucursal, baseATexto(m.cantidad, p.unidad)]))
  };
}

// Convierte el formulario al cuerpo que espera la API (centavos y unidad base).
// Devuelve { error } si algún número no es válido.
function aCuerpo(f, original) {
  const precios = {};
  for (const { clave, nombre } of LISTAS_PRECIO) {
    const c = pesosACentavos(f.precios[clave]);
    if (Number.isNaN(c)) return { error: `Precio ${nombre}: usa pesos con máximo 2 decimales` };
    const antes = original?.precios?.[clave] ?? null;
    if (c !== antes) precios[clave] = c; // null = quitar el precio de esa lista
  }
  const minimos = [];
  for (const [sucursal, texto] of Object.entries(f.minimos)) {
    const cantidad = cantidadABase(texto, f.unidad);
    if (Number.isNaN(cantidad)) return { error: `Mínimo inválido (${f.unidad === 'kg' ? 'kg con hasta 3 decimales' : 'piezas enteras'})` };
    if (cantidad !== null) minimos.push({ sucursal, cantidad });
  }
  const { precios: _p, minimos: _m, ...resto } = f;
  return { cuerpo: { ...resto, codigoBarras: f.codigoBarras.trim(), precios, minimos } };
}

export default function ProductoFormulario({ producto, alCerrar, alGuardar }) {
  const { usuario, puede } = useAuth();
  const editable = puede('catalogo:gestionar');
  const [f, setF] = useState(() => estadoInicial(producto));
  const [guardando, setGuardando] = useState(false);
  const cambiar = (clave, valor) => setF(prev => ({ ...prev, [clave]: valor }));

  const guardar = async evento => {
    evento.preventDefault();
    const { cuerpo, error } = aCuerpo(f, producto);
    if (error) return toast.error(error);
    setGuardando(true);
    try {
      const res = producto ? await productosAPI.actualizar(producto.id, cuerpo) : await productosAPI.crear(cuerpo);
      toast.success(producto ? 'Producto actualizado' : 'Producto creado');
      alGuardar(res.data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo guardar el producto'));
    } finally {
      setGuardando(false);
    }
  };

  const porUnidad = f.unidad === 'kg' ? 'por kg' : 'por pieza';

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-10" role="dialog" aria-modal="true">
      <form onSubmit={guardar} className="bg-white rounded-xl shadow-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{producto ? producto.nombre : 'Nuevo producto'}</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500 hover:text-slate-800">
            <X />
          </button>
        </div>

        <fieldset disabled={!editable || guardando} className="space-y-5">
          <div className="grid sm:grid-cols-3 gap-4">
            <label className="sm:col-span-2 block">
              <span className="text-sm font-medium">Nombre</span>
              <input className={campo} value={f.nombre} onChange={e => cambiar('nombre', e.target.value)} required maxLength={120} />
            </label>
            <label className="block">
              <span className="text-sm font-medium">SKU</span>
              <input className={campo} value={f.sku} onChange={e => cambiar('sku', e.target.value.toUpperCase())} required maxLength={30} />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Código de barras</span>
              <input className={campo} value={f.codigoBarras} onChange={e => cambiar('codigoBarras', e.target.value)} maxLength={40} />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Categoría</span>
              <select className={campo} value={f.categoria} onChange={e => cambiar('categoria', e.target.value)}>
                {Object.entries(NOMBRES_CATEGORIA).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium">Presentación</span>
              <input className={campo} value={f.presentacion} onChange={e => cambiar('presentacion', e.target.value)} placeholder="Costal 20 kg, frasco 100 ml…" maxLength={80} />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Se vende por</span>
              <select className={campo} value={f.unidad} onChange={e => cambiar('unidad', e.target.value)}>
                <option value="pieza">Pieza</option>
                <option value="kg">Kilo (granel)</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium">IVA</span>
              <select className={campo} value={f.iva} onChange={e => cambiar('iva', e.target.value)}>
                {Object.entries(NOMBRES_IVA).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {[
              ['requiereReceta', 'Requiere receta'],
              ['esControlado', 'Medicamento controlado'],
              ['requiereRefrigeracion', 'Requiere refrigeración'],
              ['activo', 'Activo']
            ].map(([clave, texto]) => (
              <label key={clave} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={clave === 'requiereReceta' ? f.requiereReceta || f.esControlado : f[clave]}
                  disabled={clave === 'requiereReceta' && f.esControlado}
                  onChange={e => cambiar(clave, e.target.checked)}
                />
                {texto}
              </label>
            ))}
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">Precios finales con IVA ({porUnidad})</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {LISTAS_PRECIO.map(({ clave, nombre }) => (
                <label key={clave} className="block">
                  <span className="text-sm">{nombre}</span>
                  <input
                    className={campo}
                    inputMode="decimal"
                    placeholder="$0.00"
                    value={f.precios[clave]}
                    onChange={e => cambiar('precios', { ...f.precios, [clave]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-1">Si una lista queda vacía, a esos clientes se les cobra el precio de público.</p>
          </div>

          {usuario.sucursales.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2">Existencia mínima por sucursal ({f.unidad === 'kg' ? 'kg' : 'piezas'})</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {usuario.sucursales.map(s => (
                  <label key={s.id} className="block">
                    <span className="text-sm">{s.nombre}</span>
                    <input
                      className={campo}
                      inputMode="decimal"
                      value={f.minimos[s.id] || ''}
                      onChange={e => cambiar('minimos', { ...f.minimos, [s.id]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
        </fieldset>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">
            {editable ? 'Cancelar' : 'Cerrar'}
          </button>
          {editable && (
            <button type="submit" disabled={guardando} className="rounded-lg bg-emerald-600 text-white font-medium px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

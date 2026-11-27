import { useCallback, useEffect, useState } from 'react';
import { BadgePercent, Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { mensajeDeError, promocionesAPI } from '../services/api';
import { NOMBRES_CATEGORIA, formatearDinero, hoyLocal, pesosACentavos } from '../utils/formato';
import { porcentajeAPuntosBase } from '../utils/caja';
import BuscadorProducto from '../components/BuscadorProducto';

const campo = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2';
const ESTADOS = [['vigentes', 'Vigentes'], ['proximas', 'Próximas'], ['terminadas', 'Terminadas'], ['', 'Todas']];
const ALCANCES = { producto: 'Un producto', categoria: 'Una categoría', lote: 'Un lote (por caducar)' };

const valorTexto = p => (p.tipo === 'precio' ? formatearDinero(p.valor) : `${p.valor / 100} %`);
const aQuien = p => (p.alcance === 'categoria' ? NOMBRES_CATEGORIA[p.categoria] : `${p.producto?.nombre || ''}${p.lote ? ` · lote ${p.lote}` : ''}`);

// Promociones (dueño): precio o % especial con vigencia; la caja las aplica sola y sin PIN.
export default function Promociones() {
  const { puede } = useAuth();
  const editable = puede('catalogo:gestionar');
  const [estado, setEstado] = useState('vigentes');
  const [lista, setLista] = useState([]);
  const [nueva, setNueva] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setLista((await promocionesAPI.listar({ estado: estado || undefined })).data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudieron cargar las promociones'));
    }
  }, [estado]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  const alternar = async p => {
    try {
      await promocionesAPI.actualizar(p.id, { activa: !p.activa });
      toast.success(p.activa ? 'Promoción desactivada' : 'Promoción activada');
      cargar();
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo cambiar'));
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold mr-auto flex items-center gap-2"><BadgePercent size={20} aria-hidden="true" /> Promociones</h2>
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm" role="group" aria-label="Estado">
          {ESTADOS.map(([v, t]) => (
            <button key={v} type="button" onClick={() => setEstado(v)} aria-pressed={estado === v} className={`px-3 py-1.5 ${estado === v ? 'bg-emerald-600 text-white' : 'hover:bg-slate-50'}`}>{t}</button>
          ))}
        </div>
        {editable && <button type="button" onClick={() => setNueva(true)} className="flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-3 py-2 hover:bg-emerald-700"><Plus size={18} /> Nueva promoción</button>}
      </div>
      <p className="text-sm text-slate-600">La caja cobra siempre el precio más bajo entre la lista del cliente, el mayoreo por cantidad y las promociones vigentes. Las promociones no piden PIN.</p>
      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr>
            <th className="px-3 py-2">Promoción</th><th className="px-3 py-2">Aplica a</th><th className="px-3 py-2 text-right">Precio / %</th><th className="px-3 py-2">Vigencia</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2" />
          </tr></thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-slate-500">No hay promociones en esta vista.</td></tr>}
            {lista.map(p => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium">{p.nombre}</td>
                <td className="px-3 py-2">{aQuien(p)}<span className="block text-xs text-slate-500">{p.sucursales.length ? `${p.sucursales.length} sucursal(es)` : 'Todas las sucursales'}</span></td>
                <td className="px-3 py-2 text-right tabular-nums">{valorTexto(p)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{p.desde} → {p.hasta}</td>
                <td className="px-3 py-2">{p.vigente ? <span className="text-emerald-700">Vigente</span> : p.activa ? <span className="text-slate-500">Fuera de fechas</span> : <span className="text-slate-500">Desactivada</span>}</td>
                <td className="px-3 py-2 text-right">{editable && <button type="button" onClick={() => alternar(p)} className="text-emerald-700 underline">{p.activa ? 'Desactivar' : 'Activar'}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {nueva && <NuevaPromocion alCerrar={() => setNueva(false)} alGuardar={() => { setNueva(false); cargar(); }} />}
    </section>
  );
}

function NuevaPromocion({ alCerrar, alGuardar }) {
  const { usuario } = useAuth();
  const [f, setF] = useState({ nombre: '', alcance: 'producto', tipo: 'porcentaje', valor: '', categoria: 'alimento', lote: '', desde: hoyLocal(), hasta: hoyLocal(), sucursales: [] });
  const [producto, setProducto] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const cambiar = (k, v) => setF(x => ({ ...x, [k]: v, ...(k === 'alcance' && v === 'categoria' && { tipo: 'porcentaje' }) }));

  const valor = f.tipo === 'precio' ? pesosACentavos(f.valor) : porcentajeAPuntosBase(f.valor);
  const error = !f.nombre.trim() ? 'Escribe el nombre'
    : f.alcance !== 'categoria' && !producto ? 'Elige el producto'
      : f.alcance === 'lote' && !f.lote.trim() ? 'Escribe el lote'
        : !valor || Number.isNaN(valor) ? (f.tipo === 'precio' ? 'Precio en pesos' : 'Porcentaje de 0.01 a 100')
          : f.hasta < f.desde ? 'La fecha final es anterior a la inicial' : null;

  const enviar = async e => {
    e.preventDefault();
    if (error) return;
    setEnviando(true);
    try {
      await promocionesAPI.crear({
        nombre: f.nombre.trim(), alcance: f.alcance, tipo: f.tipo, valor, desde: f.desde, hasta: f.hasta,
        ...(f.alcance === 'categoria' ? { categoria: f.categoria } : { producto: producto.id }),
        ...(f.alcance === 'lote' && { lote: f.lote.trim() }),
        ...(f.sucursales.length && { sucursales: f.sucursales })
      });
      toast.success('Promoción creada');
      alGuardar();
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo crear la promoción'));
    } finally {
      setEnviando(false);
    }
  };

  const tiendas = usuario.sucursales.filter(s => s.tipo !== 'almacen');
  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true" onKeyDown={e => e.key === 'Escape' && alCerrar()}>
      <form onSubmit={enviar} className="bg-white rounded-xl shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Nueva promoción</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500"><X /></button>
        </div>
        <fieldset disabled={enviando} className="space-y-3">
          <label className="block text-sm"><span className="font-medium">Nombre</span>
            <input className={campo} value={f.nombre} onChange={e => cambiar('nombre', e.target.value)} maxLength={80} placeholder="Ej. Buen Fin, Lote por caducar" autoFocus /></label>
          <label className="block text-sm"><span className="font-medium">Aplica a</span>
            <select className={campo} value={f.alcance} onChange={e => cambiar('alcance', e.target.value)}>
              {Object.entries(ALCANCES).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select></label>
          {f.alcance === 'categoria' ? (
            <label className="block text-sm"><span className="font-medium">Categoría</span>
              <select className={campo} value={f.categoria} onChange={e => cambiar('categoria', e.target.value)}>
                {Object.entries(NOMBRES_CATEGORIA).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select></label>
          ) : (
            <div className="text-sm">
              <span className="font-medium">Producto</span>
              {producto
                ? <p className="mt-1 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">{producto.nombre} <button type="button" className="text-emerald-700 underline" onClick={() => setProducto(null)}>Cambiar</button></p>
                : <div className="mt-1"><BuscadorProducto alElegir={setProducto} placeholder="Busca el producto" /></div>}
            </div>
          )}
          {f.alcance === 'lote' && (
            <label className="block text-sm"><span className="font-medium">Lote</span>
              <input className={campo} value={f.lote} onChange={e => cambiar('lote', e.target.value)} maxLength={40} placeholder="Como viene en la etiqueta" />
              <span className="text-xs text-slate-500">La caja vende primero ese lote y aplica el precio mientras alcance su existencia.</span></label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm"><span className="font-medium">Tipo</span>
              <select className={campo} value={f.tipo} onChange={e => cambiar('tipo', e.target.value)} disabled={f.alcance === 'categoria'}>
                <option value="porcentaje">% de descuento</option>
                <option value="precio">Precio especial</option>
              </select></label>
            <label className="block text-sm"><span className="font-medium">{f.tipo === 'precio' ? 'Precio final con IVA' : 'Porcentaje'}</span>
              <input className={`${campo} text-right tabular-nums`} inputMode="decimal" value={f.valor} onChange={e => cambiar('valor', e.target.value)} placeholder={f.tipo === 'precio' ? '$0.00' : '10'} />
              {f.tipo === 'precio' && producto?.precios?.publico !== undefined && <span className="text-xs text-slate-500">Precio de público: {formatearDinero(producto.precios.publico)}</span>}</label>
            <label className="block text-sm"><span className="font-medium">Desde</span>
              <input type="date" className={campo} value={f.desde} onChange={e => cambiar('desde', e.target.value)} /></label>
            <label className="block text-sm"><span className="font-medium">Hasta (inclusive)</span>
              <input type="date" className={campo} value={f.hasta} onChange={e => cambiar('hasta', e.target.value)} /></label>
          </div>
          {tiendas.length > 1 && (
            <fieldset className="text-sm">
              <legend className="font-medium">Sucursales (sin marcar = todas)</legend>
              <div className="mt-1 flex flex-wrap gap-3">
                {tiendas.map(s => (
                  <label key={s.id} className="flex items-center gap-1">
                    <input type="checkbox" checked={f.sucursales.includes(s.id)} onChange={e => cambiar('sucursales', e.target.checked ? [...f.sucursales, s.id] : f.sucursales.filter(x => x !== s.id))} /> {s.nombre}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </fieldset>
        {error && <p className="text-sm text-slate-500">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Cancelar</button>
          <button type="submit" disabled={Boolean(error) || enviando} className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">Crear promoción</button>
        </div>
      </form>
    </div>
  );
}

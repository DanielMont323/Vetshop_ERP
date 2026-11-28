import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { mensajeDeError, pedidosAPI, proveedoresAPI } from '../../services/api';
import { baseATexto, cantidadABase, centavosATexto, formatearDinero, pesosACentavos } from '../../utils/formato';
import BuscadorProducto from '../BuscadorProducto';

let siguienteClave = 0;
const fila = p => ({ clave: (siguienteClave += 1), producto: p.producto, sku: p.sku, nombre: p.nombre, unidad: p.unidad, cantidad: p.cantidad ? baseATexto(p.cantidad, p.unidad) : '', costo: p.costoEstimado ? centavosATexto(p.costoEstimado) : '' });

// Alta o edición (borrador) de un pedido a proveedor. `pedido` puede ser uno guardado o uno armado desde
// compras sugeridas ({ proveedor, partidas, origen: 'sugeridas' }).
export default function PedidoFormulario({ pedido, alCerrar, alGuardar }) {
  const [proveedores, setProveedores] = useState([]);
  const [proveedor, setProveedor] = useState(pedido?.proveedor?.id || '');
  const [notas, setNotas] = useState(pedido?.notas || '');
  const [partidas, setPartidas] = useState(() => (pedido?.partidas || []).map(fila));
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    proveedoresAPI.listar({ activo: true }).then(r => setProveedores(r.data.datos)).catch(() => {});
  }, []);

  const agregar = producto => {
    if (partidas.some(p => p.producto === producto.id)) return toast.error(`${producto.nombre} ya está en el pedido`);
    setPartidas(ls => [...ls, fila({ producto: producto.id, sku: producto.sku, nombre: producto.nombre, unidad: producto.unidad })]);
  };
  const cambiar = (i, k, v) => setPartidas(ls => ls.map((p, j) => (j === i ? { ...p, [k]: v } : p)));

  const filas = partidas.map(p => ({ ...p, base: cantidadABase(p.cantidad, p.unidad), centavos: p.costo === '' ? null : pesosACentavos(p.costo) }));
  const total = filas.reduce((s, p) => s + (p.base && p.centavos ? (p.unidad === 'kg' ? Math.round((p.centavos * p.base) / 1000) : p.centavos * p.base) : 0), 0);
  const error = !proveedor ? 'Elige el proveedor'
    : !filas.length ? 'Agrega al menos un producto'
      : filas.find(p => !p.base || Number.isNaN(p.base)) ? `${filas.find(p => !p.base || Number.isNaN(p.base)).nombre}: cantidad inválida`
        : filas.find(p => Number.isNaN(p.centavos)) ? 'Costo en pesos, máximo 2 decimales' : null;

  const guardar = async e => {
    e.preventDefault();
    if (error) return toast.error(error);
    setEnviando(true);
    const cuerpo = {
      proveedor, notas: notas.trim() || undefined, ...(pedido?.origen && !pedido.id && { origen: pedido.origen }),
      partidas: filas.map(p => ({ producto: p.producto, cantidad: p.base, ...(p.centavos !== null && { costoEstimado: p.centavos }) }))
    };
    try {
      const { data } = pedido?.id ? await pedidosAPI.actualizar(pedido.id, cuerpo) : await pedidosAPI.crear(cuerpo);
      toast.success(pedido?.id ? 'Pedido guardado' : `Pedido ${data.datos.folio} creado`);
      alGuardar(data.datos);
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo guardar el pedido'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true" onKeyDown={e => e.key === 'Escape' && alCerrar()}>
      <form onSubmit={guardar} className="bg-white rounded-xl shadow-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{pedido?.id ? `Pedido ${pedido.folio}` : 'Nuevo pedido a proveedor'}</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500"><X /></button>
        </div>
        <fieldset disabled={enviando} className="space-y-3">
          <label className="block text-sm"><span className="font-medium">Proveedor</span>
            <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={proveedor} onChange={e => setProveedor(e.target.value)}>
              <option value="">Elige…</option>
              {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select></label>
          <BuscadorProducto alElegir={agregar} placeholder="Agregar producto al pedido" />
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left"><tr><th className="px-2 py-2">Producto</th><th className="px-2 py-2 w-28 text-right">Cantidad</th><th className="px-2 py-2 w-32 text-right">Costo est. (sin IVA)</th><th className="w-8" /></tr></thead>
            <tbody>
              {filas.length === 0 && <tr><td colSpan={4} className="px-2 py-4 text-center text-slate-500">Busca productos para agregarlos.</td></tr>}
              {filas.map((p, i) => (
                <tr key={p.clave} className="border-t border-slate-100">
                  <td className="px-2 py-1.5">{p.nombre}<span className="block text-xs font-mono text-slate-500">{p.sku}</span></td>
                  <td className="px-2 py-1.5"><input className="w-full rounded border border-slate-300 px-2 py-1 text-right" inputMode="decimal" aria-label={`Cantidad de ${p.nombre}`} placeholder={p.unidad === 'kg' ? 'kg' : 'pzas'} value={p.cantidad} onChange={e => cambiar(i, 'cantidad', e.target.value)} /></td>
                  <td className="px-2 py-1.5"><input className="w-full rounded border border-slate-300 px-2 py-1 text-right" inputMode="decimal" aria-label={`Costo de ${p.nombre}`} placeholder="$0.00" value={p.costo} onChange={e => cambiar(i, 'costo', e.target.value)} /></td>
                  <td className="px-2 py-1.5"><button type="button" onClick={() => setPartidas(ls => ls.filter((_, j) => j !== i))} aria-label={`Quitar ${p.nombre}`} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <label className="block text-sm"><span className="font-medium">Notas para el proveedor</span>
            <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={notas} onChange={e => setNotas(e.target.value)} maxLength={500} placeholder="Ej. entregar por la mañana" /></label>
        </fieldset>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm tabular-nums">Estimado: <strong>{formatearDinero(total)}</strong></span>
          <div className="flex gap-3">
            <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Cancelar</button>
            <button type="submit" disabled={enviando} className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">Guardar borrador</button>
          </div>
        </div>
      </form>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { existenciasAPI, mensajeDeError, traspasosAPI } from '../../services/api';
import { cantidadABase, formatearCantidad } from '../../utils/formato';
import BuscadorProducto from '../BuscadorProducto';

let siguiente = 0;

// Enviar mercancía desde la sucursal activa a otra. Sale por caducidad (FEFO); los caducados no se envían.
export default function TraspasoNuevo({ alCerrar, alEnviar }) {
  const { usuario, sucursalActiva } = useAuth();
  const origen = usuario.sucursales.find(s => s.id === sucursalActiva);
  const [destinos, setDestinos] = useState([]);
  const [destino, setDestino] = useState('');
  const [partidas, setPartidas] = useState([]);
  const [observaciones, setObservaciones] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    traspasosAPI.destinos().then(r => setDestinos(r.data.datos)).catch(e => toast.error(mensajeDeError(e, 'No se pudieron cargar las sucursales')));
  }, []);

  // Cuánto se puede enviar: lo vigente (no caducado) de la sucursal de origen
  const agregar = async producto => {
    if (partidas.some(p => p.producto.id === producto.id)) return toast.error('Ese producto ya está en el traspaso');
    let disponible = null;
    try {
      const r = await existenciasAPI.lotes(producto.id);
      disponible = r.data.datos.filter(l => String(l.sucursal.id) === sucursalActiva && l.estado !== 'caducado').reduce((s, l) => s + l.cantidad, 0);
    } catch {
      disponible = null;
    }
    if (disponible === 0) toast.error(`No hay ${producto.nombre} vigente en ${origen?.nombre || 'esta sucursal'}`);
    siguiente += 1;
    const clave = siguiente;
    setPartidas(ps => [...ps, { clave, producto, cantidad: '', disponible }]);
  };

  const enviar = async e => {
    e.preventDefault();
    if (!destino) return toast.error('Elige la sucursal destino');
    if (!partidas.length) return toast.error('Agrega al menos un producto');
    const filas = [];
    for (const p of partidas) {
      const cantidad = cantidadABase(p.cantidad, p.producto.unidad);
      if (!cantidad || Number.isNaN(cantidad)) return toast.error(`${p.producto.nombre}: cantidad inválida`);
      filas.push({ producto: p.producto.id, cantidad });
    }
    setEnviando(true);
    try {
      const r = await traspasosAPI.enviar({ destino, partidas: filas, observaciones: observaciones.trim() || undefined });
      toast.success(`Traspaso T-${r.data.datos.folio} enviado: la mercancía ya salió de esta sucursal`);
      alEnviar(r.data.datos);
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo enviar el traspaso'), { duration: 6000 });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true">
      <form onSubmit={enviar} className="bg-white rounded-xl shadow-lg w-full max-w-2xl max-h-[92vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Nuevo traspaso desde {origen?.nombre || 'la sucursal activa'}</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500"><X /></button>
        </div>
        <fieldset disabled={enviando} className="space-y-3">
          <label className="block text-sm"><span className="font-medium">Enviar a</span>
            <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={destino} onChange={e => setDestino(e.target.value)} required>
              <option value="">Elige la sucursal…</option>
              {destinos.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </label>
          <BuscadorProducto alElegir={agregar} />
          {partidas.map((p, i) => (
            <div key={p.clave} className="grid grid-cols-[1fr_7rem_auto] gap-2 items-center">
              <span className="text-sm">
                {p.producto.nombre} <span className="font-mono text-xs text-slate-500">{p.producto.sku}</span>
                {p.disponible !== null && (
                  <span className={`block text-xs ${p.disponible === 0 ? 'text-red-700' : 'text-slate-500'}`}>Disponible: {formatearCantidad(p.disponible, p.producto.unidad)}</span>
                )}
              </span>
              <input className="rounded border border-slate-300 px-2 py-1 text-right" inputMode="decimal" placeholder={p.producto.unidad === 'kg' ? 'kg' : 'pzas'} aria-label={`Cantidad de ${p.producto.nombre}`}
                value={p.cantidad} onChange={e => setPartidas(ps => ps.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)))} />
              <button type="button" onClick={() => setPartidas(ps => ps.filter((_, j) => j !== i))} aria-label={`Quitar ${p.producto.nombre}`} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
            </div>
          ))}
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Observaciones (opcional)" value={observaciones} onChange={e => setObservaciones(e.target.value)} maxLength={500} />
        </fieldset>
        <p className="text-xs text-slate-500">Sale de {origen?.nombre || 'la sucursal activa'} (cámbiala en el selector de arriba). Sale primero lo que caduca antes; los lotes caducados no se envían.</p>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Cancelar</button>
          <button type="submit" disabled={enviando} className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">{enviando ? 'Enviando…' : 'Enviar'}</button>
        </div>
      </form>
    </div>
  );
}

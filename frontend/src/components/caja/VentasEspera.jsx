import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { mensajeDeError, ventasAPI } from '../../services/api';
import { formatearFecha } from '../../utils/formato';

// Lista de ventas en espera de la sucursal: recuperar al carrito o borrar.
export default function VentasEspera({ alRecuperar, alCerrar }) {
  const [lista, setLista] = useState(null);

  const cargar = () =>
    ventasAPI.listarEspera().then(r => setLista(r.data.datos)).catch(e => {
      toast.error(mensajeDeError(e, 'No se pudieron cargar las ventas en espera'));
      setLista([]);
    });

  useEffect(() => {
    cargar();
  }, []);

  const borrar = async id => {
    if (!window.confirm('¿Borrar esta venta en espera?')) return;
    try {
      await ventasAPI.eliminarEspera(id);
      cargar();
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo borrar'));
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true" onKeyDown={e => e.key === 'Escape' && alCerrar()}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Ventas en espera</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500 hover:text-slate-800"><X /></button>
        </div>
        {lista === null && <p className="text-slate-500">Cargando…</p>}
        {lista?.length === 0 && <p className="text-slate-500">No hay ventas en espera.</p>}
        <ul className="divide-y divide-slate-100">
          {lista?.map(e => (
            <li key={e.id} className="py-2 flex items-center gap-3">
              <div className="flex-1">
                <p className="font-medium">{e.nota || 'Sin nota'}</p>
                <p className="text-xs text-slate-500">{e.partidas.length} producto{e.partidas.length === 1 ? '' : 's'} · {formatearFecha(e.creada, true)}</p>
              </div>
              <button type="button" onClick={() => alRecuperar(e)} className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-sm hover:bg-emerald-700">Recuperar</button>
              <button type="button" onClick={() => borrar(e.id)} className="rounded-lg border border-red-300 text-red-700 px-3 py-1.5 text-sm hover:bg-red-50">Borrar</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

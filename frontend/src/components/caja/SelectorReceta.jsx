import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { mensajeDeError, recetasAPI } from '../../services/api';
import { formatearCantidad, formatearFecha } from '../../utils/formato';

// Elige la receta validada con la que se surte un medicamento en la caja.
export default function SelectorReceta({ producto, alElegir, alCerrar }) {
  const [lista, setLista] = useState(null);

  useEffect(() => {
    recetasAPI.disponibles(producto.id).then(r => setLista(r.data.datos)).catch(e => {
      toast.error(mensajeDeError(e, 'No se pudieron cargar las recetas'));
      setLista([]);
    });
  }, [producto.id]);

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-30" role="dialog" aria-modal="true" onKeyDown={e => e.key === 'Escape' && alCerrar()}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Receta para {producto.nombre}</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500"><X /></button>
        </div>
        {lista === null && <p className="text-slate-500">Cargando…</p>}
        {lista?.length === 0 && (
          <p className="text-sm text-slate-600">
            No hay recetas validadas con pendiente de este medicamento. Captúrala en <Link to="/recetas" className="text-emerald-700 underline">Recetas</Link> y pide al médico responsable que la valide.
          </p>
        )}
        <ul className="divide-y divide-slate-100">
          {lista?.map(r => (
            <li key={r.id} className="py-2 flex items-center gap-3">
              <div className="flex-1 text-sm">
                <p className="font-medium">R-{r.folio} · {r.paciente.nombre} ({r.paciente.especie})</p>
                <p className="text-slate-500">{r.propietario.nombre} · {r.medico.nombre} · {formatearFecha(r.fechaReceta)}</p>
                <p>Pendiente de surtir: <strong>{formatearCantidad(r.partida.pendiente, producto.unidad)}</strong> de {formatearCantidad(r.partida.cantidadPrescrita, producto.unidad)}</p>
              </div>
              <button type="button" onClick={() => alElegir({ id: r.id, folio: r.folio, pendiente: r.partida.pendiente })} className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-sm hover:bg-emerald-700">Usar</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

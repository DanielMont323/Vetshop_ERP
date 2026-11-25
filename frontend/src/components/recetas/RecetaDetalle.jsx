import { useState } from 'react';
import { FileUp, Paperclip, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { mensajeDeError, recetasAPI } from '../../services/api';
import { NOMBRES_ESTADO_RECETA, formatearCantidad, formatearFecha } from '../../utils/formato';

// Detalle de una receta: medicamentos y entregas, archivo, validación (médico + PIN) y cancelación.
export default function RecetaDetalle({ receta: inicial, alCerrar, alCambiar, alEditar }) {
  const [receta, setReceta] = useState(inicial);
  const [medico, setMedico] = useState('');
  const [pin, setPin] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const estado = NOMBRES_ESTADO_RECETA[receta.estado];
  const editable = ['pendiente', 'validada'].includes(receta.estado);
  const tieneControlado = receta.partidas.some(p => p.esControlado);

  const actualizar = nueva => {
    setReceta(nueva);
    alCambiar();
  };

  const subir = async e => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    if (archivo.size > 5 * 1024 * 1024) return toast.error('El archivo pesa más de 5 MB');
    setOcupado(true);
    try {
      await recetasAPI.subirArchivo(receta.id, archivo);
      actualizar((await recetasAPI.obtener(receta.id)).data.datos);
      toast.success('Archivo adjuntado');
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo subir el archivo'));
    } finally {
      setOcupado(false);
    }
  };

  const verArchivo = async () => {
    try {
      const r = await recetasAPI.archivo(receta.id);
      const url = URL.createObjectURL(r.data);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo abrir el archivo'));
    }
  };

  const validar = async e => {
    e.preventDefault();
    setOcupado(true);
    try {
      actualizar((await recetasAPI.validar(receta.id, { usuario: medico.trim(), pin })).data.datos);
      toast.success('Receta validada: ya se puede surtir en caja');
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo validar'));
      setPin('');
    } finally {
      setOcupado(false);
    }
  };

  const cancelar = async () => {
    const motivo = window.prompt('¿Por qué se cancela la receta?');
    if (!motivo) return;
    try {
      actualizar((await recetasAPI.cancelar(receta.id, motivo)).data.datos);
      toast.success('Receta cancelada');
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo cancelar'));
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-3xl max-h-[92vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-3">
            Receta R-{receta.folio}
            <span className={`rounded px-2 py-0.5 text-xs ${estado.clase}`}>{estado.texto}</span>
          </h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500"><X /></button>
        </div>

        <dl className="grid sm:grid-cols-3 gap-3 text-sm">
          <div><dt className="text-slate-500">Fecha</dt><dd>{formatearFecha(receta.fechaReceta)}</dd></div>
          <div><dt className="text-slate-500">Médico</dt><dd>{receta.medico.nombre} · Céd. {receta.medico.cedula}</dd></div>
          <div><dt className="text-slate-500">Propietario</dt><dd>{receta.propietario.nombre}{receta.propietario.telefono && ` · ${receta.propietario.telefono}`}</dd></div>
          <div><dt className="text-slate-500">Paciente</dt><dd>{receta.paciente.nombre} ({receta.paciente.especie})</dd></div>
          {receta.validadaPor && <div><dt className="text-slate-500">Validó</dt><dd>{receta.validadaPor} · {formatearFecha(receta.fechaValidacion, true)}</dd></div>}
        </dl>

        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr><th className="px-2 py-2">Medicamento</th><th className="px-2 py-2 text-right">Prescrito</th><th className="px-2 py-2 text-right">Entregado</th><th className="px-2 py-2">Entregas (venta · lotes)</th></tr>
          </thead>
          <tbody>
            {receta.partidas.map(p => (
              <tr key={String(p.producto)} className="border-t border-slate-100 align-top">
                <td className="px-2 py-2">{p.nombre}{p.esControlado && <span className="ml-1 text-xs text-red-700">controlado</span>}{p.indicaciones && <span className="block text-xs text-slate-500">{p.indicaciones}</span>}</td>
                <td className="px-2 py-2 text-right">{formatearCantidad(p.cantidadPrescrita, p.unidad)}</td>
                <td className="px-2 py-2 text-right">{formatearCantidad(p.cantidadEntregada, p.unidad)}</td>
                <td className="px-2 py-2 text-xs">{p.entregas.map(e => <div key={`${e.venta}-${e.folio}`}>{e.folio} · {e.lotes.map(l => `${l.lote || 's/l'} (${l.cantidad})`).join(', ')}</div>)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          {receta.archivo ? (
            <button type="button" onClick={verArchivo} className="flex items-center gap-1 text-emerald-700 underline"><Paperclip size={14} /> {receta.archivo.nombre}</button>
          ) : (
            <span className={tieneControlado ? 'text-red-700' : 'text-slate-500'}>Sin archivo{tieneControlado && ' (obligatorio para validar: tiene un controlado)'}</span>
          )}
          {editable && (
            <label className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 cursor-pointer hover:bg-slate-50">
              <FileUp size={14} /> {receta.archivo ? 'Reemplazar' : 'Adjuntar'} foto o PDF
              <input type="file" accept="image/jpeg,image/png,application/pdf" className="sr-only" onChange={subir} disabled={ocupado} />
            </label>
          )}
        </div>

        {receta.estado === 'pendiente' && (
          <form onSubmit={validar} className="rounded-lg bg-amber-50 p-3 grid sm:grid-cols-[1fr_8rem_auto] gap-2 items-end">
            <p className="sm:col-span-3 text-sm text-amber-900">Validación del médico responsable</p>
            <input className="rounded border border-slate-300 px-2 py-1.5" placeholder="Usuario del médico" aria-label="Usuario del médico responsable" value={medico} onChange={e => setMedico(e.target.value)} required autoComplete="off" />
            <input className="rounded border border-slate-300 px-2 py-1.5" type="password" inputMode="numeric" placeholder="PIN" aria-label="PIN del médico" value={pin} onChange={e => setPin(e.target.value)} required autoComplete="off" />
            <button type="submit" disabled={ocupado} className="rounded-lg bg-emerald-600 text-white px-4 py-1.5 hover:bg-emerald-700 disabled:opacity-60">Validar</button>
          </form>
        )}

        <div className="flex justify-end gap-3">
          {editable && receta.partidas.every(p => p.cantidadEntregada === 0) && (
            <button type="button" onClick={cancelar} className="mr-auto rounded-lg border border-red-300 text-red-700 px-4 py-2 hover:bg-red-50">Cancelar receta</button>
          )}
          {receta.estado === 'pendiente' && <button type="button" onClick={() => alEditar(receta)} className="rounded-lg border border-slate-300 px-4 py-2">Editar</button>}
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Cerrar</button>
        </div>
      </div>
    </div>
  );
}

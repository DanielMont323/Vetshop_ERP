import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { mensajeDeError, recetasAPI } from '../../services/api';
import { baseATexto, cantidadABase, diaLocalDe, hoyLocal } from '../../utils/formato';
import BuscadorProducto from '../BuscadorProducto';

const campo = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500';
let siguiente = 0;

// Captura o edición (mientras está pendiente) de una receta.
export default function RecetaFormulario({ receta, alCerrar, alGuardar }) {
  const [f, setF] = useState({
    fechaReceta: receta ? diaLocalDe(receta.fechaReceta) : hoyLocal(),
    medicoNombre: receta?.medico.nombre || '',
    cedula: receta?.medico.cedula || '',
    propietario: receta?.propietario.nombre || '',
    telefono: receta?.propietario.telefono || '',
    paciente: receta?.paciente.nombre || '',
    especie: receta?.paciente.especie || '',
    observaciones: receta?.observaciones || ''
  });
  const [partidas, setPartidas] = useState(() => (receta?.partidas || []).map(p => ({
    clave: (siguiente += 1), producto: { id: p.producto, nombre: p.nombre, sku: p.sku, unidad: p.unidad },
    cantidad: baseATexto(p.cantidadPrescrita, p.unidad), indicaciones: p.indicaciones || ''
  })));
  const [guardando, setGuardando] = useState(false);
  const cambiar = (k, v) => setF(x => ({ ...x, [k]: v }));

  const agregar = producto => {
    if (!producto.requiereReceta) return toast.error(`${producto.nombre} no requiere receta`);
    if (partidas.some(p => p.producto.id === producto.id)) return toast.error('Ese medicamento ya está en la receta');
    setPartidas(ps => [...ps, { clave: (siguiente += 1), producto, cantidad: '', indicaciones: '' }]);
  };

  const guardar = async e => {
    e.preventDefault();
    if (!partidas.length) return toast.error('Agrega al menos un medicamento');
    const filas = [];
    for (const p of partidas) {
      const cantidadPrescrita = cantidadABase(p.cantidad, p.producto.unidad);
      if (!cantidadPrescrita || Number.isNaN(cantidadPrescrita)) return toast.error(`${p.producto.nombre}: cantidad inválida`);
      filas.push({ producto: p.producto.id, cantidadPrescrita, indicaciones: p.indicaciones.trim() || undefined });
    }
    const cuerpo = {
      fechaReceta: f.fechaReceta,
      medico: { nombre: f.medicoNombre.trim(), cedula: f.cedula.trim() },
      propietario: { nombre: f.propietario.trim(), telefono: f.telefono.trim() || undefined },
      paciente: { nombre: f.paciente.trim(), especie: f.especie.trim() },
      observaciones: f.observaciones.trim() || undefined,
      partidas: filas
    };
    setGuardando(true);
    try {
      const r = receta ? await recetasAPI.actualizar(receta.id, cuerpo) : await recetasAPI.crear(cuerpo);
      toast.success(receta ? 'Receta actualizada' : `Receta R-${r.data.datos.folio} capturada. Falta que la valide el médico responsable.`);
      alGuardar(r.data.datos);
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo guardar la receta'));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true">
      <form onSubmit={guardar} className="bg-white rounded-xl shadow-lg w-full max-w-3xl max-h-[92vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{receta ? `Receta R-${receta.folio}` : 'Nueva receta'}</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500"><X /></button>
        </div>
        <fieldset disabled={guardando} className="grid sm:grid-cols-3 gap-3">
          <label className="block"><span className="text-sm font-medium">Fecha de la receta</span>
            <input type="date" className={campo} value={f.fechaReceta} max={hoyLocal()} onChange={e => cambiar('fechaReceta', e.target.value)} required /></label>
          <label className="block"><span className="text-sm font-medium">Médico que prescribe</span>
            <input className={campo} value={f.medicoNombre} onChange={e => cambiar('medicoNombre', e.target.value)} required maxLength={120} /></label>
          <label className="block"><span className="text-sm font-medium">Cédula profesional</span>
            <input className={campo} value={f.cedula} onChange={e => cambiar('cedula', e.target.value)} required maxLength={20} /></label>
          <label className="block"><span className="text-sm font-medium">Propietario</span>
            <input className={campo} value={f.propietario} onChange={e => cambiar('propietario', e.target.value)} required maxLength={120} /></label>
          <label className="block"><span className="text-sm font-medium">Teléfono</span>
            <input className={campo} value={f.telefono} onChange={e => cambiar('telefono', e.target.value)} maxLength={20} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="text-sm font-medium">Paciente</span>
              <input className={campo} value={f.paciente} onChange={e => cambiar('paciente', e.target.value)} required maxLength={80} /></label>
            <label className="block"><span className="text-sm font-medium">Especie</span>
              <input className={campo} value={f.especie} onChange={e => cambiar('especie', e.target.value)} required maxLength={40} placeholder="Perro, gato…" /></label>
          </div>
        </fieldset>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Medicamentos</h3>
          <BuscadorProducto alElegir={agregar} placeholder="Busca el medicamento" />
          {partidas.map((p, i) => (
            <div key={p.clave} className="grid grid-cols-[1fr_6rem_1fr_auto] gap-2 items-center">
              <span className="text-sm">{p.producto.nombre} <span className="font-mono text-xs text-slate-500">{p.producto.sku}</span></span>
              <input className="rounded border border-slate-300 px-2 py-1 text-right" inputMode="decimal" placeholder={p.producto.unidad === 'kg' ? 'kg' : 'pzas'} aria-label={`Cantidad prescrita de ${p.producto.nombre}`}
                value={p.cantidad} onChange={e => setPartidas(ps => ps.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)))} />
              <input className="rounded border border-slate-300 px-2 py-1" placeholder="Indicaciones" aria-label={`Indicaciones de ${p.producto.nombre}`} maxLength={300}
                value={p.indicaciones} onChange={e => setPartidas(ps => ps.map((x, j) => (j === i ? { ...x, indicaciones: e.target.value } : x)))} />
              <button type="button" onClick={() => setPartidas(ps => ps.filter((_, j) => j !== i))} aria-label={`Quitar ${p.producto.nombre}`} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>

        <label className="block"><span className="text-sm font-medium">Observaciones</span>
          <input className={campo} value={f.observaciones} onChange={e => cambiar('observaciones', e.target.value)} maxLength={500} /></label>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Cancelar</button>
          <button type="submit" disabled={guardando} className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">{guardando ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </div>
  );
}

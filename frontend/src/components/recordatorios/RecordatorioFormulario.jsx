import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { mascotasAPI, mensajeDeError, recordatoriosAPI } from '../../services/api';
import { hoyLocal } from '../../utils/formato';
import { DIAS_ANTES, REPETIR_POR_DEFECTO, TIPOS_RECORDATORIO, sumarDias } from '../../utils/recordatorios';

const campo = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2';

// Alta de un recordatorio para un cliente (desde su ficha o desde la caja después de vender alimento).
// `inicial` puede traer { tipo, descripcion, producto, enDias }.
export default function RecordatorioFormulario({ cliente, inicial = {}, alCerrar, alGuardar }) {
  const tipoInicial = inicial.tipo || 'cita';
  const [mascotas, setMascotas] = useState([]);
  const [f, setF] = useState({
    tipo: tipoInicial,
    descripcion: inicial.descripcion || '',
    mascota: '',
    fecha: sumarDias(hoyLocal(), inicial.enDias ?? (tipoInicial === 'cita' ? 7 : Number(REPETIR_POR_DEFECTO[tipoInicial]) || 7)),
    diasAntes: String(DIAS_ANTES[tipoInicial]),
    repetir: REPETIR_POR_DEFECTO[tipoInicial]
  });
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    mascotasAPI.listar(cliente.id).then(r => {
      setMascotas(r.data.datos);
      if (r.data.datos.length === 1) setF(x => ({ ...x, mascota: r.data.datos[0].id }));
    }).catch(() => setMascotas([]));
  }, [cliente.id]);

  const cambiarTipo = tipo => setF(x => ({ ...x, tipo, diasAntes: String(DIAS_ANTES[tipo]), repetir: REPETIR_POR_DEFECTO[tipo] }));
  const error = !f.descripcion.trim() ? 'Describe el recordatorio' : f.fecha < hoyLocal() ? 'La fecha ya pasó' : null;

  const enviar = async e => {
    e.preventDefault();
    if (error) return;
    setEnviando(true);
    try {
      const { data } = await recordatoriosAPI.crear({
        cliente: cliente.id, tipo: f.tipo, descripcion: f.descripcion.trim(), fecha: f.fecha, diasAntes: Number(f.diasAntes) || 0,
        ...(f.mascota && { mascota: f.mascota }), ...(f.repetir && { repetirCadaDias: Number(f.repetir) }),
        ...(inicial.producto && { producto: inicial.producto })
      });
      toast.success(data.datos.reprogramado ? 'Recordatorio reprogramado' : 'Recordatorio programado');
      alGuardar?.(data.datos);
      alCerrar();
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo programar'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-30" role="dialog" aria-modal="true" onKeyDown={e => e.key === 'Escape' && alCerrar()}>
      <form onSubmit={enviar} className="bg-white rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recordatorio para {cliente.nombre}</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500"><X /></button>
        </div>
        <fieldset disabled={enviando} className="grid grid-cols-2 gap-3">
          <label className="block text-sm"><span className="font-medium">Tipo</span>
            <select className={campo} value={f.tipo} onChange={e => cambiarTipo(e.target.value)}>
              {Object.entries(TIPOS_RECORDATORIO).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select></label>
          <label className="block text-sm"><span className="font-medium">Mascota</span>
            <select className={campo} value={f.mascota} onChange={e => setF({ ...f, mascota: e.target.value })}>
              <option value="">{mascotas.length ? '(ninguna)' : 'Sin mascotas registradas'}</option>
              {mascotas.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
            </select></label>
          <label className="col-span-2 block text-sm"><span className="font-medium">¿Qué hay que recordar?</span>
            <input className={campo} value={f.descripcion} onChange={e => setF({ ...f, descripcion: e.target.value })} maxLength={150}
              placeholder={f.tipo === 'cita' ? 'Ej. Estética en Patitas, consulta en su veterinario' : 'Ej. Croqueta adulto 20 kg'} autoFocus /></label>
          <label className="block text-sm"><span className="font-medium">Fecha</span>
            <input type="date" className={campo} value={f.fecha} min={hoyLocal()} onChange={e => setF({ ...f, fecha: e.target.value })} /></label>
          <label className="block text-sm"><span className="font-medium">Avisar días antes</span>
            <input className={campo} inputMode="numeric" value={f.diasAntes} onChange={e => setF({ ...f, diasAntes: e.target.value.replace(/\D/g, '').slice(0, 2) })} /></label>
          <label className="col-span-2 block text-sm"><span className="font-medium">Se repite</span>
            <select className={campo} value={f.repetir} onChange={e => setF({ ...f, repetir: e.target.value })}>
              <option value="">No se repite</option>
              {[['15', 'Cada 15 días'], ['30', 'Cada 30 días'], ['45', 'Cada 45 días'], ['60', 'Cada 2 meses'], ['90', 'Cada 3 meses'], ['180', 'Cada 6 meses'], ['365', 'Cada año']].map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select></label>
        </fieldset>
        {error && <p className="text-sm text-slate-500">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Cancelar</button>
          <button type="submit" disabled={Boolean(error) || enviando} className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">Programar</button>
        </div>
      </form>
    </div>
  );
}

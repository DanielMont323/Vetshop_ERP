import { useCallback, useEffect, useState } from 'react';
import { BellPlus, PawPrint, Star, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { clientesAPI, mascotasAPI, mensajeDeError, recordatoriosAPI } from '../../services/api';
import { formatearDinero, formatearFecha } from '../../utils/formato';
import { ESPECIES, TIPOS_RECORDATORIO, fechaLarga } from '../../utils/recordatorios';
import RecordatorioFormulario from '../recordatorios/RecordatorioFormulario';

const campo = 'rounded border border-slate-300 px-2 py-1.5 text-sm';
const vacia = { nombre: '', especie: 'perro', raza: '', nacimiento: '', peso: '' };
const NOMBRES_MOVIMIENTO = { acumulo: 'Compra', canje: 'Pagó con puntos', cancelacion: 'Venta cancelada', ajuste: 'Ajuste' };

// Ficha del cliente para la caja: mascotas, recordatorios abiertos y lealtad.
export default function FichaCliente({ cliente, configLealtad, alCerrar }) {
  const [mascotas, setMascotas] = useState([]);
  const [recordatorios, setRecordatorios] = useState([]);
  const [lealtad, setLealtad] = useState(null);
  const [nueva, setNueva] = useState(vacia);
  const [programando, setProgramando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [m, r, l] = await Promise.all([
        mascotasAPI.listar(cliente.id),
        recordatoriosAPI.listar({ vista: 'abiertos', cliente: cliente.id }),
        cliente.tipo === 'publico' ? clientesAPI.lealtad(cliente.id) : Promise.resolve(null)
      ]);
      setMascotas(m.data.datos);
      setRecordatorios(r.data.datos);
      setLealtad(l?.data.datos || null);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo cargar la ficha'));
    }
  }, [cliente.id, cliente.tipo]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  const agregarMascota = async e => {
    e.preventDefault();
    const peso = nueva.peso ? Math.round(Number(String(nueva.peso).replace(',', '.')) * 1000) : undefined;
    if (nueva.peso && Number.isNaN(peso)) return toast.error('Peso en kg, por ejemplo 12.5');
    try {
      await mascotasAPI.crear({ cliente: cliente.id, nombre: nueva.nombre.trim(), especie: nueva.especie, raza: nueva.raza.trim(), ...(nueva.nacimiento && { nacimiento: nueva.nacimiento }), ...(peso !== undefined && { peso }) });
      toast.success(`${nueva.nombre} registrado`);
      setNueva(vacia);
      cargar();
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo registrar la mascota'));
    }
  };

  const baja = async m => {
    try {
      await mascotasAPI.actualizar(m.id, { activa: false });
      cargar();
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo dar de baja'));
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true" onKeyDown={e => e.key === 'Escape' && !programando && alCerrar()}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{cliente.nombre}</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500"><X /></button>
        </div>

        <section className="space-y-2">
          <h3 className="font-semibold flex items-center gap-2"><PawPrint size={18} aria-hidden="true" /> Mascotas</h3>
          {mascotas.length === 0 && <p className="text-sm text-slate-500">Sin mascotas registradas.</p>}
          <ul className="divide-y divide-slate-100 text-sm">
            {mascotas.map(m => (
              <li key={m.id} className="flex items-center gap-3 py-1.5">
                <span className="font-medium">{m.nombre}</span>
                <span className="text-slate-600">{ESPECIES[m.especie]}{m.raza ? ` · ${m.raza}` : ''}{m.peso ? ` · ${(m.peso / 1000).toLocaleString('es-MX')} kg` : ''}{m.nacimiento ? ` · nació ${formatearFecha(`${m.nacimiento}T12:00:00Z`)}` : ''}</span>
                <button type="button" onClick={() => baja(m)} className="ml-auto text-xs text-slate-500 underline">Dar de baja</button>
              </li>
            ))}
          </ul>
          <form onSubmit={agregarMascota} className="grid grid-cols-2 sm:grid-cols-[1fr_7rem_1fr_9rem_5rem_auto] gap-2 items-end">
            <input className={campo} placeholder="Nombre" aria-label="Nombre de la mascota" value={nueva.nombre} onChange={e => setNueva({ ...nueva, nombre: e.target.value })} required maxLength={60} />
            <select className={campo} aria-label="Especie" value={nueva.especie} onChange={e => setNueva({ ...nueva, especie: e.target.value })}>
              {Object.entries(ESPECIES).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
            <input className={campo} placeholder="Raza" aria-label="Raza" value={nueva.raza} onChange={e => setNueva({ ...nueva, raza: e.target.value })} maxLength={60} />
            <input type="date" className={campo} aria-label="Nacimiento" value={nueva.nacimiento} onChange={e => setNueva({ ...nueva, nacimiento: e.target.value })} />
            <input className={campo} placeholder="kg" inputMode="decimal" aria-label="Peso en kg" value={nueva.peso} onChange={e => setNueva({ ...nueva, peso: e.target.value })} />
            <button type="submit" className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-sm hover:bg-emerald-700">Agregar</button>
          </form>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Recordatorios</h3>
            <button type="button" onClick={() => setProgramando(true)} className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"><BellPlus size={16} /> Nuevo recordatorio</button>
          </div>
          {recordatorios.length === 0 && <p className="text-sm text-slate-500">Sin recordatorios abiertos.</p>}
          <ul className="divide-y divide-slate-100 text-sm">
            {recordatorios.map(r => (
              <li key={r.id} className="py-1.5">
                <span className="font-medium">{TIPOS_RECORDATORIO[r.tipo]}</span>{r.mascota ? ` · ${r.mascota.nombre}` : ''}: {r.descripcion}
                <span className="block text-xs text-slate-500">{fechaLarga(r.fecha)} · aviso {r.diasAntes} días antes{r.repetirCadaDias ? ` · se repite cada ${r.repetirCadaDias} días` : ''}{r.estado === 'avisado' ? ' · ya avisado' : ''}</span>
              </li>
            ))}
          </ul>
        </section>

        {lealtad && configLealtad && (
          <section className="space-y-2">
            <h3 className="font-semibold flex items-center gap-2"><Star size={18} className="text-amber-500" aria-hidden="true" /> Lealtad</h3>
            <p className="text-sm">{lealtad.puntos} puntos ({formatearDinero(lealtad.puntos * configLealtad.valorPunto)}) · {lealtad.costales} costales premium en el ciclo actual</p>
            {lealtad.movimientos.length > 0 && (
              <table className="w-full text-xs">
                <tbody>
                  {lealtad.movimientos.slice(0, 10).map(m => (
                    <tr key={m.id} className="border-t border-slate-100">
                      <td className="py-1">{formatearFecha(m.fecha)}</td>
                      <td className="py-1">{NOMBRES_MOVIMIENTO[m.tipo]}{m.folio ? ` ${m.folio}` : ''}</td>
                      <td className="py-1 text-right tabular-nums">{m.puntos > 0 ? `+${m.puntos}` : m.puntos} pts</td>
                      <td className="py-1 text-right tabular-nums">{m.costales ? `${m.costales > 0 ? '+' : ''}${m.costales} costales` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>
      {programando && <RecordatorioFormulario cliente={cliente} alCerrar={() => setProgramando(false)} alGuardar={cargar} />}
    </div>
  );
}

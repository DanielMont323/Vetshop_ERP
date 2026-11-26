import { useCallback, useEffect, useState } from 'react';
import { Download, Pencil, Plus, Printer, Thermometer } from 'lucide-react';
import toast from 'react-hot-toast';
import { cadenaFrioAPI, mensajeDeError } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { formatearFecha, hoyLocal } from '../utils/formato';
import { imprimirBitacoraFrio } from '../utils/caja';
import LecturaFormulario from '../components/frio/LecturaFormulario';
import EquipoFormulario from '../components/frio/EquipoFormulario';

const grados = t => `${Number(t).toFixed(1)} °C`;

// Cadena de frío: estado de hoy de cada refrigerador, registrar lecturas, historial y bitácora mensual.
export default function CadenaFrio() {
  const { puede, sucursalActiva } = useAuth();
  const gestionar = puede('cadena_frio:gestionar_equipos');
  const [equipos, setEquipos] = useState([]);
  const [lecturas, setLecturas] = useState([]);
  const [soloFuera, setSoloFuera] = useState(false);
  const [leyendo, setLeyendo] = useState(null);
  const [editando, setEditando] = useState(null);
  const [mes, setMes] = useState(hoyLocal().slice(0, 7));
  const [equipoBitacora, setEquipoBitacora] = useState('');

  const cargar = useCallback(async () => {
    try {
      const [e, l] = await Promise.all([
        cadenaFrioAPI.equipos({ incluirInactivos: gestionar || undefined }),
        cadenaFrioAPI.lecturas(soloFuera ? { fueraDeRango: true } : {})
      ]);
      setEquipos(e.data.datos);
      setLecturas(l.data.datos);
      setEquipoBitacora(actual => actual || e.data.datos[0]?.id || '');
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo cargar la cadena de frío'));
    }
  }, [gestionar, soloFuera]);

  useEffect(() => {
    cargar();
  }, [cargar, sucursalActiva]);

  const imprimir = () => imprimirBitacoraFrio({ equipo: equipoBitacora, mes }).catch(e => toast.error(mensajeDeError(e, 'No se pudo imprimir')));
  const excel = async () => {
    try {
      const { data } = await cadenaFrioAPI.bitacoraExcel({ equipo: equipoBitacora, mes });
      const url = URL.createObjectURL(data);
      Object.assign(document.createElement('a'), { href: url, download: `bitacora-temperatura-${mes}.xlsx` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo descargar'));
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold mr-auto flex items-center gap-2"><Thermometer size={20} aria-hidden="true" /> Cadena de frío</h2>
        {gestionar && sucursalActiva && (
          <button type="button" onClick={() => setEditando('nuevo')} className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><Plus size={16} /> Nuevo equipo</button>
        )}
      </div>
      {!sucursalActiva && <p className="text-sm text-amber-800">Elige una sucursal arriba para registrar lecturas.</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {equipos.length === 0 && <p className="text-sm text-slate-500">No hay equipos de frío en esta sucursal{gestionar ? ': agrega el primero con «Nuevo equipo».' : '.'}</p>}
        {equipos.map(e => {
          const u = e.hoy.ultima;
          return (
            <div key={e.id} className={`bg-white rounded-xl shadow p-4 space-y-2 ${e.activo ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{e.nombre}{!e.activo && ' (inactivo)'}</p>
                  <p className="text-xs text-slate-500">{e.tipo === 'congelador' ? 'Congelador' : 'Refrigerador'} · rango {grados(e.minimo)} a {grados(e.maximo)}{!sucursalActiva && ` · ${e.sucursalNombre}`}</p>
                </div>
                {gestionar && <button type="button" onClick={() => setEditando(e)} aria-label={`Editar ${e.nombre}`} className="text-slate-500 p-1"><Pencil size={16} /></button>}
              </div>
              <p className={`text-3xl font-semibold tabular-nums ${u?.fueraDeRango ? 'text-red-700' : ''}`}>{u ? grados(u.temperatura) : '—'}</p>
              <p className="text-sm text-slate-600">
                {u ? `Última: ${formatearFecha(u.fecha, true)} · ${u.usuario.nombre}` : 'Sin lecturas hoy'}
              </p>
              <p className={`text-sm ${e.hoy.pendientes ? 'text-amber-800' : 'text-emerald-700'}`}>
                Hoy: {e.hoy.lecturas} de {e.lecturasPorDia} lecturas{e.hoy.fueraDeRango ? ` · ${e.hoy.fueraDeRango} fuera de rango` : ''}
              </p>
              {e.activo && sucursalActiva && (
                <button type="button" onClick={() => setLeyendo(e)} className="w-full rounded-lg bg-emerald-600 text-white py-2 text-sm hover:bg-emerald-700">Registrar lectura</button>
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-xl shadow p-4 flex flex-wrap items-end gap-3">
        <p className="w-full font-medium">Bitácora mensual (para inspección sanitaria)</p>
        <label className="text-sm">Equipo
          <select className="ml-2 rounded-lg border border-slate-300 px-2 py-1" value={equipoBitacora} onChange={ev => setEquipoBitacora(ev.target.value)}>
            {equipos.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </label>
        <label className="text-sm">Mes
          <input type="month" className="ml-2 rounded-lg border border-slate-300 px-2 py-1" value={mes} max={hoyLocal().slice(0, 7)} onChange={ev => setMes(ev.target.value)} />
        </label>
        <button type="button" onClick={imprimir} disabled={!equipoBitacora} className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"><Printer size={16} /> Imprimir</button>
        <button type="button" onClick={excel} disabled={!equipoBitacora} className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"><Download size={16} /> Excel</button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h3 className="font-medium mr-auto">Lecturas de los últimos 7 días</h3>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={soloFuera} onChange={e => setSoloFuera(e.target.checked)} /> Solo fuera de rango</label>
        </div>
        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left"><tr>
              <th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Equipo</th><th className="px-3 py-2 text-right">Temperatura</th>
              <th className="px-3 py-2">Registró</th><th className="px-3 py-2">Observación / acción correctiva</th>
            </tr></thead>
            <tbody>
              {lecturas.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-slate-500">Sin lecturas.</td></tr>}
              {lecturas.map(l => (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{formatearFecha(l.fecha, true)}</td>
                  <td className="px-3 py-2">{l.equipo.nombre}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${l.fueraDeRango ? 'text-red-700 font-semibold' : ''}`}>{grados(l.temperatura)}{l.fueraDeRango && ' · fuera'}</td>
                  <td className="px-3 py-2">{l.usuario.nombre}</td>
                  <td className="px-3 py-2">
                    {l.observacion}
                    {l.accionCorrectiva && <span className="block text-xs">Acción: {l.accionCorrectiva}</span>}
                    {l.productosAfectados && <span className="block text-xs">Productos: {l.productosAfectados}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {leyendo && <LecturaFormulario equipo={leyendo} alCerrar={() => setLeyendo(null)} alGuardar={() => { setLeyendo(null); cargar(); }} />}
      {editando && <EquipoFormulario equipo={editando === 'nuevo' ? null : editando} alCerrar={() => setEditando(null)} alGuardar={() => { setEditando(null); cargar(); }} />}
    </section>
  );
}

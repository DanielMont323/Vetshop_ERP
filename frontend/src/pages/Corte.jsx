import { useCallback, useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { mensajeDeError, turnosAPI } from '../services/api';
import { formatearDinero, formatearFecha } from '../utils/formato';
import { imprimirCorte } from '../utils/caja';
import ConteoDenominaciones, { aDenominaciones, conteoVacio } from '../components/turnos/ConteoDenominaciones';
import TurnoAbierto from '../components/turnos/TurnoAbierto';
import ResultadoCorte from '../components/turnos/ResultadoCorte';

const ESTADOS = { abierto: 'Abierto', contado: 'Con diferencia (falta autorizar)', cerrado: 'Cerrado' };

// Mi turno: abrir, retiros, corte ciego y cierre. Abajo, el historial (el dueño ve todos los turnos).
export default function Corte() {
  const { puede, sucursalActiva } = useAuth();
  const verTodos = puede('turnos:ver_todos');
  const [turno, setTurno] = useState(undefined); // undefined = cargando, null = sin turno
  const [resultado, setResultado] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [caja, setCaja] = useState('1');
  const [fondo, setFondo] = useState(conteoVacio);
  const [abriendo, setAbriendo] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [a, h] = await Promise.all([turnosAPI.actual(), turnosAPI.listar({ limite: 30 })]);
      setTurno(a.data.datos);
      setHistorial(h.data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo cargar el turno'));
    }
  }, []);

  useEffect(() => {
    setResultado(null);
    cargar();
  }, [cargar, sucursalActiva]);

  const abrir = async e => {
    e.preventDefault();
    const { lista, error } = aDenominaciones(fondo);
    if (error) return toast.error(error);
    setAbriendo(true);
    try {
      await turnosAPI.abrir({ caja: Number(caja), ...(lista.length ? { denominaciones: lista } : { fondo: 0 }) });
      toast.success('Turno abierto: ya puedes cobrar');
      setFondo(conteoVacio());
      setResultado(null);
      cargar();
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo abrir el turno'));
    } finally {
      setAbriendo(false);
    }
  };

  const alContar = t => {
    setResultado(t);
    cargar();
    toast[t.estado === 'cerrado' ? 'success' : 'error'](t.estado === 'cerrado' ? 'Corte cuadrado: turno cerrado' : 'El corte tiene diferencias');
  };

  // Lo que se muestra arriba: el resultado recién contado, o el turno en corte
  const mostrar = resultado || (turno?.estado === 'contado' ? turno : null);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Turno y corte de caja</h2>

      {turno === undefined && <p className="text-slate-500">Cargando…</p>}

      {mostrar && <ResultadoCorte turno={mostrar} alCerrar={t => { setResultado(t); cargar(); }} />}

      {turno === null && (
        <form onSubmit={abrir} className="bg-white rounded-xl shadow p-4 space-y-3">
          <h3 className="font-semibold">Abrir turno</h3>
          <label className="flex items-center gap-2 text-sm">Caja
            <select className="rounded border border-slate-300 px-2 py-1" value={caja} onChange={e => setCaja(e.target.value)}>
              {[1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <p className="text-sm text-slate-600">Cuenta el fondo inicial (el cambio con el que empiezas):</p>
          <ConteoDenominaciones conteo={fondo} alCambiar={setFondo} deshabilitado={abriendo} />
          <button type="submit" disabled={abriendo} className="w-full rounded-lg bg-emerald-600 text-white font-semibold py-2 hover:bg-emerald-700 disabled:opacity-60">Abrir turno</button>
        </form>
      )}

      {turno?.estado === 'abierto' && <TurnoAbierto turno={turno} alCambiar={cargar} alContar={alContar} />}

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <h3 className="font-semibold px-4 pt-3">{verTodos ? 'Turnos de la sucursal' : 'Mis turnos'}</h3>
        <table className="w-full text-sm mt-2">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="px-3 py-2">Apertura</th><th className="px-3 py-2">Cajero</th><th className="px-3 py-2">Caja</th><th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2 text-right">Dif. efectivo</th><th className="px-3 py-2 text-right">Dif. tarjeta</th>
              {verTodos && <th className="px-3 py-2 text-right">Efectivo esperado ahora</th>}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {historial.map(t => (
              <tr key={t.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{formatearFecha(t.apertura.fecha, true)}</td>
                <td className="px-3 py-2">{t.cajero.nombre}</td>
                <td className="px-3 py-2">{t.caja}</td>
                <td className="px-3 py-2">{ESTADOS[t.estado]}</td>
                {['efectivo', 'tarjeta'].map(m => (
                  <td key={m} className={`px-3 py-2 text-right tabular-nums ${t.conteo?.diferencias[m] ? 'text-red-700 font-medium' : ''}`}>
                    {t.conteo ? formatearDinero(t.conteo.diferencias[m]) : '—'}
                  </td>
                ))}
                {verTodos && <td className="px-3 py-2 text-right tabular-nums">{t.esperado ? formatearDinero(t.esperado.efectivo) : '—'}</td>}
                <td className="px-3 py-2">
                  {t.conteo && (
                    <button type="button" onClick={() => imprimirCorte(t.id).catch(e => toast.error(mensajeDeError(e, 'No se pudo imprimir')))} aria-label="Imprimir corte" className="text-slate-500 hover:text-slate-800"><Printer size={16} /></button>
                  )}
                </td>
              </tr>
            ))}
            {historial.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">Sin turnos.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

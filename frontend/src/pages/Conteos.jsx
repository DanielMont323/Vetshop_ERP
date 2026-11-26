import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { conteosAPI, mensajeDeError } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { NOMBRES_CATEGORIA, formatearDinero, formatearFecha } from '../utils/formato';
import ConteoDetalle from '../components/conteos/ConteoDetalle';

export const ESTADOS_CONTEO = { en_captura: 'En captura', en_revision: 'En revisión', aplicado: 'Aplicado', cancelado: 'Cancelado' };
const COLOR_ESTADO = { en_captura: 'bg-sky-100 text-sky-800', en_revision: 'bg-amber-100 text-amber-800', aplicado: 'bg-emerald-100 text-emerald-800', cancelado: 'bg-slate-100 text-slate-600' };

// Conteo físico: historial de la sucursal, iniciar un conteo y abrirlo para capturar, revisar o aplicar.
export default function Conteos() {
  const { sucursalActiva } = useAuth();
  const [lista, setLista] = useState([]);
  const [abierto, setAbierto] = useState(null);
  const [iniciando, setIniciando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setLista((await conteosAPI.listar()).data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudieron cargar los conteos'));
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar, sucursalActiva]);

  const enCurso = lista.find(c => ['en_captura', 'en_revision'].includes(c.estado) && String(c.sucursal.id) === String(sucursalActiva));

  if (abierto) return <ConteoDetalle id={abierto} alCerrar={() => { setAbierto(null); cargar(); }} />;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold mr-auto flex items-center gap-2"><ClipboardList size={20} aria-hidden="true" /> Conteo físico</h2>
        {enCurso ? (
          <button type="button" onClick={() => setAbierto(enCurso.id)} className="rounded-lg bg-emerald-600 text-white px-3 py-2 hover:bg-emerald-700">Continuar {enCurso.folio}</button>
        ) : (
          <button type="button" onClick={() => setIniciando(true)} disabled={!sucursalActiva} className="flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-3 py-2 hover:bg-emerald-700 disabled:opacity-50"><Plus size={18} /> Iniciar conteo</button>
        )}
      </div>
      {!sucursalActiva && <p className="text-sm text-amber-800">Elige una sucursal arriba para iniciar un conteo.</p>}
      <p className="text-sm text-slate-600">
        Se cuenta lote por lote sin ver cuánto marca el sistema. Mientras el conteo esté abierto no se pueden hacer ajustes de inventario en la sucursal;
        las ventas sí siguen.
      </p>

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr>
            <th className="px-3 py-2">Folio</th><th className="px-3 py-2">Sucursal</th><th className="px-3 py-2">Inicio</th><th className="px-3 py-2">Alcance</th>
            <th className="px-3 py-2">Avance</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2 text-right">Faltante</th><th className="px-3 py-2 text-right">Sobrante</th>
          </tr></thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={8} className="px-3 py-4 text-slate-500">Todavía no hay conteos.</td></tr>}
            {lista.map(c => (
              <tr key={c.id} onClick={() => setAbierto(c.id)} className="border-t border-slate-100 cursor-pointer hover:bg-emerald-50">
                <td className="px-3 py-2 font-mono">{c.folio}</td>
                <td className="px-3 py-2">{c.sucursal.nombre}</td>
                <td className="px-3 py-2">{formatearFecha(c.inicio.fecha, true)} · {c.inicio.usuarioNombre}</td>
                <td className="px-3 py-2">{c.categorias.length ? c.categorias.map(k => NOMBRES_CATEGORIA[k]).join(', ') : 'Todo'}</td>
                <td className="px-3 py-2 tabular-nums">{c.resumen.contados} / {c.resumen.renglones}</td>
                <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs ${COLOR_ESTADO[c.estado]}`}>{ESTADOS_CONTEO[c.estado]}</span></td>
                <td className="px-3 py-2 text-right tabular-nums">{c.aplicacion ? formatearDinero(c.aplicacion.faltante) : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.aplicacion ? formatearDinero(c.aplicacion.sobrante) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {iniciando && <IniciarConteo alCerrar={() => setIniciando(false)} alIniciar={c => { setIniciando(false); setAbierto(c.id); }} />}
    </section>
  );
}

function IniciarConteo({ alCerrar, alIniciar }) {
  const [categorias, setCategorias] = useState([]);
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const alternar = k => setCategorias(cs => (cs.includes(k) ? cs.filter(x => x !== k) : [...cs, k]));

  const iniciar = async e => {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await conteosAPI.iniciar({ categorias, nota: nota.trim() || undefined });
      toast.success(`Conteo ${r.data.datos.folio} iniciado: ${r.data.datos.resumen.renglones} lotes por contar`);
      alIniciar(r.data.datos);
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo iniciar el conteo'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true">
      <form onSubmit={iniciar} className="bg-white rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-semibold">Iniciar conteo físico</h2>
        <fieldset disabled={enviando} className="space-y-3">
          <legend className="text-sm font-medium">¿Qué se cuenta? (sin marcar = todo el inventario)</legend>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(NOMBRES_CATEGORIA).map(([k, n]) => (
              <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={categorias.includes(k)} onChange={() => alternar(k)} /> {n}</label>
            ))}
          </div>
          <label className="block text-sm"><span className="font-medium">Nota (opcional)</span>
            <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={nota} onChange={e => setNota(e.target.value)} maxLength={300} placeholder="Conteo semanal" /></label>
        </fieldset>
        <p className="text-xs text-slate-500">Se toma la foto de existencias en este momento. Evita recibir mercancía en la sucursal hasta aplicar el conteo.</p>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Cancelar</button>
          <button type="submit" disabled={enviando} className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">{enviando ? 'Iniciando…' : 'Iniciar'}</button>
        </div>
      </form>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ScanLine } from 'lucide-react';
import toast from 'react-hot-toast';
import { conteosAPI, mensajeDeError } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useDialogo } from '../../contexts/DialogoContext';
import { formatearDinero, formatearFecha } from '../../utils/formato';
import { normalizarTexto } from './texto';
import RenglonConteo from './RenglonConteo';
import AplicarConteo from './AplicarConteo';

const ESTADOS = { en_captura: 'En captura', en_revision: 'En revisión', aplicado: 'Aplicado', cancelado: 'Cancelado' };

// Un conteo: captura ciega por lote (con lector de código de barras), revisión de diferencias y aplicación.
export default function ConteoDetalle({ id, alCerrar }) {
  const { puede } = useAuth();
  const { confirmar, pedirTexto } = useDialogo();
  const [conteo, setConteo] = useState(null);
  const [buscar, setBuscar] = useState('');
  const [filtro, setFiltro] = useState('todos');
  const [aplicando, setAplicando] = useState(false);
  const buscador = useRef(null);

  const cargar = useCallback(async () => {
    try {
      setConteo((await conteosAPI.obtener(id)).data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo cargar el conteo'));
    }
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const visibles = useMemo(() => {
    if (!conteo) return [];
    const q = normalizarTexto(buscar);
    return conteo.renglones.filter(r => {
      if (q && !normalizarTexto(`${r.nombre} ${r.sku} ${r.codigoBarras || ''} ${r.lote}`).includes(q)) return false;
      if (filtro === 'pendientes') return r.contado === null;
      if (filtro === 'diferencias') return r.diferencia;
      return true;
    });
  }, [conteo, buscar, filtro]);

  if (!conteo) return <p className="text-slate-500">Cargando conteo…</p>;
  const abierto = ['en_captura', 'en_revision'].includes(conteo.estado);
  const verDiferencias = 'esperado' in (conteo.renglones[0] || {});
  const r = conteo.resumen;

  const actualizarRenglon = (renglonId, cambios) =>
    setConteo(c => {
      const renglones = c.renglones.map(x => (x.id === renglonId ? { ...x, ...cambios } : x));
      const contados = renglones.filter(x => x.contado !== null).length;
      return { ...c, renglones, resumen: { ...c.resumen, contados, pendientes: renglones.length - contados } };
    });

  const accion = async (llamada, mensaje) => {
    try {
      setConteo((await llamada()).data.datos);
      toast.success(mensaje);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo completar'), { duration: 6000 });
    }
  };

  const aRevision = async () => {
    const aviso = r.pendientes ? ` Quedan ${r.pendientes} lote(s) sin contar.` : '';
    if (await confirmar(`¿Terminaste de contar?${aviso} El dueño revisará las diferencias.`, { textoAceptar: 'Pasar a revisión' })) {
      accion(() => conteosAPI.revision(id), 'Conteo en revisión');
    }
  };
  const cancelar = async () => {
    const motivo = await pedirTexto('¿Por qué se cancela el conteo? No se ajustará nada.', { minimo: 3, textoAceptar: 'Cancelar conteo', textoCancelar: 'Volver', peligro: true });
    if (motivo) accion(() => conteosAPI.cancelar(id, { motivo }), 'Conteo cancelado');
  };

  // Lector: Enter con un código que coincide con un solo producto deja ese filtro y enfoca su primer renglón
  const alEnter = e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const primero = document.querySelector('[data-captura]');
    primero?.focus();
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={alCerrar} className="flex items-center gap-1 text-sm text-slate-600"><ArrowLeft size={16} /> Conteos</button>
        <h2 className="text-lg font-semibold mr-auto">Conteo {conteo.folio} · {ESTADOS[conteo.estado]}</h2>
        {conteo.estado === 'en_captura' && <button type="button" onClick={aRevision} className="rounded-lg bg-emerald-600 text-white px-3 py-2 text-sm hover:bg-emerald-700">Terminar captura</button>}
        {conteo.estado === 'en_revision' && (
          <>
            <button type="button" onClick={() => accion(() => conteosAPI.recaptura(id), 'De vuelta en captura')} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Volver a captura</button>
            {puede('conteo_fisico:aplicar') && <button type="button" onClick={() => setAplicando(true)} className="rounded-lg bg-emerald-600 text-white px-3 py-2 text-sm hover:bg-emerald-700">Aplicar ajustes</button>}
          </>
        )}
        {abierto && <button type="button" onClick={cancelar} className="rounded-lg border border-red-300 text-red-700 px-3 py-2 text-sm">Cancelar conteo</button>}
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl shadow p-3"><dt className="text-xs text-slate-500">Lotes contados</dt><dd className="text-xl font-semibold tabular-nums">{r.contados} / {r.renglones}</dd></div>
        <div className="bg-white rounded-xl shadow p-3"><dt className="text-xs text-slate-500">Inicio</dt><dd className="text-sm font-medium">{formatearFecha(conteo.inicio.fecha, true)} · {conteo.inicio.usuarioNombre}</dd></div>
        {verDiferencias && (
          <>
            <div className={`rounded-xl shadow p-3 ${r.faltante ? 'bg-red-50' : 'bg-white'}`}><dt className="text-xs text-slate-500">Faltante (a costo)</dt><dd className="text-xl font-semibold tabular-nums">{formatearDinero(r.faltante)}</dd></div>
            <div className="bg-white rounded-xl shadow p-3"><dt className="text-xs text-slate-500">Sobrante (a costo)</dt><dd className="text-xl font-semibold tabular-nums">{formatearDinero(r.sobrante)}</dd></div>
          </>
        )}
      </dl>
      {conteo.estado === 'aplicado' && (
        <p className="text-sm text-emerald-800">Aplicado el {formatearFecha(conteo.aplicacion.fecha, true)}, autorizó {conteo.aplicacion.autorizadoPorNombre}: {conteo.aplicacion.movimientos.length} ajuste(s).</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative flex-1 min-w-64">
          <ScanLine size={16} className="absolute left-3 top-3 text-slate-400" aria-hidden="true" />
          <span className="sr-only">Escanea o busca</span>
          <input ref={buscador} className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2" placeholder="Escanea o busca producto o lote" value={buscar} onChange={e => setBuscar(e.target.value)} onKeyDown={alEnter} autoFocus={abierto} />
        </label>
        <select aria-label="Mostrar" className="rounded-lg border border-slate-300 px-2 py-2" value={filtro} onChange={e => setFiltro(e.target.value)}>
          <option value="todos">Todos</option>
          <option value="pendientes">Sin contar</option>
          {verDiferencias && <option value="diferencias">Con diferencia</option>}
        </select>
      </div>

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr>
            <th className="px-3 py-2">Producto</th><th className="px-3 py-2">Lote</th><th className="px-3 py-2">Caducidad</th>
            {verDiferencias && <th className="px-3 py-2 text-right">Sistema</th>}
            <th className="px-3 py-2 text-right">Contado</th>
            {verDiferencias && <><th className="px-3 py-2 text-right">Diferencia</th><th className="px-3 py-2 text-right">Valor</th></>}
            {abierto && <th className="px-3 py-2">Capturar</th>}
          </tr></thead>
          <tbody>
            {visibles.length === 0 && <tr><td colSpan={8} className="px-3 py-4 text-slate-500">Ningún lote coincide.</td></tr>}
            {visibles.map(x => (
              <RenglonConteo key={x.id} conteoId={id} renglon={x} editable={abierto} verDiferencias={verDiferencias} alCapturar={actualizarRenglon} alTerminar={() => { setBuscar(''); buscador.current?.focus(); }} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">{conteo.renglones.length} lotes · las piezas se capturan en piezas y los productos a granel en kg (hasta 3 decimales).</p>

      {aplicando && <AplicarConteo conteo={conteo} alCerrar={() => setAplicando(false)} alAplicar={c => { setAplicando(false); setConteo(c); }} />}
    </section>
  );
}

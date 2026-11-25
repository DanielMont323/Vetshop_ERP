import { useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { mensajeDeError, traspasosAPI } from '../../services/api';
import { NOMBRES_ESTADO_TRASPASO, baseATexto, cantidadABase, formatearCantidad, formatearFecha } from '../../utils/formato';

// Detalle del traspaso. Destino en tránsito: capturar lo recibido por lote. Origen en tránsito: cancelar.
// Con diferencia: autorizar con PIN del dueño.
export default function TraspasoDetalle({ traspaso: inicial, alCerrar, alCambiar }) {
  const { sucursalActiva } = useAuth();
  const [t, setT] = useState(inicial);
  const [recibidos, setRecibidos] = useState(() => inicial.partidas.map(p => p.lotes.map(l => baseATexto(l.enviado, p.unidad))));
  const [obs, setObs] = useState('');
  const [nota, setNota] = useState('');
  const [usuario, setUsuario] = useState('');
  const [pin, setPin] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const estado = NOMBRES_ESTADO_TRASPASO[t.estado];
  const soyDestino = String(t.destino.id) === sucursalActiva;
  const soyOrigen = String(t.origen.id) === sucursalActiva;

  const ejecutar = async (accion, exito) => {
    setOcupado(true);
    try {
      const r = await accion();
      setT(r.data.datos);
      toast.success(exito(r.data.datos));
      alCambiar();
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo completar'));
      setPin('');
    } finally {
      setOcupado(false);
    }
  };

  const recibir = e => {
    e.preventDefault();
    const datos = [];
    for (const [i, p] of t.partidas.entries()) {
      const fila = [];
      for (const texto of recibidos[i]) {
        const c = String(texto).trim() === '' ? 0 : cantidadABase(texto, p.unidad);
        if (Number.isNaN(c)) return toast.error(`${p.nombre}: cantidad inválida`);
        fila.push(c);
      }
      datos.push(fila);
    }
    ejecutar(() => traspasosAPI.recibir(t.id, { recibidos: datos, observaciones: obs.trim() || undefined }),
      r => (r.estado === 'recibido' ? 'Recibido completo: ya está en el inventario' : 'Recibido con diferencia: falta que el dueño la autorice'));
  };

  const cancelar = () => {
    const motivo = window.prompt('¿Por qué se cancela el traspaso?');
    if (motivo) ejecutar(() => traspasosAPI.cancelar(t.id, motivo), () => 'Traspaso cancelado: la mercancía regresó a esta sucursal');
  };

  const autorizar = e => {
    e.preventDefault();
    ejecutar(() => traspasosAPI.autorizarDiferencia(t.id, { nota: nota.trim(), autorizacion: { usuario: usuario.trim(), pin } }), () => 'Diferencia autorizada');
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-3xl max-h-[92vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-3">
            Traspaso T-{t.folio}: {t.origen.nombre} → {t.destino.nombre}
            <span className={`rounded px-2 py-0.5 text-xs ${estado.clase}`}>{estado.texto}</span>
          </h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500"><X /></button>
        </div>
        <p className="text-sm text-slate-600">
          Envió {t.envio.usuarioNombre} el {formatearFecha(t.envio.fecha, true)}
          {t.recepcion && ` · Recibió ${t.recepcion.usuarioNombre} el ${formatearFecha(t.recepcion.fecha, true)}`}
          {t.observaciones && ` · ${t.observaciones}`}
        </p>

        <form onSubmit={recibir}>
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left">
              <tr><th className="px-2 py-2">Producto</th><th className="px-2 py-2">Lote</th><th className="px-2 py-2">Caducidad</th><th className="px-2 py-2 text-right">Enviado</th><th className="px-2 py-2 text-right">Recibido</th></tr>
            </thead>
            <tbody>
              {t.partidas.flatMap((p, i) => p.lotes.map((l, j) => (
                <tr key={`${i}-${j}`} className="border-t border-slate-100">
                  <td className="px-2 py-1.5">{j === 0 ? p.nombre : ''}</td>
                  <td className="px-2 py-1.5 font-mono">{l.lote || '—'}</td>
                  <td className="px-2 py-1.5">{formatearFecha(l.caducidad)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatearCantidad(l.enviado, p.unidad)}</td>
                  <td className="px-2 py-1.5 text-right">
                    {t.estado === 'en_transito' && soyDestino ? (
                      <input className="w-24 rounded border border-slate-300 px-2 py-1 text-right" inputMode="decimal" aria-label={`Recibido de ${p.nombre} lote ${l.lote || 'sin lote'}`}
                        value={recibidos[i][j]} onChange={e => setRecibidos(rs => rs.map((f, a) => (a === i ? f.map((x, b) => (b === j ? e.target.value : x)) : f)))} />
                    ) : (
                      <span className={`tabular-nums ${l.recibido !== undefined && l.recibido < l.enviado ? 'text-red-700 font-medium' : ''}`}>{l.recibido === undefined ? '—' : formatearCantidad(l.recibido, p.unidad)}</span>
                    )}
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
          {t.estado === 'en_transito' && soyDestino && (
            <div className="mt-3 flex gap-2">
              <input className="flex-1 rounded border border-slate-300 px-2 py-1.5" placeholder="Observaciones de la recepción" value={obs} onChange={e => setObs(e.target.value)} maxLength={500} />
              <button type="submit" disabled={ocupado} className="rounded-lg bg-emerald-600 text-white px-4 py-1.5 hover:bg-emerald-700 disabled:opacity-60">Confirmar recepción</button>
            </div>
          )}
        </form>

        {t.estado === 'en_transito' && !soyDestino && <p className="text-sm text-slate-500">Lo recibe {t.destino.nombre} desde su sucursal.</p>}

        {t.estado === 'con_diferencia' && (
          <form onSubmit={autorizar} className="rounded-lg bg-amber-50 p-3 space-y-2">
            <p className="text-sm text-amber-900">Faltó mercancía: {t.faltantes.map(f => `${f.nombre} ${f.lote ? `(${f.lote})` : ''}: ${formatearCantidad(f.faltante, f.unidad)}`).join('; ')}</p>
            <input className="w-full rounded border border-slate-300 px-2 py-1" placeholder="¿Qué pasó?" aria-label="Nota de la diferencia" value={nota} onChange={e => setNota(e.target.value)} required minLength={3} />
            <div className="grid sm:grid-cols-[1fr_8rem_auto] gap-2">
              <input className="rounded border border-slate-300 px-2 py-1" placeholder="Usuario del dueño" aria-label="Usuario del dueño" value={usuario} onChange={e => setUsuario(e.target.value)} required autoComplete="off" />
              <input className="rounded border border-slate-300 px-2 py-1" type="password" inputMode="numeric" placeholder="PIN" aria-label="PIN del dueño" value={pin} onChange={e => setPin(e.target.value)} required autoComplete="off" />
              <button type="submit" disabled={ocupado} className="rounded-lg bg-amber-600 text-white px-4 py-1 hover:bg-amber-700 disabled:opacity-60">Autorizar diferencia</button>
            </div>
          </form>
        )}
        {t.diferencia && <p className="text-sm">Diferencia autorizada por {t.diferencia.autorizadoPorNombre}: {t.diferencia.nota}</p>}

        <div className="flex justify-end gap-3">
          {t.estado === 'en_transito' && soyOrigen && (
            <button type="button" onClick={cancelar} disabled={ocupado} className="mr-auto rounded-lg border border-red-300 text-red-700 px-4 py-2 hover:bg-red-50">Cancelar traspaso</button>
          )}
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Cerrar</button>
        </div>
      </div>
    </div>
  );
}

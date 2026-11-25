import { useCallback, useEffect, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { existenciasAPI, inventarioAPI, mensajeDeError } from '../services/api';
import { NOMBRES_ALERTA, NOMBRES_MOTIVO, NOMBRES_MOVIMIENTO, formatearCantidad, formatearDinero, formatearFecha } from '../utils/formato';
import AjusteFormulario from './AjusteFormulario';

// Detalle de un producto: lotes en orden de salida (FEFO), últimos movimientos y ajuste.
export default function LotesProducto({ producto, alCerrar, alCambiar }) {
  const { puede, sucursalActiva } = useAuth();
  const [lotes, setLotes] = useState([]);
  const [movimientos, setMovimientos] = useState([]);
  const [ajustando, setAjustando] = useState(false);

  const tiposPermitidos = [puede('inventario:entradas') && 'entrada', puede('inventario:salidas') && 'salida'].filter(Boolean);

  const cargar = useCallback(async () => {
    try {
      const [l, m] = await Promise.all([
        existenciasAPI.lotes(producto.id),
        inventarioAPI.movimientos({ producto: producto.id, limite: 20 })
      ]);
      setLotes(l.data.datos);
      setMovimientos(m.data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudieron cargar los lotes'));
    }
  }, [producto.id]);

  useEffect(() => {
    cargar();
  }, [cargar, sucursalActiva]);

  const verCostos = lotes.some(l => l.costoUnitario !== undefined);
  const varias = new Set(lotes.map(l => l.sucursal.id)).size > 1;

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-10" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">
            {producto.nombre} <span className="text-sm font-mono text-slate-500">{producto.sku}</span>
          </h2>
          <div className="flex items-center gap-2">
            {tiposPermitidos.length > 0 && !ajustando && (
              <button type="button" onClick={() => setAjustando(true)} className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
                <SlidersHorizontal size={16} aria-hidden="true" /> Ajustar
              </button>
            )}
            <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500 hover:text-slate-800"><X /></button>
          </div>
        </div>

        <section>
          <h3 className="text-sm font-semibold mb-2">Lotes en orden de salida (primero el que caduca antes)</h3>
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left">
              <tr>
                {varias && <th className="px-3 py-2">Sucursal</th>}
                <th className="px-3 py-2">Lote</th>
                <th className="px-3 py-2">Caducidad</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                {verCostos && <th className="px-3 py-2 text-right">Costo unitario</th>}
              </tr>
            </thead>
            <tbody>
              {lotes.map(l => (
                <tr key={l.id} className="border-t border-slate-100">
                  {varias && <td className="px-3 py-2">{l.sucursal.nombre}</td>}
                  <td className="px-3 py-2 font-mono">{l.lote || '—'}</td>
                  <td className="px-3 py-2">
                    {formatearFecha(l.caducidad)}
                    {l.diasParaCaducar !== null && l.diasParaCaducar >= 0 && <span className="text-xs text-slate-500"> ({l.diasParaCaducar} días)</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${NOMBRES_ALERTA[l.estado].clase}`}>{NOMBRES_ALERTA[l.estado].texto}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatearCantidad(l.cantidad, producto.unidad)}</td>
                  {verCostos && <td className="px-3 py-2 text-right tabular-nums">{formatearDinero(l.costoUnitario)}{producto.unidad === 'kg' && '/kg'}</td>}
                </tr>
              ))}
              {lotes.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-500">Sin existencia.</td></tr>
              )}
            </tbody>
          </table>
        </section>

        {ajustando && (
          <AjusteFormulario
            producto={producto}
            lotes={lotes.filter(l => !varias || l.sucursal.id === sucursalActiva)}
            tiposPermitidos={tiposPermitidos}
            alCancelar={() => setAjustando(false)}
            alTerminar={() => {
              setAjustando(false);
              cargar();
              alCambiar();
            }}
          />
        )}

        <section>
          <h3 className="text-sm font-semibold mb-2">Últimos movimientos</h3>
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                <th className="px-3 py-2">Lotes</th>
                <th className="px-3 py-2">Quién</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.map(m => (
                <tr key={m.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{formatearFecha(m.fecha, true)}</td>
                  <td className="px-3 py-2">
                    {NOMBRES_MOVIMIENTO[m.tipo]}
                    {m.motivo && <span className="text-slate-500"> · {NOMBRES_MOTIVO[m.motivo]}</span>}
                    {m.nota && <span className="block text-xs text-slate-500">{m.nota}</span>}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${m.cantidad < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                    {m.cantidad > 0 ? '+' : ''}{formatearCantidad(m.cantidad, producto.unidad)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{m.lotes.map(l => l.lote || '—').join(', ')}</td>
                  <td className="px-3 py-2 text-xs">
                    {m.usuario}
                    {m.autorizadoPor && <span className="block text-slate-500">autorizó {m.autorizadoPor}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

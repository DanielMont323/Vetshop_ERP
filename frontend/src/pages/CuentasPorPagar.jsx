import { useCallback, useEffect, useState } from 'react';
import { Download, Plus, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { cuentasPagarAPI, mensajeDeError } from '../services/api';
import { formatearDinero, formatearFecha, hoyLocal } from '../utils/formato';
import PagoProveedorFormulario from '../components/cuentasPagar/PagoProveedorFormulario';
import PagosProveedores from '../components/cuentasPagar/PagosProveedores';

const ESTADOS = [['pendiente', 'Pendientes'], ['pagada', 'Pagadas'], ['todas', 'Todas']];

function Vence({ cuenta }) {
  if (cuenta.estado !== 'pendiente') return <span>{formatearFecha(cuenta.vencimiento)}</span>;
  const d = cuenta.diasParaVencer;
  const texto = d < 0 ? `vencida hace ${-d} día${d === -1 ? '' : 's'}` : d === 0 ? 'vence hoy' : `en ${d} día${d === 1 ? '' : 's'}`;
  return (
    <span className={d < 0 ? 'text-red-700 font-medium' : d <= 7 ? 'text-amber-700 font-medium' : ''}>
      {formatearFecha(cuenta.vencimiento)} · {texto}
    </span>
  );
}

// Cuentas por pagar a proveedores (solo dueño): facturas pendientes, resumen, pagos e historial.
export default function CuentasPorPagar() {
  const [vista, setVista] = useState('facturas');
  const [estado, setEstado] = useState('pendiente');
  const [q, setQ] = useState('');
  const [datos, setDatos] = useState(null);
  const [seleccion, setSeleccion] = useState([]);
  const [pagando, setPagando] = useState(null);

  const cargar = useCallback(async () => {
    try {
      setDatos((await cuentasPagarAPI.listar({ estado, q: q.trim() || undefined })).data);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudieron cargar las cuentas por pagar'));
    }
  }, [estado, q]);

  useEffect(() => {
    const t = setTimeout(cargar, 250);
    return () => clearTimeout(t);
  }, [cargar]);

  const descargar = async () => {
    try {
      const { data } = await cuentasPagarAPI.excel();
      const url = URL.createObjectURL(data);
      Object.assign(document.createElement('a'), { href: url, download: `cuentas-por-pagar-${hoyLocal()}.xlsx` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo descargar el Excel'));
    }
  };

  const elegidas = datos?.datos.filter(c => seleccion.includes(c.id)) || [];
  const proveedorElegido = elegidas[0]?.proveedor.id;
  const alternar = c => {
    if (seleccion.includes(c.id)) setSeleccion(seleccion.filter(id => id !== c.id));
    else if (proveedorElegido && proveedorElegido !== c.proveedor.id) toast.error('Elige facturas de un solo proveedor por pago');
    else setSeleccion([...seleccion, c.id]);
  };
  const r = datos?.resumen;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold mr-auto">Cuentas por pagar</h2>
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm" role="tablist">
          {[['facturas', 'Facturas'], ['pagos', 'Pagos realizados']].map(([v, t]) => (
            <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => setVista(v)} className={`px-3 py-2 ${vista === v ? 'bg-emerald-600 text-white' : 'bg-white'}`}>{t}</button>
          ))}
        </div>
        <button type="button" onClick={descargar} className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><Download size={16} /> Excel</button>
      </div>

      {r && (
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[['Por pagar', r.pendiente], ['Vencido', r.vencido, r.vencido > 0 && 'red'], ['Vence en 7 días', r.venceSemana, r.venceSemana > 0 && 'amber'], ['Facturas pendientes', r.facturas, null, true]].map(([t, v, color, numero]) => (
            <div key={t} className={`rounded-xl shadow p-4 ${color === 'red' ? 'bg-red-50' : color === 'amber' ? 'bg-amber-50' : 'bg-white'}`}>
              <dt className="text-sm text-slate-500">{t}</dt>
              <dd className={`text-2xl font-semibold tabular-nums ${color === 'red' ? 'text-red-700' : color === 'amber' ? 'text-amber-800' : ''}`}>{numero ? v : formatearDinero(v)}</dd>
            </div>
          ))}
        </dl>
      )}

      {vista === 'pagos' ? <PagosProveedores alCambiar={cargar} /> : (
        <>
          {datos?.proveedores.length > 0 && (
            <div className="bg-white rounded-xl shadow overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-left"><tr>
                  <th className="px-3 py-2">Proveedor</th><th className="px-3 py-2 text-right">Saldo</th><th className="px-3 py-2 text-right">Al corriente</th>
                  <th className="px-3 py-2 text-right">Vencido</th><th className="px-3 py-2">Próximo vencimiento</th><th />
                </tr></thead>
                <tbody>
                  {datos.proveedores.map(p => (
                    <tr key={p.proveedor.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{p.proveedor.nombre} <span className="text-xs text-slate-500">· {p.facturas} factura{p.facturas === 1 ? '' : 's'}</span></td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{formatearDinero(p.saldo)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatearDinero(p.corriente)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${p.vencido ? 'text-red-700 font-medium' : ''}`}>{p.vencido ? formatearDinero(p.vencido) : '—'}</td>
                      <td className="px-3 py-2">{formatearFecha(p.proximoVencimiento)}</td>
                      <td className="px-3 py-2 text-right">
                        <button type="button" onClick={() => setPagando({ proveedor: p.proveedor, cuentas: datos.datos.filter(c => c.proveedor.id === p.proveedor.id && c.estado === 'pendiente') })} className="text-emerald-700 underline text-sm">Pagar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <label className="relative min-w-64 flex-1">
              <Search size={16} className="absolute left-3 top-3 text-slate-400" aria-hidden="true" />
              <span className="sr-only">Buscar</span>
              <input className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2" placeholder="Proveedor o folio de factura" value={q} onChange={e => setQ(e.target.value)} />
            </label>
            <select aria-label="Estado" className="rounded-lg border border-slate-300 px-2 py-2" value={estado} onChange={e => { setEstado(e.target.value); setSeleccion([]); }}>
              {ESTADOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
            {elegidas.length > 0 && (
              <button type="button" onClick={() => setPagando({ proveedor: elegidas[0].proveedor, cuentas: elegidas })} className="flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-3 py-2 text-sm hover:bg-emerald-700">
                <Plus size={16} /> Pagar {elegidas.length} factura{elegidas.length === 1 ? '' : 's'} ({formatearDinero(elegidas.reduce((s, c) => s + c.saldo, 0))})
              </button>
            )}
          </div>

          <div className="bg-white rounded-xl shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left"><tr>
                <th className="px-3 py-2 w-8"><span className="sr-only">Elegir</span></th>
                <th className="px-3 py-2">Proveedor</th><th className="px-3 py-2">Factura</th><th className="px-3 py-2">Sucursal</th>
                <th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Vence</th>
                <th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-right">Saldo</th>
              </tr></thead>
              <tbody>
                {datos?.datos.length === 0 && <tr><td colSpan={8} className="px-3 py-4 text-slate-500">No hay facturas {estado === 'pendiente' ? 'pendientes' : ''}.</td></tr>}
                {datos?.datos.map(c => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      {c.estado === 'pendiente' && <input type="checkbox" aria-label={`Elegir factura ${c.folioFactura}`} checked={seleccion.includes(c.id)} onChange={() => alternar(c)} />}
                    </td>
                    <td className="px-3 py-2">{c.proveedor.nombre}</td>
                    <td className="px-3 py-2 font-mono">{c.folioFactura}</td>
                    <td className="px-3 py-2">{c.sucursal.nombre}</td>
                    <td className="px-3 py-2">{formatearFecha(c.fechaFactura)}</td>
                    <td className="px-3 py-2">{c.pagadaAlRecibir ? 'De contado' : <Vence cuenta={c} />}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatearDinero(c.total)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{c.estado === 'pagada' ? 'Pagada' : formatearDinero(c.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {pagando && (
        <PagoProveedorFormulario
          proveedor={pagando.proveedor}
          cuentas={pagando.cuentas}
          alCerrar={() => setPagando(null)}
          alPagar={() => { setPagando(null); setSeleccion([]); cargar(); }}
        />
      )}
    </section>
  );
}

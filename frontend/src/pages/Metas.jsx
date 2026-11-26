import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Target } from 'lucide-react';
import toast from 'react-hot-toast';
import { mensajeDeError, metasAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { centavosATexto, formatearDinero, hoyLocal, pesosACentavos } from '../utils/formato';
import BarraAvance from '../components/metas/BarraAvance';

// Metas de venta del mes (dueño): por sucursal y por vendedor, con avance y proyección.
export default function Metas() {
  const { puede, sucursalActiva } = useAuth();
  const editable = puede('metas:gestionar');
  const [periodo, setPeriodo] = useState(hoyLocal().slice(0, 7));
  const [datos, setDatos] = useState(null);

  const cargar = useCallback(async () => {
    try {
      setDatos((await metasAPI.avance({ periodo })).data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudieron cargar las metas'));
    }
  }, [periodo]);

  useEffect(() => {
    cargar();
  }, [cargar, sucursalActiva]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/reportes" className="flex items-center gap-1 text-sm text-slate-600"><ArrowLeft size={16} /> Reportes</Link>
        <h2 className="text-lg font-semibold mr-auto flex items-center gap-2"><Target size={20} aria-hidden="true" /> Metas de venta</h2>
        <label className="text-sm">Mes
          <input type="month" className="ml-2 rounded-lg border border-slate-300 px-2 py-1" value={periodo} onChange={e => e.target.value && setPeriodo(e.target.value)} />
        </label>
      </div>
      {datos && (
        <p className="text-sm text-slate-600">
          {datos.enCurso ? `Día ${datos.diasTranscurridos} de ${datos.diasMes}.` : `Mes de ${datos.diasMes} días.`} Las ventas cuentan para el vendedor elegido en la caja
          (o para quien cobró) y se miden con IVA.
        </p>
      )}
      {datos?.sucursales.length === 0 && <p className="text-slate-500">Sin ventas ni metas en este mes.</p>}
      {datos?.sucursales.map(s => <SucursalMetas key={s.sucursal.id} fila={s} periodo={periodo} editable={editable} alCambiar={cargar} />)}
    </section>
  );
}

function SucursalMetas({ fila, periodo, editable, alCambiar }) {
  const [vendedores, setVendedores] = useState([]);
  const [nuevo, setNuevo] = useState('');
  const conHeader = { headers: { 'X-Sucursal': fila.sucursal.id } };

  useEffect(() => {
    if (editable) metasAPI.vendedores(conHeader).then(r => setVendedores(r.data.datos)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, fila.sucursal.id]);

  const guardar = async (vendedor, texto) => {
    const monto = pesosACentavos(texto);
    if (Number.isNaN(monto)) return toast.error('Meta en pesos, máximo 2 decimales');
    try {
      await metasAPI.fijar({ periodo, vendedor: vendedor || null, monto: monto || 0 }, conHeader);
      toast.success(monto ? 'Meta guardada' : 'Meta quitada');
      alCambiar();
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo guardar la meta'));
    }
  };

  const sinMeta = vendedores.filter(v => !fila.vendedores.some(x => String(x.vendedor.id) === String(v.id)));

  return (
    <div className="bg-white rounded-xl shadow p-4 space-y-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-64 space-y-1">
          <h3 className="font-semibold">{fila.sucursal.nombre}</h3>
          <BarraAvance vendido={fila.vendido} meta={fila.meta} proyeccion={fila.proyeccion} etiqueta="" />
          <p className="text-xs text-slate-500">{fila.tickets} ticket{fila.tickets === 1 ? '' : 's'}</p>
        </div>
        {editable && <CampoMeta etiqueta="Meta de la sucursal" valor={fila.meta} alGuardar={t => guardar(null, t)} />}
      </div>

      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left"><tr>
          <th className="px-3 py-2">#</th><th className="px-3 py-2">Vendedor</th><th className="px-3 py-2 text-right">Vendido</th><th className="px-3 py-2 text-right">Tickets</th>
          <th className="px-3 py-2 w-1/3">Avance</th>{editable && <th className="px-3 py-2">Meta</th>}
        </tr></thead>
        <tbody>
          {fila.vendedores.length === 0 && <tr><td colSpan={6} className="px-3 py-3 text-slate-500">Sin ventas en el mes.</td></tr>}
          {fila.vendedores.map((v, i) => (
            <tr key={v.vendedor.id} className="border-t border-slate-100 align-top">
              <td className="px-3 py-2 text-slate-500 tabular-nums">{i + 1}</td>
              <td className="px-3 py-2">{v.vendedor.nombre}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatearDinero(v.vendido)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{v.tickets}</td>
              <td className="px-3 py-2">{v.meta ? <BarraAvance vendido={v.vendido} meta={v.meta} proyeccion={v.proyeccion} etiqueta="" /> : <span className="text-slate-400">Sin meta</span>}</td>
              {editable && <td className="px-3 py-2"><CampoMeta valor={v.meta} alGuardar={t => guardar(v.vendedor.id, t)} /></td>}
            </tr>
          ))}
        </tbody>
      </table>

      {editable && sinMeta.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Agregar meta a</span>
          <select className="rounded-lg border border-slate-300 px-2 py-1" value={nuevo} onChange={e => setNuevo(e.target.value)}>
            <option value="">Elige…</option>
            {sinMeta.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </select>
          {nuevo && <CampoMeta valor={null} alGuardar={t => { guardar(nuevo, t); setNuevo(''); }} />}
        </div>
      )}
    </div>
  );
}

function CampoMeta({ etiqueta, valor, alGuardar }) {
  const [texto, setTexto] = useState(valor ? centavosATexto(valor) : '');
  useEffect(() => setTexto(valor ? centavosATexto(valor) : ''), [valor]);
  const cambio = (pesosACentavos(texto) || null) !== (valor || null);
  return (
    <form onSubmit={e => { e.preventDefault(); alGuardar(texto); }} className="flex items-end gap-1">
      <label className="text-xs text-slate-600">{etiqueta}
        <input className="block w-28 rounded border border-slate-300 px-2 py-1 text-right text-sm tabular-nums" inputMode="decimal" placeholder="$0.00" aria-label={etiqueta || 'Meta'} value={texto} onChange={e => setTexto(e.target.value)} />
      </label>
      <button type="submit" disabled={!cambio} className="rounded bg-emerald-600 text-white px-2 py-1 text-xs disabled:opacity-40">Guardar</button>
    </form>
  );
}

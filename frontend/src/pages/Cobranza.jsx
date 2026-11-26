import { useCallback, useEffect, useState } from 'react';
import { Download, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { clientesAPI, cobranzaAPI, mensajeDeError } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { formatearDinero, formatearFecha, hoyLocal } from '../utils/formato';
import EstadoCuenta from '../components/cobranza/EstadoCuenta';

const TRAMOS = [['corriente', 'Al corriente'], ['d1_30', '1–30 días'], ['d31_60', '31–60 días'], ['mas60', 'Más de 60']];

// Cobranza: cartera por antigüedad (dueño) y estado de cuenta con abonos (dueño y cajero).
export default function Cobranza() {
  const { puede } = useAuth();
  const verCartera = puede('cobranza:ver');
  const [q, setQ] = useState('');
  const [cartera, setCartera] = useState(null);
  const [clientes, setClientes] = useState([]);
  const [elegido, setElegido] = useState(null);

  const cargar = useCallback(async () => {
    try {
      if (verCartera) {
        setCartera((await cobranzaAPI.cartera({ q: q.trim() || undefined })).data);
      } else {
        const lista = (await clientesAPI.listar({ q: q.trim() || undefined, activo: true })).data.datos;
        setClientes(lista.filter(c => c.credito?.activo));
      }
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo cargar la cobranza'));
    }
  }, [q, verCartera]);

  useEffect(() => {
    const t = setTimeout(cargar, 250);
    return () => clearTimeout(t);
  }, [cargar]);

  const descargar = async () => {
    try {
      const { data } = await cobranzaAPI.carteraExcel();
      const url = URL.createObjectURL(data);
      const a = Object.assign(document.createElement('a'), { href: url, download: `cartera-${hoyLocal()}.xlsx` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo descargar la cartera'));
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold mr-auto">Cobranza</h2>
        <label className="relative min-w-64">
          <Search size={16} className="absolute left-3 top-3 text-slate-400" aria-hidden="true" />
          <span className="sr-only">Buscar cliente</span>
          <input className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2" placeholder="Buscar cliente" value={q} onChange={e => setQ(e.target.value)} />
        </label>
        {verCartera && (
          <button type="button" onClick={descargar} className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
            <Download size={16} /> Excel de cartera
          </button>
        )}
      </div>

      {verCartera && cartera && <TablaCartera cartera={cartera} elegido={elegido} alElegir={setElegido} />}
      {!verCartera && (
        <div className="bg-white rounded-xl shadow divide-y divide-slate-100">
          {clientes.length === 0 && <p className="p-4 text-sm text-slate-500">No hay clientes con crédito{q ? ' que coincidan' : ''}.</p>}
          {clientes.map(c => (
            <button key={c.id} type="button" onClick={() => setElegido(c.id)} className={`w-full text-left px-4 py-2 hover:bg-emerald-50 ${elegido === c.id ? 'bg-emerald-50' : ''}`}>
              {c.nombre} <span className="text-xs text-slate-500">· límite {formatearDinero(c.credito.limite)}</span>
            </button>
          ))}
        </div>
      )}

      {elegido && <EstadoCuenta key={elegido} clienteId={elegido} alCambiar={cargar} alCerrar={() => setElegido(null)} />}
    </section>
  );
}

function TablaCartera({ cartera, elegido, alElegir }) {
  const t = cartera.totales;
  return (
    <div className="bg-white rounded-xl shadow overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-100 text-left">
          <tr>
            <th className="px-3 py-2">Cliente</th>
            <th className="px-3 py-2 text-right">Límite</th>
            <th className="px-3 py-2 text-right">Saldo</th>
            {TRAMOS.map(([k, n]) => <th key={k} className="px-3 py-2 text-right">{n}</th>)}
            <th className="px-3 py-2 text-right">Disponible</th>
            <th className="px-3 py-2">Vence primero</th>
          </tr>
        </thead>
        <tbody>
          {cartera.datos.length === 0 && <tr><td colSpan={9} className="px-3 py-4 text-slate-500">Ningún cliente tiene crédito todavía. Actívalo en Administración → Clientes.</td></tr>}
          {cartera.datos.map(f => (
            <tr key={f.cliente.id} onClick={() => alElegir(f.cliente.id)} className={`border-t border-slate-100 cursor-pointer hover:bg-emerald-50 ${elegido === f.cliente.id ? 'bg-emerald-50' : ''}`}>
              <td className="px-3 py-2">{f.cliente.nombre}{!f.credito.activo && <span className="text-xs text-slate-500"> (sin crédito activo)</span>}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatearDinero(f.credito.limite)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-medium">{formatearDinero(f.saldo)}</td>
              {TRAMOS.map(([k]) => (
                <td key={k} className={`px-3 py-2 text-right tabular-nums ${k !== 'corriente' && f[k] > 0 ? 'text-red-700 font-medium' : ''}`}>{f[k] ? formatearDinero(f[k]) : '—'}</td>
              ))}
              <td className="px-3 py-2 text-right tabular-nums">{formatearDinero(f.disponible)}</td>
              <td className="px-3 py-2">{f.vencimientoMasAntiguo ? formatearFecha(f.vencimientoMasAntiguo) : '—'}</td>
            </tr>
          ))}
        </tbody>
        {cartera.datos.length > 0 && (
          <tfoot className="bg-slate-50 font-semibold">
            <tr className="border-t border-slate-200">
              <td className="px-3 py-2">Total</td>
              <td />
              <td className="px-3 py-2 text-right tabular-nums">{formatearDinero(t.saldo)}</td>
              {TRAMOS.map(([k]) => <td key={k} className="px-3 py-2 text-right tabular-nums">{formatearDinero(t[k])}</td>)}
              <td colSpan={2} />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

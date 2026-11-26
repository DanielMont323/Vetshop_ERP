import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { clientesAPI, facturasAPI, mensajeDeError } from '../../services/api';
import { formatearDinero, formatearFecha } from '../../utils/formato';
import { nuevaClaveOperacion } from '../../utils/caja';
import { USOS_CFDI } from '../../utils/sat';

// Facturar a un cliente una o varias ventas cobradas y sin factura de la sucursal.
export default function NuevaFactura({ alCerrar, alEmitir }) {
  const [clientes, setClientes] = useState([]);
  const [clienteId, setClienteId] = useState('');
  const [ventas, setVentas] = useState([]);
  const [elegidas, setElegidas] = useState([]);
  const [folio, setFolio] = useState('');
  const [uso, setUso] = useState('');
  const [clave] = useState(nuevaClaveOperacion);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    clientesAPI.listar({ activo: true }).then(r => setClientes(r.data.datos.filter(c => !c.esPublicoGeneral))).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      const n = Number(folio.replace(/\D/g, ''));
      facturasAPI.ventasFacturables(n ? { folio: n } : {}).then(r => setVentas(r.data.datos)).catch(e => toast.error(mensajeDeError(e, 'No se pudieron cargar las ventas')));
    }, 250);
    return () => clearTimeout(t);
  }, [folio]);

  const cliente = clientes.find(c => c.id === clienteId);
  const faltan = cliente && [!cliente.rfc && 'RFC', !cliente.fiscal?.razonSocial && 'razón social', !cliente.fiscal?.regimen && 'régimen', !cliente.fiscal?.codigoPostal && 'código postal'].filter(Boolean);
  // Primero las ventas de ese cliente
  const ordenadas = useMemo(() => [...ventas].sort((a, b) => (b.cliente.id === clienteId) - (a.cliente.id === clienteId)), [ventas, clienteId]);
  const total = ventas.filter(v => elegidas.includes(v.id)).reduce((s, v) => s + v.total, 0);
  const alternar = id => setElegidas(e => (e.includes(id) ? e.filter(x => x !== id) : [...e, id]));

  const emitir = async e => {
    e.preventDefault();
    setEnviando(true);
    try {
      const { data } = await facturasAPI.facturar({ claveOperacion: clave, cliente: clienteId, ventas: elegidas, usoCfdi: uso || undefined });
      toast.success(`Factura ${data.datos.folioCompleto} timbrada`);
      alEmitir(data.datos);
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo facturar'), { duration: 8000 });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true">
      <form onSubmit={emitir} className="bg-white rounded-xl shadow-lg w-full max-w-2xl p-6 space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Facturar a cliente</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500"><X /></button>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block text-sm"><span className="font-medium">Cliente</span>
            <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={clienteId} onChange={e => { setClienteId(e.target.value); setUso(''); }} required>
              <option value="">Elige…</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}{c.rfc ? ` · ${c.rfc}` : ''}</option>)}
            </select></label>
          <label className="block text-sm"><span className="font-medium">Uso del CFDI</span>
            <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={uso || cliente?.fiscal?.usoCfdi || 'G03'} onChange={e => setUso(e.target.value)}>
              {Object.entries(USOS_CFDI).filter(([k]) => k !== 'S01').map(([k, n]) => <option key={k} value={k}>{k} · {n}</option>)}
            </select></label>
        </div>
        {faltan?.length > 0 && (
          <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Faltan datos fiscales de {cliente.nombre}: {faltan.join(', ')}. Captúralos en Administración → Clientes.</p>
        )}
        {cliente && !faltan?.length && <p className="text-sm text-slate-600">{cliente.fiscal.razonSocial} · RFC {cliente.rfc} · régimen {cliente.fiscal.regimen} · CP {cliente.fiscal.codigoPostal}</p>}

        <div className="flex items-center gap-3">
          <p className="font-medium text-sm mr-auto">Ventas sin facturar (últimos 30 días)</p>
          <input className="w-40 rounded-lg border border-slate-300 px-2 py-1 text-sm" placeholder="Buscar folio V-…" value={folio} onChange={e => setFolio(e.target.value)} />
        </div>
        <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <tbody>
              {ordenadas.length === 0 && <tr><td className="px-3 py-3 text-slate-500">No hay ventas por facturar.</td></tr>}
              {ordenadas.map(v => (
                <tr key={v.id} className="border-t border-slate-100 first:border-0">
                  <td className="px-3 py-1.5"><input type="checkbox" aria-label={`Elegir ${v.folio}`} checked={elegidas.includes(v.id)} onChange={() => alternar(v.id)} /></td>
                  <td className="px-3 py-1.5 font-mono">{v.folio}</td>
                  <td className="px-3 py-1.5">{formatearFecha(v.fecha, true)}</td>
                  <td className="px-3 py-1.5">{v.cliente.nombre}{v.aCredito && <span className="ml-1 text-xs text-sky-700">crédito (PPD)</span>}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatearDinero(v.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-end gap-3">
          <span className="text-sm mr-auto">{elegidas.length} venta(s) · <b>{formatearDinero(total)}</b></span>
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Cancelar</button>
          <button type="submit" disabled={enviando || !clienteId || !elegidas.length || faltan?.length > 0} className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">{enviando ? 'Timbrando…' : 'Timbrar factura'}</button>
        </div>
      </form>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Plus, ShoppingBag, ThermometerSnowflake } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { comprasAPI, mensajeDeError } from '../services/api';
import { NOMBRES_ESTADO_COMPRA, formatearDinero, formatearFecha } from '../utils/formato';
import CompraFormulario from '../components/CompraFormulario';

const FILTROS = [['', 'Todas'], ['borrador', 'Borradores'], ['recibida', 'Recibidas'], ['cancelada', 'Canceladas']];

// Recepciones de mercancía de la sucursal activa.
export default function Compras() {
  const { sucursalActiva } = useAuth();
  const [estado, setEstado] = useState('');
  const [lista, setLista] = useState([]);
  const [abierta, setAbierta] = useState(null); // null | 'nueva' | compra completa

  const cargar = useCallback(async () => {
    try {
      const r = await comprasAPI.listar({ estado: estado || undefined, limite: 100 });
      setLista(r.data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudieron cargar las compras'));
    }
  }, [estado]);

  useEffect(() => {
    cargar();
  }, [cargar, sucursalActiva]);

  const abrir = async id => {
    try {
      const r = await comprasAPI.obtener(id);
      setAbierta(r.data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo abrir la compra'));
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold mr-auto">Recepción de mercancía</h2>
        <Link to="/pedidos" className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
          <ClipboardList size={16} aria-hidden="true" /> Pedidos a proveedores
        </Link>
        <Link to="/compras-sugeridas" className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
          <ShoppingBag size={16} aria-hidden="true" /> Compras sugeridas
        </Link>
        <button type="button" onClick={() => setAbierta('nueva')} className="flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-3 py-2 hover:bg-emerald-700">
          <Plus size={18} aria-hidden="true" /> Nueva recepción
        </button>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist">
        {FILTROS.map(([valor, texto]) => (
          <button key={valor} type="button" role="tab" aria-selected={estado === valor} onClick={() => setEstado(valor)}
            className={`rounded-lg px-3 py-1.5 text-sm border ${estado === valor ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-slate-300'}`}>
            {texto}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="px-3 py-2">Fecha factura</th>
              <th className="px-3 py-2">Proveedor</th>
              <th className="px-3 py-2">Folio</th>
              <th className="px-3 py-2">Pago</th>
              <th className="px-3 py-2 text-right">Partidas</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {lista.map(c => (
              <tr key={c.id} onClick={() => abrir(c.id)} className="border-t border-slate-100 cursor-pointer hover:bg-emerald-50">
                <td className="px-3 py-2">{formatearFecha(c.fechaFactura)}</td>
                <td className="px-3 py-2">{c.proveedor.nombre}</td>
                <td className="px-3 py-2 font-mono">{c.folioFactura}</td>
                <td className="px-3 py-2">{c.condicionPago === 'credito' ? `Crédito (vence ${formatearFecha(c.vencimiento)})` : 'Contado'}</td>
                <td className="px-3 py-2 text-right">{c.numPartidas}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatearDinero(c.total)}</td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${NOMBRES_ESTADO_COMPRA[c.estado].clase}`}>{NOMBRES_ESTADO_COMPRA[c.estado].texto}</span>
                    {c.alertaTemperatura && <ThermometerSnowflake size={16} className="text-red-600" aria-label="Llegó fuera de temperatura" />}
                  </span>
                </td>
              </tr>
            ))}
            {lista.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No hay compras.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {abierta && (
        <CompraFormulario
          compra={abierta === 'nueva' ? null : abierta}
          alCerrar={() => setAbierta(null)}
          alGuardar={() => { setAbierta(null); cargar(); }}
        />
      )}
    </section>
  );
}

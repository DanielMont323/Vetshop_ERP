import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { mensajeDeError, traspasosAPI } from '../services/api';
import { NOMBRES_ESTADO_TRASPASO, formatearFecha } from '../utils/formato';
import TraspasoNuevo from '../components/traspasos/TraspasoNuevo';
import TraspasoDetalle from '../components/traspasos/TraspasoDetalle';

const VISTAS = [
  ['porRecibir', 'Por recibir', { direccion: 'recibidos', estado: 'en_transito' }],
  ['diferencias', 'Con diferencia', { estado: 'con_diferencia' }],
  ['enviados', 'Enviados', { direccion: 'enviados' }],
  ['recibidos', 'Recibidos', { direccion: 'recibidos' }],
  ['todos', 'Todos', {}]
];

// Traspasos de la sucursal activa (como origen o destino).
export default function Traspasos() {
  const { sucursalActiva } = useAuth();
  const [vista, setVista] = useState('porRecibir');
  const [lista, setLista] = useState([]);
  const [nuevo, setNuevo] = useState(false);
  const [detalle, setDetalle] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const filtros = VISTAS.find(v => v[0] === vista)[2];
      const r = await traspasosAPI.listar({ ...filtros, limite: 100 });
      setLista(r.data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudieron cargar los traspasos'));
    }
  }, [vista]);

  useEffect(() => {
    cargar();
  }, [cargar, sucursalActiva]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold mr-auto">Traspasos</h2>
        <button type="button" onClick={() => setNuevo(true)} className="flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-3 py-2 hover:bg-emerald-700"><Plus size={18} /> Nuevo traspaso</button>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist">
        {VISTAS.map(([v, texto]) => (
          <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => setVista(v)}
            className={`rounded-lg px-3 py-1.5 text-sm border ${vista === v ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-slate-300'}`}>{texto}</button>
        ))}
      </div>
      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr><th className="px-3 py-2">Folio</th><th className="px-3 py-2">Enviado</th><th className="px-3 py-2">Origen → destino</th><th className="px-3 py-2">Productos</th><th className="px-3 py-2">Estado</th></tr>
          </thead>
          <tbody>
            {lista.map(t => (
              <tr key={t.id} onClick={() => setDetalle(t)} className="border-t border-slate-100 cursor-pointer hover:bg-emerald-50">
                <td className="px-3 py-2 font-mono">T-{t.folio}</td>
                <td className="px-3 py-2">{formatearFecha(t.envio.fecha, true)}</td>
                <td className="px-3 py-2">{t.origen.nombre} → {t.destino.nombre}</td>
                <td className="px-3 py-2">{t.partidas.map(p => p.nombre).join(', ')}</td>
                <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs ${NOMBRES_ESTADO_TRASPASO[t.estado].clase}`}>{NOMBRES_ESTADO_TRASPASO[t.estado].texto}</span></td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">No hay traspasos.</td></tr>}
          </tbody>
        </table>
      </div>
      {nuevo && <TraspasoNuevo alCerrar={() => setNuevo(false)} alEnviar={t => { setNuevo(false); setVista('enviados'); setDetalle(t); }} />}
      {detalle && <TraspasoDetalle traspaso={detalle} alCerrar={() => setDetalle(null)} alCambiar={cargar} />}
    </section>
  );
}

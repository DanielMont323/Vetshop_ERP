import { useCallback, useEffect, useState } from 'react';
import { Bell, Check, MessageCircle, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { mensajeDeError, recordatoriosAPI } from '../services/api';
import { useDialogo } from '../contexts/DialogoContext';
import { TIPOS_RECORDATORIO, enlaceWhatsapp, fechaLarga, mensajeWhatsapp } from '../utils/recordatorios';
import { hoyLocal } from '../utils/formato';

const VISTAS = [['hoy', 'Para avisar hoy'], ['proximos', 'Próximos 30 días'], ['avisados', 'Ya avisados']];

// Recordatorios de la sucursal: el cajero abre WhatsApp con el mensaje listo y lo marca como avisado.
export default function Recordatorios() {
  const { confirmar } = useDialogo();
  const [vista, setVista] = useState('hoy');
  const [lista, setLista] = useState([]);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setLista((await recordatoriosAPI.listar({ vista })).data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudieron cargar los recordatorios'));
    } finally {
      setCargando(false);
    }
  }, [vista]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  const accion = async (r, tipo) => {
    try {
      if (tipo === 'avisado') await recordatoriosAPI.avisado(r.id);
      if (tipo === 'hecho') {
        const { data } = await recordatoriosAPI.hecho(r.id);
        toast.success(data.datos.siguiente ? `Listo. El siguiente queda para el ${fechaLarga(data.datos.siguiente.fecha)}` : 'Listo');
      }
      if (tipo === 'cancelar') {
        if (!(await confirmar(`¿Cancelar el recordatorio «${r.descripcion}» de ${r.cliente.nombre}?`, { textoAceptar: 'Sí, cancelar', textoCancelar: 'No' }))) return;
        await recordatoriosAPI.cancelar(r.id);
      }
      cargar();
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo actualizar'));
    }
  };

  // Abre WhatsApp con el texto y lo marca como avisado
  const avisar = r => {
    window.open(enlaceWhatsapp(r.cliente.whatsapp, mensajeWhatsapp(r)), '_blank', 'noopener');
    if (r.estado === 'pendiente') accion(r, 'avisado');
  };

  const hoy = hoyLocal();
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold mr-auto flex items-center gap-2"><Bell size={20} aria-hidden="true" /> Recordatorios</h2>
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm" role="group" aria-label="Vista">
          {VISTAS.map(([v, t]) => (
            <button key={v} type="button" onClick={() => setVista(v)} aria-pressed={vista === v} className={`px-3 py-1.5 ${vista === v ? 'bg-emerald-600 text-white' : 'hover:bg-slate-50'}`}>{t}</button>
          ))}
        </div>
      </div>
      <p className="text-sm text-slate-600">Para programar uno nuevo, abre la ficha del cliente en <strong>Clientes</strong>, o hazlo desde la caja después de vender alimento.</p>
      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr>
            <th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Recordatorio</th><th className="px-3 py-2">Fecha</th><th className="px-3 py-2 text-right">Acciones</th>
          </tr></thead>
          <tbody>
            {!cargando && lista.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-slate-500">{vista === 'hoy' ? 'No hay recordatorios para avisar hoy.' : 'Nada por aquí.'}</td></tr>}
            {lista.map(r => (
              <tr key={r.id} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2">{r.cliente.nombre}<span className="block text-xs text-slate-500">{r.cliente.whatsapp || r.cliente.telefono || 'Sin WhatsApp'}</span></td>
                <td className="px-3 py-2"><span className="font-medium">{TIPOS_RECORDATORIO[r.tipo]}</span>{r.mascota ? ` · ${r.mascota.nombre}` : ''}<span className="block">{r.descripcion}</span></td>
                <td className="px-3 py-2 whitespace-nowrap">{fechaLarga(r.fecha)}{r.fecha < hoy && <span className="block text-xs text-red-700">Ya pasó</span>}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap justify-end gap-2">
                    {r.cliente.whatsapp
                      ? <button type="button" onClick={() => avisar(r)} className="flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-3 py-1.5 hover:bg-emerald-700"><MessageCircle size={16} /> WhatsApp</button>
                      : r.estado === 'pendiente' && <button type="button" onClick={() => accion(r, 'avisado')} className="rounded-lg border border-slate-300 px-3 py-1.5">Ya le avisé</button>}
                    <button type="button" onClick={() => accion(r, 'hecho')} title="Ya compró o ya fue a su cita" className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50"><Check size={16} /> Hecho</button>
                    <button type="button" onClick={() => accion(r, 'cancelar')} aria-label="Cancelar recordatorio" className="rounded-lg border border-slate-300 px-2 py-1.5 text-slate-500 hover:bg-slate-50"><X size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

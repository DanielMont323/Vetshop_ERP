import { useCallback, useEffect, useState } from 'react';
import { BookUser, MessageCircle, PawPrint, Plus, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { clientesAPI, configuracionAPI, mensajeDeError } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import ClienteContacto from '../components/clientes/ClienteContacto';
import FichaCliente from '../components/clientes/FichaCliente';
import { enlaceWhatsapp } from '../utils/recordatorios';

const TIPOS = { publico: 'Público', clinica: 'Clínica', veterinaria: 'Veterinaria', petshop: 'Petshop', estetica: 'Estética', empleado: 'Empleado' };

// Directorio de clientes: búsqueda por nombre, teléfono, WhatsApp o dirección; alta rápida y datos de contacto.
export default function Directorio() {
  const { puede } = useAuth();
  const editable = puede('clientes:registrar');
  const [q, setQ] = useState('');
  const [lista, setLista] = useState([]);
  const [editando, setEditando] = useState(null); // 'nuevo' | cliente
  const [ficha, setFicha] = useState(null);
  const [configLealtad, setConfigLealtad] = useState(null);

  useEffect(() => {
    configuracionAPI.obtener().then(r => setConfigLealtad(r.data.datos.lealtad)).catch(() => {});
  }, []);

  const cargar = useCallback(async () => {
    try {
      setLista((await clientesAPI.listar({ q: q.trim() || undefined, activo: true })).data.datos.filter(c => !c.esPublicoGeneral));
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo cargar el directorio'));
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(cargar, 250);
    return () => clearTimeout(t);
  }, [cargar]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold mr-auto flex items-center gap-2"><BookUser size={20} aria-hidden="true" /> Directorio de clientes</h2>
        {editable && <button type="button" onClick={() => setEditando('nuevo')} className="flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-3 py-2 hover:bg-emerald-700"><Plus size={18} /> Nuevo cliente</button>}
      </div>
      <label className="relative block">
        <Search size={16} className="absolute left-3 top-3 text-slate-400" aria-hidden="true" />
        <span className="sr-only">Buscar cliente</span>
        <input className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2" placeholder="Nombre, teléfono, WhatsApp o dirección" value={q} onChange={e => setQ(e.target.value)} autoFocus />
      </label>
      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr>
            <th className="px-3 py-2">Nombre</th><th className="px-3 py-2">Teléfono</th><th className="px-3 py-2">WhatsApp</th><th className="px-3 py-2">Dirección</th><th className="px-3 py-2">Notas</th><th className="px-3 py-2 text-right">Puntos</th><th className="px-3 py-2" />
          </tr></thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-slate-500">{q ? 'Ningún cliente coincide.' : 'Todavía no hay clientes registrados.'}</td></tr>}
            {lista.map(c => (
              <tr key={c.id} onClick={() => editable && setEditando(c)} className={`border-t border-slate-100 ${editable ? 'cursor-pointer hover:bg-emerald-50' : ''}`}>
                <td className="px-3 py-2">{c.nombre}<span className="block text-xs text-slate-500">{TIPOS[c.tipo]}{c.credito?.activo ? ' · con crédito' : ''}</span></td>
                <td className="px-3 py-2">{c.telefono || '—'}</td>
                <td className="px-3 py-2">
                  {c.whatsapp
                    ? <a href={enlaceWhatsapp(c.whatsapp)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 text-emerald-700 underline"><MessageCircle size={14} /> {c.whatsapp}</a>
                    : '—'}
                </td>
                <td className="px-3 py-2">{c.direccion || '—'}</td>
                <td className="px-3 py-2 text-slate-600">{c.notas || ''}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.tipo === 'publico' ? <>{c.lealtad?.puntos || 0}<span className="block text-xs text-slate-500">{c.lealtad?.costales || 0} costales</span></> : '—'}</td>
                <td className="px-3 py-2 text-right"><button type="button" onClick={e => { e.stopPropagation(); setFicha(c); }} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-white"><PawPrint size={14} /> Mascotas</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ficha && <FichaCliente cliente={ficha} configLealtad={configLealtad} alCerrar={() => { setFicha(null); cargar(); }} />}
      {editando && <ClienteContacto cliente={editando === 'nuevo' ? null : editando} alCerrar={() => setEditando(null)} alGuardar={() => { setEditando(null); cargar(); }} />}
    </section>
  );
}

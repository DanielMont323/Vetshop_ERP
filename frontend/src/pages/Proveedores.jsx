import { useCallback, useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { mensajeDeError, proveedoresAPI } from '../services/api';

const campo = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500';
const vacio = { nombre: '', rfc: '', contacto: '', telefono: '', whatsapp: '', email: '', diasCredito: '0', activo: true };

export default function Proveedores() {
  const [q, setQ] = useState('');
  const [lista, setLista] = useState([]);
  const [editando, setEditando] = useState(null); // null | 'nuevo' | proveedor
  const [f, setF] = useState(vacio);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await proveedoresAPI.listar({ q: q.trim() || undefined });
      setLista(r.data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudieron cargar los proveedores'));
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(cargar, 250);
    return () => clearTimeout(t);
  }, [cargar]);

  const abrir = p => {
    setEditando(p);
    setF(p === 'nuevo' ? vacio : { ...p, rfc: p.rfc || '', diasCredito: String(p.diasCredito) });
  };

  const guardar = async e => {
    e.preventDefault();
    const dias = Number(f.diasCredito);
    if (!Number.isInteger(dias) || dias < 0) return toast.error('Días de crédito: número entero');
    const cuerpo = { nombre: f.nombre.trim(), rfc: f.rfc.trim(), contacto: f.contacto.trim(), telefono: f.telefono.trim(), whatsapp: f.whatsapp, email: f.email.trim(), diasCredito: dias, activo: f.activo };
    setGuardando(true);
    try {
      if (editando === 'nuevo') await proveedoresAPI.crear(cuerpo);
      else await proveedoresAPI.actualizar(editando.id, cuerpo);
      toast.success('Proveedor guardado');
      setEditando(null);
      cargar();
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo guardar'));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold mr-auto">Proveedores</h2>
        <button type="button" onClick={() => abrir('nuevo')} className="flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-3 py-2 hover:bg-emerald-700">
          <Plus size={18} aria-hidden="true" /> Nuevo proveedor
        </button>
      </div>
      <label className="relative block max-w-md">
        <Search size={16} className="absolute left-3 top-3 text-slate-400" aria-hidden="true" />
        <span className="sr-only">Buscar proveedor</span>
        <input className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2" placeholder="Nombre, RFC o contacto" value={q} onChange={e => setQ(e.target.value)} />
      </label>

      {editando && (
        <form onSubmit={guardar} className="bg-white rounded-xl shadow p-4 grid sm:grid-cols-3 gap-4">
          <fieldset disabled={guardando} className="contents">
            <label className="block sm:col-span-2"><span className="text-sm font-medium">Nombre</span>
              <input className={campo} value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} required maxLength={120} /></label>
            <label className="block"><span className="text-sm font-medium">RFC</span>
              <input className={campo} value={f.rfc} onChange={e => setF({ ...f, rfc: e.target.value.toUpperCase() })} maxLength={13} /></label>
            <label className="block"><span className="text-sm font-medium">Contacto</span>
              <input className={campo} value={f.contacto} onChange={e => setF({ ...f, contacto: e.target.value })} maxLength={80} /></label>
            <label className="block"><span className="text-sm font-medium">Teléfono</span>
              <input className={campo} value={f.telefono} onChange={e => setF({ ...f, telefono: e.target.value })} maxLength={20} /></label>
            <label className="block text-sm"><span className="font-medium">WhatsApp (10 dígitos, para pedidos)</span>
              <input className={campo} inputMode="numeric" value={f.whatsapp} onChange={e => setF({ ...f, whatsapp: e.target.value.replace(/\D/g, '').slice(0, 10) })} /></label>
            <label className="block"><span className="text-sm font-medium">Correo</span>
              <input type="email" className={campo} value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></label>
            <label className="block"><span className="text-sm font-medium">Días de crédito</span>
              <input className={campo} inputMode="numeric" value={f.diasCredito} onChange={e => setF({ ...f, diasCredito: e.target.value })} /></label>
            <label className="flex items-center gap-2 text-sm self-end pb-2">
              <input type="checkbox" checked={f.activo} onChange={e => setF({ ...f, activo: e.target.checked })} /> Activo</label>
            <div className="sm:col-span-3 flex justify-end gap-3">
              <button type="button" onClick={() => setEditando(null)} className="rounded-lg border border-slate-300 px-4 py-2">Cancelar</button>
              <button type="submit" className="rounded-lg bg-emerald-600 text-white font-medium px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">Guardar</button>
            </div>
          </fieldset>
        </form>
      )}

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr><th className="px-3 py-2">Nombre</th><th className="px-3 py-2">RFC</th><th className="px-3 py-2">Contacto</th><th className="px-3 py-2 text-right">Crédito</th></tr>
          </thead>
          <tbody>
            {lista.map(p => (
              <tr key={p.id} onClick={() => abrir(p)} className={`border-t border-slate-100 cursor-pointer hover:bg-emerald-50 ${p.activo ? '' : 'text-slate-400'}`}>
                <td className="px-3 py-2">{p.nombre}{!p.activo && ' (inactivo)'}</td>
                <td className="px-3 py-2 font-mono">{p.rfc || '—'}</td>
                <td className="px-3 py-2">{[p.contacto, p.telefono].filter(Boolean).join(' · ') || '—'}</td>
                <td className="px-3 py-2 text-right">{p.diasCredito ? `${p.diasCredito} días` : 'Contado'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

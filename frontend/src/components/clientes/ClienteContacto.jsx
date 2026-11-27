import { useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { clientesAPI, mensajeDeError } from '../../services/api';

const campo = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2';

// Alta rápida de cliente (sin `cliente`) o edición de sus datos de contacto. Desde la caja y el directorio.
// El crédito, la lista de precios y los datos fiscales los maneja el dueño en Administración → Clientes.
export default function ClienteContacto({ cliente, alCerrar, alGuardar }) {
  const [f, setF] = useState({
    nombre: cliente?.nombre || '', telefono: cliente?.telefono || '', whatsapp: cliente?.whatsapp || '',
    email: cliente?.email || '', direccion: cliente?.direccion || '', notas: cliente?.notas || ''
  });
  const [enviando, setEnviando] = useState(false);
  const cambiar = (k, v) => setF(x => ({ ...x, [k]: v }));
  const errorWa = f.whatsapp && !/^\d{10}$/.test(f.whatsapp) ? 'WhatsApp: 10 dígitos' : null;

  const enviar = async e => {
    e.preventDefault();
    if (errorWa) return;
    setEnviando(true);
    const contacto = { telefono: f.telefono.trim(), whatsapp: f.whatsapp, email: f.email.trim(), direccion: f.direccion.trim(), notas: f.notas.trim() };
    try {
      const { data } = cliente
        ? await clientesAPI.contacto(cliente.id, contacto)
        : await clientesAPI.rapido({ nombre: f.nombre.trim(), ...Object.fromEntries(Object.entries(contacto).filter(([, v]) => v)) });
      toast.success(cliente ? 'Datos guardados' : `Cliente ${data.datos.nombre} registrado`);
      alGuardar(data.datos);
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo guardar el cliente'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true" onKeyDown={e => e.key === 'Escape' && alCerrar()}>
      <form onSubmit={enviar} className="bg-white rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{cliente ? cliente.nombre : 'Nuevo cliente'}</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500"><X /></button>
        </div>
        <fieldset disabled={enviando} className="grid grid-cols-2 gap-3">
          {!cliente && (
            <label className="col-span-2 block text-sm"><span className="font-medium">Nombre</span>
              <input className={campo} value={f.nombre} onChange={e => cambiar('nombre', e.target.value)} required maxLength={120} autoFocus /></label>
          )}
          <label className="block text-sm"><span className="font-medium">Teléfono</span>
            <input className={campo} value={f.telefono} onChange={e => cambiar('telefono', e.target.value)} maxLength={20} autoFocus={Boolean(cliente)} /></label>
          <label className="block text-sm"><span className="font-medium">WhatsApp (10 dígitos)</span>
            <input className={campo} inputMode="numeric" value={f.whatsapp} onChange={e => cambiar('whatsapp', e.target.value.replace(/\D/g, '').slice(0, 10))} /></label>
          <label className="col-span-2 block text-sm"><span className="font-medium">Dirección</span>
            <input className={campo} value={f.direccion} onChange={e => cambiar('direccion', e.target.value)} maxLength={300} placeholder="Calle, número, colonia" /></label>
          <label className="col-span-2 block text-sm"><span className="font-medium">Correo</span>
            <input type="email" className={campo} value={f.email} onChange={e => cambiar('email', e.target.value)} /></label>
          <label className="col-span-2 block text-sm"><span className="font-medium">Notas</span>
            <input className={campo} value={f.notas} onChange={e => cambiar('notas', e.target.value)} maxLength={500} placeholder="Mascotas, preferencias…" /></label>
        </fieldset>
        {errorWa && <p role="alert" className="text-sm text-red-700">{errorWa}</p>}
        {!cliente && <p className="text-xs text-slate-500">Se registra con precio de público. El crédito y los datos para facturar los agrega el dueño.</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Cancelar</button>
          <button type="submit" disabled={enviando || Boolean(errorWa)} className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">{cliente ? 'Guardar' : 'Registrar'}</button>
        </div>
      </form>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { clientesAPI, mensajeDeError } from '../../services/api';
import { LISTAS_PRECIO, centavosATexto, formatearDinero, pesosACentavos } from '../../utils/formato';

const TIPOS = [['publico', 'Público'], ['clinica', 'Clínica'], ['veterinaria', 'Veterinaria'], ['petshop', 'Petshop'], ['estetica', 'Estética'], ['empleado', 'Empleado']];
const nombreTipo = t => TIPOS.find(x => x[0] === t)?.[1] || t;
const campo = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2';

// Clientes: alta y edición, incluidos su lista de precios y su crédito. Solo el dueño.
export default function Clientes() {
  const [q, setQ] = useState('');
  const [lista, setLista] = useState([]);
  const [editando, setEditando] = useState(null);

  const cargar = useCallback(async () => {
    try {
      setLista((await clientesAPI.listar({ q: q.trim() || undefined })).data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudieron cargar los clientes'));
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(cargar, 250);
    return () => clearTimeout(t);
  }, [cargar]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 items-center">
        <label className="relative flex-1 min-w-60">
          <Search size={16} className="absolute left-3 top-3 text-slate-400" aria-hidden="true" />
          <span className="sr-only">Buscar cliente</span>
          <input className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2" placeholder="Nombre, RFC o teléfono" value={q} onChange={e => setQ(e.target.value)} />
        </label>
        <button type="button" onClick={() => setEditando('nuevo')} className="flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-3 py-2 hover:bg-emerald-700"><Plus size={18} /> Nuevo cliente</button>
      </div>
      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr><th className="px-3 py-2">Nombre</th><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Lista de precios</th><th className="px-3 py-2">Crédito</th><th className="px-3 py-2">RFC</th><th className="px-3 py-2">Teléfono</th></tr></thead>
          <tbody>
            {lista.map(c => (
              <tr key={c.id} onClick={() => !c.esPublicoGeneral && setEditando(c)} className={`border-t border-slate-100 ${c.esPublicoGeneral ? '' : 'cursor-pointer hover:bg-emerald-50'} ${c.activo ? '' : 'text-slate-400'}`}>
                <td className="px-3 py-2">{c.nombre}{!c.activo && ' (inactivo)'}</td>
                <td className="px-3 py-2">{nombreTipo(c.tipo)}</td>
                <td className="px-3 py-2">{LISTAS_PRECIO.find(l => l.clave === c.listaPrecios)?.nombre}</td>
                <td className="px-3 py-2">{c.credito?.activo ? `${formatearDinero(c.credito.limite)} · ${c.credito.dias} días` : '—'}</td>
                <td className="px-3 py-2 font-mono">{c.rfc || '—'}</td>
                <td className="px-3 py-2">{c.telefono || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editando && <FormularioCliente cliente={editando === 'nuevo' ? null : editando} alCerrar={() => setEditando(null)} alGuardar={() => { setEditando(null); cargar(); }} />}
    </div>
  );
}

function FormularioCliente({ cliente, alCerrar, alGuardar }) {
  const [f, setF] = useState({
    nombre: cliente?.nombre || '', tipo: cliente?.tipo || 'publico', listaPrecios: cliente?.listaPrecios || 'publico',
    rfc: cliente?.rfc || '', telefono: cliente?.telefono || '', email: cliente?.email || '', activo: cliente?.activo ?? true
  });
  const cr = cliente?.credito;
  const [credito, setCredito] = useState({
    activo: cr?.activo ?? false,
    limite: cr?.limite ? centavosATexto(cr.limite) : '',
    dias: String(cr?.dias ?? 30),
    bonificacion: cr?.bonificacionProntoPago ? String(cr.bonificacionProntoPago / 100) : '',
    diasProntoPago: String(cr?.diasProntoPago ?? 8)
  });
  const limite = pesosACentavos(credito.limite || '0');
  const bonificacion = Math.round(Number(credito.bonificacion || 0) * 100);
  const errorCredito = credito.activo && (Number.isNaN(limite) || limite <= 0)
    ? 'Indica el límite de crédito'
    : Number.isNaN(bonificacion) || bonificacion < 0 || bonificacion > 2000 ? 'La bonificación va de 0 a 20 %' : null;
  const [guardando, setGuardando] = useState(false);

  const guardar = async e => {
    e.preventDefault();
    setGuardando(true);
    try {
      const cuerpo = {
        ...f, nombre: f.nombre.trim(), rfc: f.rfc.trim().toUpperCase(), telefono: f.telefono.trim(), email: f.email.trim(),
        credito: {
          activo: credito.activo, limite: Number.isNaN(limite) ? 0 : limite, dias: Number(credito.dias) || 30,
          bonificacionProntoPago: bonificacion, diasProntoPago: Number(credito.diasProntoPago) || 0
        }
      };
      if (cliente) await clientesAPI.actualizar(cliente.id, cuerpo);
      else await clientesAPI.crear(cuerpo);
      toast.success('Cliente guardado');
      alGuardar();
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo guardar el cliente'));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true">
      <form onSubmit={guardar} className="bg-white rounded-xl shadow-lg w-full max-w-lg p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{cliente ? cliente.nombre : 'Nuevo cliente'}</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500"><X /></button>
        </div>
        <fieldset disabled={guardando} className="grid grid-cols-2 gap-3">
          <label className="col-span-2 block text-sm"><span className="font-medium">Nombre</span>
            <input className={campo} value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} required maxLength={120} /></label>
          <label className="block text-sm"><span className="font-medium">Tipo</span>
            <select className={campo} value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })}>{TIPOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
          <label className="block text-sm"><span className="font-medium">Lista de precios</span>
            <select className={campo} value={f.listaPrecios} onChange={e => setF({ ...f, listaPrecios: e.target.value })}>{LISTAS_PRECIO.map(l => <option key={l.clave} value={l.clave}>{l.nombre}</option>)}</select></label>
          <label className="block text-sm"><span className="font-medium">RFC</span>
            <input className={campo} value={f.rfc} onChange={e => setF({ ...f, rfc: e.target.value })} maxLength={13} /></label>
          <label className="block text-sm"><span className="font-medium">Teléfono</span>
            <input className={campo} value={f.telefono} onChange={e => setF({ ...f, telefono: e.target.value })} maxLength={20} /></label>
          <label className="col-span-2 block text-sm"><span className="font-medium">Correo</span>
            <input type="email" className={campo} value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></label>
          <div className="col-span-2 rounded-lg border border-slate-200 p-3 grid grid-cols-2 gap-3">
            <label className="col-span-2 flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={credito.activo} onChange={e => setCredito({ ...credito, activo: e.target.checked })} /> Tiene crédito</label>
            {credito.activo && (
              <>
                <label className="block text-sm"><span className="font-medium">Límite de crédito</span>
                  <input className={campo} inputMode="decimal" placeholder="$0.00" value={credito.limite} onChange={e => setCredito({ ...credito, limite: e.target.value })} /></label>
                <label className="block text-sm"><span className="font-medium">Plazo (días)</span>
                  <input className={campo} type="number" min={1} max={180} value={credito.dias} onChange={e => setCredito({ ...credito, dias: e.target.value })} /></label>
                <label className="block text-sm"><span className="font-medium">Bonificación pronto pago (%)</span>
                  <input className={campo} inputMode="decimal" placeholder="0" value={credito.bonificacion} onChange={e => setCredito({ ...credito, bonificacion: e.target.value })} /></label>
                <label className="block text-sm"><span className="font-medium">Si paga dentro de (días)</span>
                  <input className={campo} type="number" min={0} max={60} value={credito.diasProntoPago} onChange={e => setCredito({ ...credito, diasProntoPago: e.target.value })} /></label>
              </>
            )}
            {errorCredito && <p role="alert" className="col-span-2 text-sm text-red-700">{errorCredito}</p>}
          </div>
          {cliente && <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.activo} onChange={e => setF({ ...f, activo: e.target.checked })} /> Activo</label>}
        </fieldset>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Cancelar</button>
          <button type="submit" disabled={guardando || Boolean(errorCredito)} className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">Guardar</button>
        </div>
      </form>
    </div>
  );
}

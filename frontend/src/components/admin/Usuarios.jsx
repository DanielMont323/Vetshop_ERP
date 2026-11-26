import { useCallback, useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { mensajeDeError, sucursalesAPI, usuariosAPI } from '../../services/api';
import { useDialogo } from '../../contexts/DialogoContext';

const ROLES = [['cajero', 'Cajero'], ['almacen', 'Almacén'], ['medico_responsable', 'Médico responsable'], ['dueno', 'Dueño']];
const nombreRol = r => ROLES.find(x => x[0] === r)?.[1] || r;
const campo = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2';

// Usuarios: alta, edición (rol, sucursales, activo) y restablecer contraseña. Solo el dueño.
export default function Usuarios() {
  const { pedirTexto } = useDialogo();
  const [usuarios, setUsuarios] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [editando, setEditando] = useState(null); // null | 'nuevo' | usuario

  const cargar = useCallback(async () => {
    try {
      const [u, s] = await Promise.all([usuariosAPI.listar({ incluirInactivos: true }), sucursalesAPI.listar()]);
      setUsuarios(u.data.datos);
      setSucursales(s.data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudieron cargar los usuarios'));
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const nombreSucursal = id => sucursales.find(s => s.id === String(id))?.nombre || '—';

  const restablecer = async u => {
    const nueva = await pedirTexto(`Contraseña nueva para ${u.nombre} (mínimo 8 caracteres). Cerrará sus sesiones abiertas.`, { minimo: 8, maximo: 128, secreto: true, textoAceptar: 'Restablecer' });
    if (!nueva) return;
    try {
      await usuariosAPI.restablecerPassword(u.id, nueva);
      toast.success('Contraseña restablecida y cuenta desbloqueada');
      cargar();
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo restablecer'));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" onClick={() => setEditando('nuevo')} className="flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-3 py-2 hover:bg-emerald-700"><Plus size={18} /> Nuevo usuario</button>
      </div>
      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr><th className="px-3 py-2">Nombre</th><th className="px-3 py-2">Usuario</th><th className="px-3 py-2">Rol</th><th className="px-3 py-2">Sucursales</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {usuarios.map(u => (
              <tr key={u.id} className={`border-t border-slate-100 ${u.activo ? '' : 'text-slate-400'}`}>
                <td className="px-3 py-2">{u.nombre}</td>
                <td className="px-3 py-2 font-mono">{u.usuario}</td>
                <td className="px-3 py-2">{nombreRol(u.rol)}</td>
                <td className="px-3 py-2">{u.rol === 'dueno' ? 'Todas' : u.sucursales.map(nombreSucursal).join(', ')}</td>
                <td className="px-3 py-2">
                  {!u.activo ? 'Inactivo' : u.bloqueadoHasta && new Date(u.bloqueadoHasta) > new Date() ? <span className="text-red-700">Bloqueado</span> : 'Activo'}
                </td>
                <td className="px-3 py-2 flex gap-3 justify-end">
                  <button type="button" onClick={() => setEditando(u)} className="text-xs underline">Editar</button>
                  <button type="button" onClick={() => restablecer(u)} className="text-xs underline">Contraseña</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editando && <FormularioUsuario usuario={editando === 'nuevo' ? null : editando} sucursales={sucursales} alCerrar={() => setEditando(null)} alGuardar={() => { setEditando(null); cargar(); }} />}
    </div>
  );
}

function FormularioUsuario({ usuario, sucursales, alCerrar, alGuardar }) {
  const [f, setF] = useState({
    nombre: usuario?.nombre || '',
    usuario: usuario?.usuario || '',
    password: '',
    rol: usuario?.rol || 'cajero',
    sucursales: (usuario?.sucursales || []).map(String),
    pin: '',
    activo: usuario?.activo ?? true
  });
  const [guardando, setGuardando] = useState(false);
  const usaPin = ['dueno', 'medico_responsable'].includes(f.rol);

  const guardar = async e => {
    e.preventDefault();
    setGuardando(true);
    try {
      const sucs = f.rol === 'dueno' ? [] : f.sucursales;
      if (usuario) {
        await usuariosAPI.actualizar(usuario.id, { nombre: f.nombre.trim(), rol: f.rol, sucursales: sucs, activo: f.activo });
      } else {
        await usuariosAPI.crear({ nombre: f.nombre.trim(), usuario: f.usuario.trim(), password: f.password, rol: f.rol, sucursales: sucs, ...(usaPin && f.pin && { pin: f.pin }) });
      }
      toast.success(usuario ? 'Usuario actualizado' : 'Usuario creado');
      alGuardar();
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo guardar el usuario'));
    } finally {
      setGuardando(false);
    }
  };

  const alternar = id => setF(x => ({ ...x, sucursales: x.sucursales.includes(id) ? x.sucursales.filter(s => s !== id) : [...x.sucursales, id] }));

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true">
      <form onSubmit={guardar} className="bg-white rounded-xl shadow-lg w-full max-w-lg p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{usuario ? `Editar ${usuario.nombre}` : 'Nuevo usuario'}</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500"><X /></button>
        </div>
        <fieldset disabled={guardando} className="space-y-3">
          <label className="block text-sm"><span className="font-medium">Nombre</span>
            <input className={campo} value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} required maxLength={80} /></label>
          {!usuario && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm"><span className="font-medium">Usuario (para entrar)</span>
                <input className={campo} value={f.usuario} onChange={e => setF({ ...f, usuario: e.target.value.toLowerCase() })} required pattern="[a-z0-9._\-]{3,30}" title="3 a 30 letras, números, punto o guion" /></label>
              <label className="block text-sm"><span className="font-medium">Contraseña inicial</span>
                <input type="password" className={campo} value={f.password} onChange={e => setF({ ...f, password: e.target.value })} required minLength={8} autoComplete="new-password" /></label>
            </div>
          )}
          <label className="block text-sm"><span className="font-medium">Rol</span>
            <select className={campo} value={f.rol} onChange={e => setF({ ...f, rol: e.target.value })}>
              {ROLES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select></label>
          {f.rol !== 'dueno' && (
            <div className="text-sm"><span className="font-medium">Sucursales</span>
              <div className="mt-1 flex flex-wrap gap-3">
                {sucursales.map(s => (
                  <label key={s.id} className="flex items-center gap-1"><input type="checkbox" checked={f.sucursales.includes(s.id)} onChange={() => alternar(s.id)} /> {s.nombre}</label>
                ))}
              </div>
            </div>
          )}
          {!usuario && usaPin && (
            <label className="block text-sm"><span className="font-medium">PIN de autorización (4 a 6 dígitos, opcional)</span>
              <input type="password" inputMode="numeric" className={campo} value={f.pin} onChange={e => setF({ ...f, pin: e.target.value })} pattern="\d{4,6}" autoComplete="off" /></label>
          )}
          {usuario && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.activo} onChange={e => setF({ ...f, activo: e.target.checked })} /> Activo (desactivarlo cierra sus sesiones)</label>
          )}
        </fieldset>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Cancelar</button>
          <button type="submit" disabled={guardando} className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">Guardar</button>
        </div>
      </form>
    </div>
  );
}

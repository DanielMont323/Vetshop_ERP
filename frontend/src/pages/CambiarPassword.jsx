import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { authAPI, mensajeDeError } from '../services/api';

const MIN = 8;
const campo = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500';

export default function CambiarPassword() {
  const { reemplazarToken } = useAuth();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async evento => {
    evento.preventDefault();
    if (nueva.length < MIN) return toast.error(`La contraseña nueva debe tener al menos ${MIN} caracteres`);
    if (nueva !== confirmacion) return toast.error('La confirmación no coincide');
    setEnviando(true);
    try {
      const res = await authAPI.cambiarPassword({ actual, nueva });
      reemplazarToken(res.data.datos.token);
      setActual('');
      setNueva('');
      setConfirmacion('');
      toast.success('Contraseña actualizada. Se cerraron tus otras sesiones.');
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo cambiar la contraseña'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <section className="max-w-md">
      <h2 className="text-lg font-semibold mb-4">Cambiar contraseña</h2>
      <form onSubmit={enviar} className="bg-white rounded-xl shadow p-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Contraseña actual</span>
          <input type="password" className={campo} value={actual} onChange={e => setActual(e.target.value)} autoComplete="current-password" required />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Contraseña nueva (mínimo {MIN} caracteres)</span>
          <input type="password" className={campo} value={nueva} onChange={e => setNueva(e.target.value)} autoComplete="new-password" required />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Repite la contraseña nueva</span>
          <input type="password" className={campo} value={confirmacion} onChange={e => setConfirmacion(e.target.value)} autoComplete="new-password" required />
        </label>
        <button type="submit" disabled={enviando} className="rounded-lg bg-emerald-600 text-white font-medium px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">
          {enviando ? 'Guardando…' : 'Guardar'}
        </button>
      </form>
    </section>
  );
}

// PIN de autorización propio (solo dueño y médico responsable): se confirma con la contraseña
export function MiPin() {
  const { usuario } = useAuth();
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [enviando, setEnviando] = useState(false);
  if (!['dueno', 'medico_responsable'].includes(usuario?.rol)) return null;

  const enviar = async e => {
    e.preventDefault();
    if (!/^\d{4,6}$/.test(pin)) return toast.error('El PIN debe tener de 4 a 6 dígitos');
    setEnviando(true);
    try {
      await authAPI.establecerPin({ password, pin });
      toast.success('PIN actualizado');
      setPassword('');
      setPin('');
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo cambiar el PIN'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <section className="max-w-md mt-8">
      <h2 className="text-lg font-semibold mb-1">Mi PIN de autorización</h2>
      <p className="text-sm text-slate-600 mb-4">Con él autorizas {usuario.rol === 'dueno' ? 'descuentos, cancelaciones, ajustes, retiros y diferencias de corte' : 'la validación de recetas'}.</p>
      <form onSubmit={enviar} className="bg-white rounded-xl shadow p-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Tu contraseña</span>
          <input type="password" className={campo} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <label className="block">
          <span className="text-sm font-medium">PIN nuevo (4 a 6 dígitos)</span>
          <input type="password" inputMode="numeric" className={campo} value={pin} onChange={e => setPin(e.target.value)} autoComplete="off" required />
        </label>
        <button type="submit" disabled={enviando} className="rounded-lg bg-emerald-600 text-white font-medium px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">Guardar PIN</button>
      </form>
    </section>
  );
}

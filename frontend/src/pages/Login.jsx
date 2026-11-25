import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { PawPrint } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { mensajeDeError } from '../services/api';

export default function Login() {
  const { usuario, iniciarSesion } = useAuth();
  const navegar = useNavigate();
  const [nombreUsuario, setNombreUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  if (usuario) return <Navigate to="/" replace />;

  const enviar = async evento => {
    evento.preventDefault();
    setError('');
    setEnviando(true);
    try {
      await iniciarSesion(nombreUsuario, password);
      navegar('/', { replace: true });
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo iniciar sesión'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <main className="min-h-screen grid place-items-center p-4">
      <form onSubmit={enviar} className="w-full max-w-sm bg-white rounded-xl shadow p-6 space-y-4">
        <div className="flex items-center gap-2 text-emerald-700">
          <PawPrint aria-hidden="true" />
          <h1 className="text-xl font-semibold">Huellitas Vetshop</h1>
        </div>
        <label className="block">
          <span className="text-sm font-medium">Usuario</span>
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            value={nombreUsuario}
            onChange={e => setNombreUsuario(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Contraseña</span>
          <input
            type="password"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded-lg bg-emerald-600 text-white font-medium py-2 hover:bg-emerald-700 disabled:opacity-60"
        >
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}

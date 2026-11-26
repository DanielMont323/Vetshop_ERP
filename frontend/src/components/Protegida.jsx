import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

// Pantalla que exige ALGUNO de los permisos indicados. Si se entra por la dirección sin tenerlo, avisa en lugar
// de mostrar errores de la API. (El servidor siempre vuelve a revisar los permisos.)
export default function Protegida({ permisos, children }) {
  const { puede } = useAuth();
  if (permisos.some(p => puede(p))) return children;
  return (
    <section className="max-w-md mx-auto mt-16 bg-white rounded-xl shadow p-6 text-center space-y-3">
      <Lock className="mx-auto text-slate-400" aria-hidden="true" />
      <h2 className="font-semibold">No tienes acceso a esta pantalla</h2>
      <p className="text-sm text-slate-600">Si la necesitas para tu trabajo, pídele al dueño que revise tu rol.</p>
      <Link to="/" className="inline-block text-emerald-700 underline">Ir al inicio</Link>
    </section>
  );
}

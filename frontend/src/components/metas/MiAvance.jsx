import { useEffect, useState } from 'react';
import { metasAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import BarraAvance from './BarraAvance';

// Avance del mes del propio usuario (pantalla de inicio de quien cobra). Solo aparece si tiene meta.
export default function MiAvance() {
  const { sucursalActiva } = useAuth();
  const [datos, setDatos] = useState(null);

  useEffect(() => {
    metasAPI.miAvance().then(r => setDatos(r.data.datos)).catch(() => setDatos(null));
  }, [sucursalActiva]);

  if (!datos?.meta) return null;
  return (
    <div className="mt-4 max-w-md bg-white rounded-xl shadow p-4 space-y-2">
      <h3 className="font-semibold">Mi meta del mes</h3>
      <BarraAvance vendido={datos.vendido} meta={datos.meta} proyeccion={datos.proyeccion} etiqueta="" />
      <p className="text-xs text-slate-500">{datos.tickets} venta{datos.tickets === 1 ? '' : 's'} en el mes</p>
    </div>
  );
}

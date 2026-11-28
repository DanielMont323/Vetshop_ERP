import { useState } from 'react';
import Usuarios from '../components/admin/Usuarios';
import Sucursales from '../components/admin/Sucursales';
import Clientes from '../components/admin/Clientes';
import ConfiguracionCaja from '../components/admin/ConfiguracionCaja';
import MarcasNotas from '../components/admin/MarcasNotas';

const PESTANAS = [['usuarios', 'Usuarios', Usuarios], ['sucursales', 'Sucursales', Sucursales], ['clientes', 'Clientes', Clientes], ['caja', 'Caja', ConfiguracionCaja], ['notas', 'Notas y tickets', MarcasNotas]];

// Administración (dueño): usuarios, sucursales, clientes y configuración de la caja.
export default function Administracion() {
  const [pestana, setPestana] = useState('usuarios');
  const Contenido = PESTANAS.find(p => p[0] === pestana)[2];
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Administración</h2>
      <div className="flex gap-2" role="tablist">
        {PESTANAS.map(([v, t]) => (
          <button key={v} type="button" role="tab" aria-selected={pestana === v} onClick={() => setPestana(v)}
            className={`rounded-lg px-3 py-1.5 text-sm border ${pestana === v ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-slate-300'}`}>{t}</button>
        ))}
      </div>
      <Contenido />
    </section>
  );
}

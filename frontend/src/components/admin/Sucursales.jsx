import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { mensajeDeError, sucursalesAPI } from '../../services/api';

// Sucursales: alta, renombrar y activar/desactivar. Solo el dueño.
export default function Sucursales() {
  const { recargarPerfil } = useAuth();
  const [lista, setLista] = useState([]);
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState('tienda');

  const cargar = useCallback(async () => {
    try {
      setLista((await sucursalesAPI.listar({ incluirInactivas: true })).data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudieron cargar las sucursales'));
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const despues = async mensaje => {
    toast.success(mensaje);
    await cargar();
    await recargarPerfil().catch(() => {});
  };

  const crear = async e => {
    e.preventDefault();
    try {
      await sucursalesAPI.crear({ nombre: nombre.trim(), tipo });
      setNombre('');
      await despues('Sucursal creada');
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo crear'));
    }
  };

  const cambiar = async (s, cambios, mensaje) => {
    try {
      await sucursalesAPI.actualizar(s.id, cambios);
      await despues(mensaje);
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo actualizar'));
    }
  };

  const renombrar = s => {
    const nuevo = window.prompt('Nuevo nombre de la sucursal', s.nombre);
    if (nuevo && nuevo.trim() !== s.nombre) cambiar(s, { nombre: nuevo.trim() }, 'Sucursal renombrada');
  };

  return (
    <div className="space-y-3">
      <form onSubmit={crear} className="bg-white rounded-xl shadow p-4 flex flex-wrap gap-2 items-end">
        <label className="text-sm flex-1 min-w-48"><span className="font-medium">Nueva sucursal</span>
          <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre" required maxLength={80} /></label>
        <label className="text-sm"><span className="font-medium">Tipo</span>
          <select className="mt-1 block rounded-lg border border-slate-300 px-3 py-2" value={tipo} onChange={e => setTipo(e.target.value)}>
            <option value="tienda">Tienda</option><option value="almacen">Almacén</option>
          </select></label>
        <button type="submit" className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700">Crear</button>
      </form>
      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr><th className="px-3 py-2">Nombre</th><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2" /></tr></thead>
          <tbody>
            {lista.map(s => (
              <tr key={s.id} className={`border-t border-slate-100 ${s.activa ? '' : 'text-slate-400'}`}>
                <td className="px-3 py-2">{s.nombre}</td>
                <td className="px-3 py-2">{s.tipo === 'almacen' ? 'Almacén' : 'Tienda'}</td>
                <td className="px-3 py-2">{s.activa ? 'Activa' : 'Inactiva'}</td>
                <td className="px-3 py-2 flex gap-3 justify-end">
                  <button type="button" onClick={() => renombrar(s)} className="text-xs underline">Renombrar</button>
                  <button type="button" onClick={() => cambiar(s, { activa: !s.activa }, s.activa ? 'Sucursal desactivada' : 'Sucursal activada')} className="text-xs underline">{s.activa ? 'Desactivar' : 'Activar'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

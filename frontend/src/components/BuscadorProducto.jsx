import { useEffect, useRef, useState } from 'react';
import { ScanBarcode } from 'lucide-react';
import toast from 'react-hot-toast';
import { mensajeDeError, productosAPI } from '../services/api';

// Campo para agregar un producto: con el lector (código + Enter) o escribiendo parte del nombre.
export default function BuscadorProducto({ alElegir, placeholder = 'Escanea o escribe el producto' }) {
  const [texto, setTexto] = useState('');
  const [opciones, setOpciones] = useState([]);
  const entrada = useRef(null);

  useEffect(() => {
    const q = texto.trim();
    if (q.length < 2) return setOpciones([]);
    const t = setTimeout(() => {
      productosAPI.buscar({ q, activo: true, limite: 8 }).then(r => setOpciones(r.data.datos)).catch(() => setOpciones([]));
    }, 250);
    return () => clearTimeout(t);
  }, [texto]);

  const elegir = producto => {
    alElegir(producto);
    setTexto('');
    setOpciones([]);
    entrada.current?.focus();
  };

  // Enter: código exacto (lector); si no existe, la primera coincidencia por nombre
  const alTeclear = async e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = texto.trim();
    if (!q) return;
    try {
      const r = await productosAPI.porCodigo(q);
      elegir(r.data.datos);
    } catch (error) {
      if (error.response?.status === 404 && opciones.length > 0) elegir(opciones[0]);
      else toast.error(mensajeDeError(error, 'Producto no encontrado'));
    }
  };

  return (
    <div className="relative">
      <ScanBarcode size={16} className="absolute left-3 top-3 text-slate-400" aria-hidden="true" />
      <input
        ref={entrada}
        className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2"
        placeholder={placeholder}
        aria-label="Buscar producto"
        value={texto}
        onChange={e => setTexto(e.target.value)}
        onKeyDown={alTeclear}
      />
      {opciones.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full bg-white rounded-lg shadow-lg border border-slate-200 max-h-64 overflow-y-auto" role="listbox">
          {opciones.map(p => (
            <li key={p.id}>
              <button type="button" onClick={() => elegir(p)} className="w-full text-left px-3 py-2 hover:bg-emerald-50 text-sm">
                {p.nombre} <span className="font-mono text-xs text-slate-500">{p.sku}</span>
                {p.unidad === 'kg' && <span className="text-xs text-slate-500"> · por kg</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { configuracionAPI, mensajeDeError } from '../../services/api';

const campo = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
const MAX_BYTES = 280 * 1024;
const MARCAS = [
  ['negocio', 'Notas para clientes con negocio', 'Clínicas, veterinarias, petshops y estéticas'],
  ['mostrador', 'Ventas de mostrador', 'Público en general, clientes de público y empleados']
];

// Lee un archivo de imagen como data URL (PNG, JPG o WEBP, máx. ≈ 280 KB)
function leerImagen(archivo) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(archivo.type)) return reject(new Error('Usa una imagen PNG, JPG o WEBP'));
    if (archivo.size > MAX_BYTES) return reject(new Error('La imagen pesa más de 280 KB: redúcela un poco'));
    const lector = new FileReader();
    lector.onload = () => resolve(lector.result);
    lector.onerror = () => reject(new Error('No se pudo leer la imagen'));
    lector.readAsDataURL(archivo);
  });
}

// Administración → Notas y tickets: datos y logo de cada marca, y logos de las marcas al pie de la nota.
export default function MarcasNotas() {
  const [datos, setDatos] = useState(null);
  const [form, setForm] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const aplicar = d => {
    setDatos(d);
    setForm(Object.fromEntries(MARCAS.map(([k]) => [k, { nombre: d[k].nombre, lema: d[k].lema, rfc: d[k].rfc, direccion: d[k].direccion, telefono: d[k].telefono }])));
  };
  useEffect(() => {
    configuracionAPI.marcas().then(r => aplicar(r.data.datos)).catch(e => toast.error(mensajeDeError(e, 'No se pudieron cargar las marcas')));
  }, []);

  const cambiar = (marca, k, v) => setForm(f => ({ ...f, [marca]: { ...f[marca], [k]: v } }));

  const guardar = async e => {
    e.preventDefault();
    setGuardando(true);
    try {
      aplicar((await configuracionAPI.actualizarMarcas(form)).data.datos);
      toast.success('Datos de las notas guardados');
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo guardar'));
    } finally {
      setGuardando(false);
    }
  };

  const subirLogo = async (clave, archivo) => {
    if (!archivo) return;
    try {
      const imagen = await leerImagen(archivo);
      setDatos((await configuracionAPI.guardarLogo(clave, imagen)).data.datos);
      toast.success('Logo guardado');
    } catch (err) {
      toast.error(mensajeDeError(err, err.message || 'No se pudo subir el logo'));
    }
  };
  const quitarLogo = async clave => {
    try {
      setDatos((await configuracionAPI.quitarLogo(clave)).data.datos);
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo quitar'));
    }
  };
  const siguientePie = () => Array.from({ length: 8 }, (_, i) => `pie-${i}`).find(c => !datos.pie.some(p => p.clave === c));

  if (!datos || !form) return <p className="text-slate-500">Cargando…</p>;
  return (
    <form onSubmit={guardar} className="space-y-4 max-w-4xl">
      <p className="text-sm text-slate-600">La nota (hoja carta) y el ticket salen con la marca que corresponde al cliente de la venta. El comprobante de abono también.</p>
      <div className="grid md:grid-cols-2 gap-4">
        {MARCAS.map(([k, titulo, quienes]) => (
          <fieldset key={k} disabled={guardando} className="bg-white rounded-xl shadow p-4 space-y-3">
            <div>
              <h3 className="font-semibold">{titulo}</h3>
              <p className="text-xs text-slate-500">{quienes}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-20 w-32 grid place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 overflow-hidden">
                {datos[k].logo ? <img src={datos[k].logo} alt={`Logo de ${form[k].nombre}`} className="max-h-full max-w-full" /> : <span className="text-xs text-slate-400">Sin logo</span>}
              </div>
              <label className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm cursor-pointer hover:bg-slate-50">
                <ImagePlus size={16} /> {datos[k].logo ? 'Cambiar logo' : 'Subir logo'}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={e => { subirLogo(k, e.target.files[0]); e.target.value = ''; }} />
              </label>
              {datos[k].logo && <button type="button" onClick={() => quitarLogo(k)} className="text-xs text-slate-500 underline">Quitar</button>}
            </div>
            <label className="block text-sm"><span className="font-medium">Nombre</span>
              <input className={campo} value={form[k].nombre} onChange={e => cambiar(k, 'nombre', e.target.value)} maxLength={80} required /></label>
            <label className="block text-sm"><span className="font-medium">Lema</span>
              <input className={campo} value={form[k].lema} onChange={e => cambiar(k, 'lema', e.target.value)} maxLength={120} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm"><span className="font-medium">RFC</span>
                <input className={campo} value={form[k].rfc} onChange={e => cambiar(k, 'rfc', e.target.value.toUpperCase())} maxLength={13} /></label>
              <label className="block text-sm"><span className="font-medium">Teléfono</span>
                <input className={campo} value={form[k].telefono} onChange={e => cambiar(k, 'telefono', e.target.value)} maxLength={30} /></label>
            </div>
            <label className="block text-sm"><span className="font-medium">Dirección (una línea por renglón)</span>
              <textarea className={campo} rows={3} value={form[k].direccion} onChange={e => cambiar(k, 'direccion', e.target.value)} maxLength={300} placeholder={'Calle y número\nColonia\nCiudad, Estado'} /></label>
          </fieldset>
        ))}
      </div>
      <div className="bg-white rounded-xl shadow p-4 space-y-3">
        <div>
          <h3 className="font-semibold">Logos al pie de la nota</h3>
          <p className="text-xs text-slate-500">Las marcas que manejan (Vetoquinol, MSD, Zoetis…). Hasta 8.</p>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          {datos.pie.map(p => (
            <div key={p.clave} className="relative h-14 w-28 grid place-items-center rounded-lg border border-slate-200 bg-white p-1">
              <img src={p.imagen} alt="Logo al pie" className="max-h-full max-w-full" />
              <button type="button" onClick={() => quitarLogo(p.clave)} aria-label="Quitar logo" className="absolute -top-2 -right-2 rounded-full bg-white border border-slate-300 p-0.5 text-slate-500"><X size={12} /></button>
            </div>
          ))}
          {datos.pie.length < 8 && (
            <label className="flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm cursor-pointer hover:bg-slate-50">
              <ImagePlus size={16} /> Agregar logo
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={e => { subirLogo(siguientePie(), e.target.files[0]); e.target.value = ''; }} />
            </label>
          )}
        </div>
      </div>
      <button type="submit" disabled={guardando} className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">Guardar datos</button>
    </form>
  );
}

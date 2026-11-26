import { useState } from 'react';
import toast from 'react-hot-toast';
import { inventarioAPI, mensajeDeError } from '../services/api';
import { NOMBRES_ALERTA, NOMBRES_MOTIVO, cantidadABase, formatearCantidad, formatearFecha, pesosACentavos } from '../utils/formato';

const MOTIVOS = { entrada: ['conteo_fisico', 'inventario_inicial', 'otro'], salida: ['merma', 'caducado', 'danado', 'cadena_frio', 'conteo_fisico', 'uso_interno', 'otro'] };
const campo = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500';

// Ajuste de inventario de un producto en la sucursal activa. Siempre con usuario y PIN del dueño.
export default function AjusteFormulario({ producto, lotes, tiposPermitidos, alTerminar, alCancelar }) {
  const [tipo, setTipo] = useState(tiposPermitidos[0]);
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState(MOTIVOS[tiposPermitidos[0]][0]);
  const [nota, setNota] = useState('');
  const [lote, setLote] = useState('');
  const [caducidad, setCaducidad] = useState('');
  const [costo, setCosto] = useState('');
  const [capa, setCapa] = useState(''); // '' = FEFO
  const [autorizador, setAutorizador] = useState('');
  const [pin, setPin] = useState('');
  const [enviando, setEnviando] = useState(false);

  const unidad = producto.unidad === 'kg' ? 'kg' : 'piezas';

  const cambiarTipo = nuevo => {
    setTipo(nuevo);
    setMotivo(MOTIVOS[nuevo][0]);
  };

  const enviar = async evento => {
    evento.preventDefault();
    const base = cantidadABase(cantidad, producto.unidad);
    if (!base || Number.isNaN(base)) return toast.error(`Cantidad inválida (${producto.unidad === 'kg' ? 'kg con hasta 3 decimales' : 'piezas enteras'})`);
    const cuerpo = { tipo, producto: producto.id, cantidad: base, motivo, nota: nota.trim() || undefined, autorizacion: { usuario: autorizador.trim(), pin } };
    if (tipo === 'entrada') {
      const centavos = pesosACentavos(costo);
      if (centavos === null || Number.isNaN(centavos)) return toast.error('Costo unitario inválido');
      Object.assign(cuerpo, { costoUnitario: centavos, lote: lote.trim() || undefined, caducidad: caducidad.trim() || undefined });
    } else if (capa) {
      cuerpo.capa = capa;
    }
    setEnviando(true);
    try {
      const res = await inventarioAPI.ajustar(cuerpo);
      toast.success(`Ajuste registrado (autorizó ${res.data.datos.autorizadoPor})`);
      alTerminar();
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo registrar el ajuste'));
      setPin('');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="border-t border-slate-200 pt-4 space-y-4">
      <h3 className="font-semibold">Ajuste de inventario</h3>
      <fieldset disabled={enviando} className="grid sm:grid-cols-3 gap-4">
        <label className="block">
          <span className="text-sm font-medium">Tipo</span>
          <select className={campo} value={tipo} onChange={e => cambiarTipo(e.target.value)}>
            {tiposPermitidos.map(t => <option key={t} value={t}>{t === 'entrada' ? 'Entrada (+)' : 'Salida (−)'}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium">Cantidad ({unidad})</span>
          <input className={campo} inputMode="decimal" value={cantidad} onChange={e => setCantidad(e.target.value)} required />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Motivo</span>
          <select className={campo} value={motivo} onChange={e => setMotivo(e.target.value)}>
            {MOTIVOS[tipo].map(m => <option key={m} value={m}>{NOMBRES_MOTIVO[m]}</option>)}
          </select>
        </label>

        {tipo === 'entrada' ? (
          <>
            <label className="block">
              <span className="text-sm font-medium">Lote</span>
              <input className={campo} value={lote} onChange={e => setLote(e.target.value)} maxLength={40} />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Caducidad (MM/AAAA o DD/MM/AAAA)</span>
              <input className={campo} value={caducidad} onChange={e => setCaducidad(e.target.value)} placeholder="03/2027" />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Costo unitario ({producto.unidad === 'kg' ? 'por kg' : 'por pieza'})</span>
              <input className={campo} inputMode="decimal" value={costo} onChange={e => setCosto(e.target.value)} placeholder="$0.00" required />
            </label>
          </>
        ) : (
          <label className="block sm:col-span-3">
            <span className="text-sm font-medium">¿De qué lote?</span>
            <select className={campo} value={capa} onChange={e => setCapa(e.target.value)}>
              <option value="">El que caduca primero (lo vigente)</option>
              {lotes.map(l => (
                <option key={l.id} value={l.id}>
                  {l.lote || 'Sin lote'} · cad. {formatearFecha(l.caducidad)} · {formatearCantidad(l.cantidad, producto.unidad)} · {NOMBRES_ALERTA[l.estado].texto}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block sm:col-span-3">
          <span className="text-sm font-medium">Nota</span>
          <input className={campo} value={nota} onChange={e => setNota(e.target.value)} maxLength={300} placeholder="Qué pasó (opcional)" />
        </label>

        <div className="sm:col-span-3 rounded-lg bg-amber-50 p-3 grid sm:grid-cols-2 gap-3">
          <p className="sm:col-span-2 text-sm text-amber-900">Autorización del dueño</p>
          <label className="block">
            <span className="text-sm">Usuario del dueño</span>
            <input className={campo} value={autorizador} onChange={e => setAutorizador(e.target.value)} autoComplete="off" required />
          </label>
          <label className="block">
            <span className="text-sm">PIN</span>
            <input className={campo} type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value)} autoComplete="off" required />
          </label>
        </div>
      </fieldset>
      <div className="flex justify-end gap-3">
        <button type="button" onClick={alCancelar} className="rounded-lg border border-slate-300 px-4 py-2">Cancelar</button>
        <button type="submit" disabled={enviando} className="rounded-lg bg-emerald-600 text-white font-medium px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">
          {enviando ? 'Registrando…' : 'Registrar ajuste'}
        </button>
      </div>
    </form>
  );
}

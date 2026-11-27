import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { configuracionAPI, mensajeDeError } from '../../services/api';
import { centavosATexto, formatearDinero, pesosACentavos } from '../../utils/formato';
import { porcentajeAPuntosBase } from '../../utils/caja';

// Administración → Caja (dueño): conceptos de gasto de caja, tope de gastos sin PIN por turno y motivos de descuento.
export default function ConfiguracionCaja() {
  const [conceptos, setConceptos] = useState([]);
  const [nuevo, setNuevo] = useState('');
  const [tope, setTope] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [motivos, setMotivos] = useState([]);
  const [lealtad, setLealtad] = useState(null);

  useEffect(() => {
    configuracionAPI.obtener().then(r => {
      setConceptos(r.data.datos.caja.conceptosGasto);
      setTope(centavosATexto(r.data.datos.caja.topeGastoSinPin));
      setMotivos(r.data.datos.descuentos.motivos.map(m => ({ ...m, maximo: String(m.maximo / 100) })));
      setLealtad({ ...r.data.datos.lealtad, valorPunto: centavosATexto(r.data.datos.lealtad.valorPunto) });
    }).catch(e => toast.error(mensajeDeError(e, 'No se pudo cargar la configuración')));
  }, []);

  const agregar = () => {
    const c = nuevo.trim();
    if (!c) return;
    if (conceptos.some(x => x.toLowerCase() === c.toLowerCase())) return toast.error('Ese concepto ya está');
    setConceptos([...conceptos, c]);
    setNuevo('');
  };

  const guardar = async e => {
    e.preventDefault();
    const centavos = pesosACentavos(tope || '0');
    if (Number.isNaN(centavos)) return toast.error('Tope en pesos, máximo 2 decimales');
    const listaMotivos = [];
    for (const m of motivos) {
      const maximo = porcentajeAPuntosBase(m.maximo);
      if (!m.nombre.trim()) return toast.error('Cada motivo necesita nombre');
      if (!maximo || Number.isNaN(maximo)) return toast.error(`«${m.nombre}»: el máximo va de 0.01 a 100 %`);
      listaMotivos.push({ nombre: m.nombre.trim(), maximo, requierePin: m.requierePin });
    }
    if (!listaMotivos.length) return toast.error('Deja al menos un motivo de descuento');
    const valorPunto = pesosACentavos(lealtad?.valorPunto);
    if (lealtad && (!valorPunto || Number.isNaN(valorPunto))) return toast.error('Valor del punto: en pesos, por ejemplo 0.10');
    setGuardando(true);
    try {
      await configuracionAPI.actualizar({ caja: { conceptosGasto: conceptos, topeGastoSinPin: centavos }, descuentos: { motivos: listaMotivos }, ...(lealtad && { lealtad: { activa: lealtad.activa, valorPunto } }) });
      toast.success('Configuración guardada');
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo guardar'));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <form onSubmit={guardar} className="bg-white rounded-xl shadow p-4 space-y-4 max-w-xl">
      <div>
        <h3 className="font-semibold">Gastos de caja</h3>
        <p className="text-sm text-slate-600">Conceptos que el cajero elige con un botón (mandadito, garrafón…). Los gastos salen del efectivo y aparecen en el corte.</p>
      </div>
      <ul className="flex flex-wrap gap-2">
        {conceptos.map(c => (
          <li key={c} className="flex items-center gap-1 rounded-full border border-slate-300 pl-3 pr-1 py-1 text-sm">
            {c}
            <button type="button" onClick={() => setConceptos(conceptos.filter(x => x !== c))} aria-label={`Quitar ${c}`} className="text-slate-500 p-0.5" disabled={conceptos.length === 1}><X size={14} /></button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Nuevo concepto" value={nuevo} onChange={e => setNuevo(e.target.value)} maxLength={40} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), agregar())} />
        <button type="button" onClick={agregar} className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"><Plus size={16} /> Agregar</button>
      </div>
      <label className="block text-sm"><span className="font-medium">Tope de gastos sin PIN por turno</span>
        <input className="mt-1 w-40 rounded-lg border border-slate-300 px-3 py-2 text-right tabular-nums" inputMode="decimal" value={tope} onChange={e => setTope(e.target.value)} />
        <span className="block text-xs text-slate-500 mt-1">Arriba de este monto, cada gasto pide tu usuario y PIN. Con $0, todos lo piden.</span></label>
      <div className="border-t border-slate-100 pt-4">
        <h3 className="font-semibold">Motivos de descuento</h3>
        <p className="text-sm text-slate-600">En la caja, el cajero elige el motivo de cada descuento (botones 5, 10 y 15 %). Cada motivo tiene un máximo y puede pedir o no tu PIN. Un descuento sin motivo siempre pide PIN.</p>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500"><tr><th className="py-1">Motivo</th><th className="py-1 w-24">Máximo %</th><th className="py-1 w-24">Pide PIN</th><th className="w-8" /></tr></thead>
        <tbody>
          {motivos.map((m, i) => (
            <tr key={i}>
              <td className="py-1 pr-2"><input className="w-full rounded border border-slate-300 px-2 py-1" aria-label="Nombre del motivo" value={m.nombre} maxLength={40} onChange={e => setMotivos(motivos.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))} /></td>
              <td className="py-1 pr-2"><input className="w-full rounded border border-slate-300 px-2 py-1 text-right" inputMode="decimal" aria-label={`Máximo de ${m.nombre}`} value={m.maximo} onChange={e => setMotivos(motivos.map((x, j) => (j === i ? { ...x, maximo: e.target.value } : x)))} /></td>
              <td className="py-1 text-center"><input type="checkbox" aria-label={`${m.nombre} pide PIN`} checked={m.requierePin} onChange={e => setMotivos(motivos.map((x, j) => (j === i ? { ...x, requierePin: e.target.checked } : x)))} /></td>
              <td className="py-1"><button type="button" onClick={() => setMotivos(motivos.filter((_, j) => j !== i))} aria-label={`Quitar ${m.nombre}`} className="text-slate-500" disabled={motivos.length === 1}><X size={14} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {motivos.length < 20 && <button type="button" onClick={() => setMotivos([...motivos, { nombre: '', maximo: '10', requierePin: true }])} className="text-sm text-emerald-700 underline">+ Agregar motivo</button>}
      {lealtad && (
        <div className="border-t border-slate-100 pt-4 space-y-3">
          <div>
            <h3 className="font-semibold">Programa de lealtad</h3>
            <p className="text-sm text-slate-600">
              Solo clientes registrados de público. Costales premium: {lealtad.premiosCostal.map(p => `el ${p.numero}.º lleva ${p.porcentaje / 100} %`).join(', ')}; después vuelve a empezar.
              Puntos por compra: {lealtad.escalones.map(e => (e.hasta === null ? `más → ${e.porcentaje / 100} %` : `hasta ${formatearDinero(e.hasta)} → ${e.porcentaje / 100} %`)).join(', ')} (en pesos de puntos).
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={lealtad.activa} onChange={e => setLealtad({ ...lealtad, activa: e.target.checked })} /> Programa activo</label>
          <label className="block text-sm"><span className="font-medium">Valor de cada punto</span>
            <input className="mt-1 w-32 rounded-lg border border-slate-300 px-3 py-2 text-right tabular-nums" inputMode="decimal" value={lealtad.valorPunto} onChange={e => setLealtad({ ...lealtad, valorPunto: e.target.value })} />
            <span className="block text-xs text-slate-500 mt-1">Con $0.10, una compra de $400 da 20 puntos = $2.00.</span></label>
        </div>
      )}
      <button type="submit" disabled={guardando} className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">Guardar</button>
    </form>
  );
}

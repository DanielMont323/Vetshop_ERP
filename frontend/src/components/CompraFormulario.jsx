import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import { comprasAPI, mensajeDeError, proveedoresAPI } from '../services/api';
import {
  NOMBRES_ESTADO_COMPRA, baseATexto, cantidadABase, centavosATexto, diaLocalDe, formatearDinero,
  formatearFecha, hoyLocal, pesosACentavos
} from '../utils/formato';
import BuscadorProducto from './BuscadorProducto';
import PartidasCompra from './PartidasCompra';

const campo = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500';
const TASAS = { tasa_16: 1600, tasa_0: 0, exento: 0 };
let siguienteClave = 0;

// Vista previa (el servidor recalcula y manda): half-up con enteros
const dividir = (n, d) => Math.floor(n / d) + ((n % d) * 2 >= d ? 1 : 0);
function importeDe(p) {
  const cantidad = cantidadABase(p.cantidad, p.unidad);
  const costo = pesosACentavos(p.costo);
  if (!cantidad || Number.isNaN(cantidad) || costo === null || Number.isNaN(costo)) return null;
  return p.unidad === 'kg' ? dividir(costo * cantidad, 1000) : costo * cantidad;
}

const filaDesdeCompra = p => ({
  clave: (siguienteClave += 1),
  producto: p.producto, sku: p.sku, nombre: p.nombre, unidad: p.unidad, tasaIva: p.tasaIva,
  cantidad: baseATexto(p.cantidad, p.unidad), costo: centavosATexto(p.costoUnitario), lote: p.lote || '',
  caducidad: p.caducidad ? formatearFecha(p.caducidad) : '', temperatura: p.temperaturaLlegada ?? '', fueraDeRango: p.fueraDeRango
});

export default function CompraFormulario({ compra, alCerrar, alGuardar }) {
  const editable = !compra || compra.estado === 'borrador';
  const [proveedores, setProveedores] = useState([]);
  const [cab, setCab] = useState({
    proveedor: compra?.proveedor.id || '',
    folioFactura: compra?.folioFactura || '',
    fechaFactura: compra ? diaLocalDe(compra.fechaFactura) : hoyLocal(),
    condicionPago: compra?.condicionPago || 'contado',
    diasCredito: compra ? String(compra.diasCredito) : '',
    observaciones: compra?.observaciones || ''
  });
  const [partidas, setPartidas] = useState(() => (compra?.partidas || []).map(filaDesdeCompra));
  const [enviando, setEnviando] = useState(false);
  // Id del borrador ya guardado (aunque la confirmación falle, los siguientes intentos lo actualizan)
  const [idCompra, setIdCompra] = useState(compra?.id || null);

  useEffect(() => {
    proveedoresAPI.listar({ activo: true }).then(r => setProveedores(r.data.datos)).catch(() => {});
  }, []);

  const importes = useMemo(() => partidas.map(importeDe), [partidas]);
  const subtotal = importes.reduce((s, x) => s + (x || 0), 0);
  const iva = partidas.reduce((s, p, i) => s + (importes[i] ? dividir(importes[i] * p.tasaIva, 10000) : 0), 0);

  const agregar = producto => setPartidas(lista => [...lista, {
    clave: (siguienteClave += 1), producto: producto.id, sku: producto.sku, nombre: producto.nombre, unidad: producto.unidad,
    tasaIva: TASAS[producto.iva], cantidad: '', costo: '', lote: '', caducidad: '', temperatura: '', fueraDeRango: false
  }]);
  const cambiarPartida = (i, clave, valor) => setPartidas(lista => lista.map((p, j) => (j === i ? { ...p, [clave]: valor } : p)));
  const quitarPartida = i => setPartidas(lista => lista.filter((_, j) => j !== i));

  // Cuerpo para la API o { error }
  function armarCuerpo() {
    if (!cab.proveedor) return { error: 'Elige el proveedor' };
    if (partidas.length === 0) return { error: 'Agrega al menos un producto' };
    const filas = [];
    for (const p of partidas) {
      const cantidad = cantidadABase(p.cantidad, p.unidad);
      const costo = pesosACentavos(p.costo);
      if (!cantidad || Number.isNaN(cantidad)) return { error: `${p.nombre}: cantidad inválida` };
      if (costo === null || Number.isNaN(costo)) return { error: `${p.nombre}: costo inválido` };
      const temperatura = String(p.temperatura).trim() === '' ? undefined : Number(String(p.temperatura).replace(',', '.'));
      if (temperatura !== undefined && Number.isNaN(temperatura)) return { error: `${p.nombre}: temperatura inválida` };
      filas.push({ producto: p.producto, cantidad, costoUnitario: costo, lote: p.lote.trim() || undefined, caducidad: p.caducidad.trim() || undefined, temperaturaLlegada: temperatura });
    }
    const cuerpo = { ...cab, folioFactura: cab.folioFactura.trim(), observaciones: cab.observaciones.trim() || undefined, partidas: filas };
    if (cab.condicionPago === 'credito' && cab.diasCredito !== '') cuerpo.diasCredito = Number(cab.diasCredito);
    else delete cuerpo.diasCredito;
    return { cuerpo };
  }

  const guardar = async confirmar => {
    const { cuerpo, error } = armarCuerpo();
    if (error) return toast.error(error);
    if (confirmar && !window.confirm('Al confirmar, la mercancía entra al inventario y la compra ya no se podrá modificar. ¿Continuar?')) return;
    setEnviando(true);
    try {
      const r = idCompra ? await comprasAPI.actualizar(idCompra, cuerpo) : await comprasAPI.crear(cuerpo);
      setIdCompra(r.data.datos.id);
      if (confirmar) {
        await comprasAPI.confirmar(r.data.datos.id);
        toast.success('Recepción confirmada: la mercancía ya está en el inventario');
      } else {
        toast.success('Borrador guardado');
      }
      alGuardar();
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo guardar la compra'));
    } finally {
      setEnviando(false);
    }
  };

  const cancelarBorrador = async () => {
    const motivo = window.prompt('¿Por qué se cancela este borrador?');
    if (motivo === null) return;
    try {
      await comprasAPI.cancelar(compra.id, motivo);
      toast.success('Borrador cancelado');
      alGuardar();
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo cancelar'));
    }
  };

  const cambiar = (clave, valor) => setCab(c => ({ ...c, [clave]: valor }));
  const estado = compra ? NOMBRES_ESTADO_COMPRA[compra.estado] : NOMBRES_ESTADO_COMPRA.borrador;

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-10" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-6xl max-h-[92vh] overflow-y-auto p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-3">
            {compra ? `Factura ${compra.folioFactura}` : 'Nueva recepción'}
            <span className={`rounded px-2 py-0.5 text-xs ${estado.clase}`}>{estado.texto}</span>
          </h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500 hover:text-slate-800"><X /></button>
        </div>

        <fieldset disabled={!editable || enviando} className="grid sm:grid-cols-6 gap-4">
          <label className="block sm:col-span-2">
            <span className="text-sm font-medium">Proveedor</span>
            <select className={campo} value={cab.proveedor} onChange={e => cambiar('proveedor', e.target.value)} required>
              <option value="">Elige…</option>
              {compra && !proveedores.some(p => p.id === compra.proveedor.id) && <option value={compra.proveedor.id}>{compra.proveedor.nombre}</option>}
              {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Folio factura</span>
            <input className={campo} value={cab.folioFactura} onChange={e => cambiar('folioFactura', e.target.value)} maxLength={40} required />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Fecha factura</span>
            <input type="date" className={campo} value={cab.fechaFactura} max={hoyLocal()} onChange={e => cambiar('fechaFactura', e.target.value)} required />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Pago</span>
            <select className={campo} value={cab.condicionPago} onChange={e => cambiar('condicionPago', e.target.value)}>
              <option value="contado">Contado</option>
              <option value="credito">Crédito</option>
            </select>
          </label>
          {cab.condicionPago === 'credito' && (
            <label className="block">
              <span className="text-sm font-medium">Días de crédito</span>
              <input className={campo} inputMode="numeric" value={cab.diasCredito} onChange={e => cambiar('diasCredito', e.target.value)} placeholder="del proveedor" />
            </label>
          )}
        </fieldset>

        {editable && <BuscadorProducto alElegir={agregar} />}
        <PartidasCompra partidas={partidas} importes={importes} editable={editable && !enviando} alCambiar={cambiarPartida} alQuitar={quitarPartida} />

        <div className="flex flex-wrap items-end justify-between gap-4">
          <label className="block flex-1 min-w-64">
            <span className="text-sm font-medium">Observaciones</span>
            <input className={campo} value={cab.observaciones} onChange={e => cambiar('observaciones', e.target.value)} disabled={!editable} maxLength={500} />
          </label>
          <dl className="text-sm grid grid-cols-2 gap-x-6 tabular-nums">
            <dt className="text-slate-500">Subtotal</dt><dd className="text-right">{formatearDinero(subtotal)}</dd>
            <dt className="text-slate-500">IVA</dt><dd className="text-right">{formatearDinero(iva)}</dd>
            <dt className="font-semibold">Total</dt><dd className="text-right font-semibold">{formatearDinero(subtotal + iva)}</dd>
            {compra?.vencimiento && (<><dt className="text-slate-500">Vence</dt><dd className="text-right">{formatearFecha(compra.vencimiento)}</dd></>)}
          </dl>
        </div>

        <div className="flex flex-wrap justify-end gap-3">
          {compra?.estado === 'borrador' && (
            <button type="button" onClick={cancelarBorrador} className="mr-auto rounded-lg border border-red-300 text-red-700 px-4 py-2 hover:bg-red-50">Cancelar borrador</button>
          )}
          <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-4 py-2">Cerrar</button>
          {editable && (
            <>
              <button type="button" disabled={enviando} onClick={() => guardar(false)} className="rounded-lg border border-emerald-600 text-emerald-700 px-4 py-2 hover:bg-emerald-50 disabled:opacity-60">Guardar borrador</button>
              <button type="button" disabled={enviando} onClick={() => guardar(true)} className="rounded-lg bg-emerald-600 text-white font-medium px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">
                {enviando ? 'Guardando…' : 'Confirmar recepción'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Download, FileText, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { facturasAPI, mensajeDeError } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { formatearDinero, formatearFecha, hoyLocal, pesosACentavos } from '../../utils/formato';
import { nuevaClaveOperacion, imprimirDocumento } from '../../utils/caja';
import { ESTADOS_FACTURA, FORMAS_PAGO, MODALIDADES, MOTIVOS_CANCELACION, TIPOS_CFDI } from '../../utils/sat';

function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: nombre }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Detalle de un CFDI: descargas, nota de crédito, complemento de pago y cancelación.
export default function FacturaDetalle({ id, alCerrar, alCambiar, alAbrir }) {
  const { puede } = useAuth();
  const [f, setF] = useState(null);
  const [accion, setAccion] = useState(null); // 'nota' | 'pago' | 'cancelar'

  const cargar = useCallback(async () => {
    try {
      setF((await facturasAPI.obtener(id)).data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo cargar la factura'));
    }
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (!f) return null;
  const vigente = f.estado === 'timbrada';
  const listo = r => {
    setAccion(null);
    alCambiar();
    if (r?.id && r.id !== f.id) alAbrir(r.id);
    else cargar();
  };

  const xml = async () => {
    try {
      const { data } = await facturasAPI.xml(f.id);
      descargar(data, `${f.folioCompleto}_${f.uuid}.xml`);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo descargar el XML'));
    }
  };
  const ver = () => imprimirDocumento(() => facturasAPI.representacion(f.id), `${f.folioCompleto}.pdf`).catch(e => toast.error(mensajeDeError(e, 'No se pudo abrir')));

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-20" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl p-6 space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{TIPOS_CFDI[f.tipo]} {f.folioCompleto} · {ESTADOS_FACTURA[f.estado]}</h2>
            <p className="text-sm text-slate-600">{MODALIDADES[f.modalidad]}{f.pac === 'simulado' && ' · PAC de prueba (sin validez fiscal)'}</p>
          </div>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-slate-500"><X /></button>
        </div>
        {f.error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{f.error}</p>}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-500">Receptor</dt><dd>{f.receptor.razonSocial}</dd>
          <dt className="text-slate-500">RFC · régimen · CP</dt><dd className="font-mono">{f.receptor.rfc} · {f.receptor.regimen} · {f.receptor.codigoPostal}</dd>
          <dt className="text-slate-500">UUID</dt><dd className="font-mono text-xs break-all">{f.uuid || '—'}</dd>
          <dt className="text-slate-500">Timbrado</dt><dd>{f.fechaTimbrado ? formatearFecha(f.fechaTimbrado, true) : '—'}</dd>
          {f.tipo !== 'P' && (<><dt className="text-slate-500">Forma · método</dt><dd>{f.formaPago} {FORMAS_PAGO[f.formaPago]} · {f.metodoPago}</dd></>)}
          {f.tipo !== 'P' && (<><dt className="text-slate-500">Subtotal · IVA · total</dt><dd className="tabular-nums">{formatearDinero(f.subtotal)} · {formatearDinero(f.iva)} · <b>{formatearDinero(f.total)}</b></dd></>)}
          {f.metodoPago === 'PPD' && f.tipo === 'I' && (<><dt className="text-slate-500">Saldo por pagar</dt><dd className="tabular-nums">{formatearDinero(f.saldo)} ({f.parcialidades} parcialidad(es))</dd></>)}
          {f.acreditado > 0 && (<><dt className="text-slate-500">Notas de crédito</dt><dd className="tabular-nums">{formatearDinero(f.acreditado)}</dd></>)}
          {f.pago && (<><dt className="text-slate-500">Pago</dt><dd>{formatearFecha(f.pago.fecha)} · {FORMAS_PAGO[f.pago.formaPago]} · {formatearDinero(f.pago.monto)}</dd></>)}
          {f.relacionados && (<><dt className="text-slate-500">Relacionado</dt><dd className="font-mono text-xs break-all">{f.relacionados.uuids.join(', ')}</dd></>)}
          {f.cancelacion && (<><dt className="text-slate-500">Cancelación</dt><dd>{MOTIVOS_CANCELACION[f.cancelacion.motivo]} · {formatearFecha(f.cancelacion.fecha, true)}</dd></>)}
          {f.ventasDetalle?.length > 0 && (<><dt className="text-slate-500">Ventas</dt><dd className="font-mono text-xs">{f.ventasDetalle.map(v => v.folio).join(', ')}</dd></>)}
        </dl>

        {f.tipo !== 'P' && f.conceptos.length > 0 && f.conceptos.length <= 50 && (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left"><tr><th className="px-2 py-1">Clave</th><th className="px-2 py-1">Descripción</th><th className="px-2 py-1 text-right">Cantidad</th><th className="px-2 py-1 text-right">Importe</th><th className="px-2 py-1 text-right">IVA</th></tr></thead>
            <tbody>{f.conceptos.map((c, i) => (
              <tr key={i} className="border-t border-slate-100"><td className="px-2 py-1 font-mono">{c.claveSat}/{c.claveUnidad}</td><td className="px-2 py-1">{c.descripcion}{c.noIdentificacion && ` (${c.noIdentificacion})`}</td><td className="px-2 py-1 text-right">{c.cantidad}</td><td className="px-2 py-1 text-right tabular-nums">{formatearDinero(c.importe)}</td><td className="px-2 py-1 text-right tabular-nums">{formatearDinero(c.iva)}</td></tr>
            ))}</tbody>
          </table>
        )}

        {f.uuid && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={ver} className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"><FileText size={16} /> Ver / imprimir</button>
            <button type="button" onClick={xml} className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"><Download size={16} /> XML</button>
            {vigente && f.tipo === 'I' && f.modalidad !== 'global' && <button type="button" onClick={() => setAccion('nota')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Nota de crédito</button>}
            {vigente && f.tipo === 'I' && f.metodoPago === 'PPD' && f.saldo > 0 && <button type="button" onClick={() => setAccion('pago')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Complemento de pago</button>}
            {vigente && puede('facturacion:cancelar') && <button type="button" onClick={() => setAccion('cancelar')} className="ml-auto rounded-lg border border-red-300 text-red-700 px-3 py-1.5 text-sm">Cancelar CFDI</button>}
          </div>
        )}

        {accion === 'nota' && <NotaCredito factura={f} alCerrar={() => setAccion(null)} alEmitir={listo} />}
        {accion === 'pago' && <ComplementoPago factura={f} alCerrar={() => setAccion(null)} alEmitir={listo} />}
        {accion === 'cancelar' && <Cancelar factura={f} alCerrar={() => setAccion(null)} alCancelar={listo} />}
      </div>
    </div>
  );
}

function Caja({ titulo, children, alEnviar, enviando, textoBoton, peligro, alCerrar }) {
  return (
    <form onSubmit={alEnviar} className="rounded-lg border border-slate-200 p-4 space-y-3">
      <p className="font-medium">{titulo}</p>
      <fieldset disabled={enviando} className="space-y-3">{children}</fieldset>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={alCerrar} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Volver</button>
        <button type="submit" disabled={enviando} className={`rounded-lg text-white px-3 py-1.5 text-sm disabled:opacity-60 ${peligro ? 'bg-red-600' : 'bg-emerald-600'}`}>{enviando ? 'Procesando…' : textoBoton}</button>
      </div>
    </form>
  );
}

const campo = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';

function useEnvio(llamada, exito) {
  const [enviando, setEnviando] = useState(false);
  const enviar = async e => {
    e.preventDefault();
    setEnviando(true);
    try {
      const { data } = await llamada();
      toast.success(exito(data.datos));
      return data.datos;
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo completar'), { duration: 8000 });
      return null;
    } finally {
      setEnviando(false);
    }
  };
  return { enviando, enviar };
}

function NotaCredito({ factura, alCerrar, alEmitir }) {
  const [monto, setMonto] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [clave] = useState(nuevaClaveOperacion);
  const { enviando, enviar } = useEnvio(
    () => facturasAPI.notaCredito(factura.id, { claveOperacion: clave, monto: pesosACentavos(monto), descripcion: descripcion.trim() || undefined }),
    d => `Nota de crédito ${d.folioCompleto} timbrada`
  );
  return (
    <Caja titulo={`Nota de crédito (máximo ${formatearDinero(factura.total - factura.acreditado)} con IVA)`} textoBoton="Timbrar nota" enviando={enviando} alCerrar={alCerrar} alEnviar={async e => { const r = await enviar(e); if (r) alEmitir(r); }}>
      <input className={campo} inputMode="decimal" placeholder="Monto con IVA" aria-label="Monto con IVA" value={monto} onChange={e => setMonto(e.target.value)} required />
      <input className={campo} placeholder="Descripción (devolución, descuento, bonificación…)" value={descripcion} onChange={e => setDescripcion(e.target.value)} maxLength={200} />
    </Caja>
  );
}

function ComplementoPago({ factura, alCerrar, alEmitir }) {
  const [monto, setMonto] = useState('');
  const [forma, setForma] = useState('03');
  const [fecha, setFecha] = useState(hoyLocal());
  const [clave] = useState(nuevaClaveOperacion);
  const { enviando, enviar } = useEnvio(
    () => facturasAPI.complementoPago(factura.id, { claveOperacion: clave, monto: pesosACentavos(monto), formaPago: forma, fecha }),
    d => `Complemento ${d.folioCompleto} timbrado`
  );
  return (
    <Caja titulo={`Complemento de pago (saldo ${formatearDinero(factura.saldo)})`} textoBoton="Timbrar complemento" enviando={enviando} alCerrar={alCerrar} alEnviar={async e => { const r = await enviar(e); if (r) alEmitir(r); }}>
      <div className="grid grid-cols-3 gap-2">
        <input className={campo} inputMode="decimal" placeholder="Monto pagado" aria-label="Monto pagado" value={monto} onChange={e => setMonto(e.target.value)} required />
        <select className={campo} aria-label="Forma de pago" value={forma} onChange={e => setForma(e.target.value)}>
          {Object.entries(FORMAS_PAGO).filter(([k]) => k !== '99').map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select>
        <input type="date" className={campo} aria-label="Fecha del pago" value={fecha} max={hoyLocal()} onChange={e => setFecha(e.target.value)} />
      </div>
    </Caja>
  );
}

function Cancelar({ factura, alCerrar, alCancelar }) {
  const [motivo, setMotivo] = useState('02');
  const [sustitucion, setSustitucion] = useState('');
  const [usuario, setUsuario] = useState('');
  const [pin, setPin] = useState('');
  const { enviando, enviar } = useEnvio(
    () => facturasAPI.cancelar(factura.id, { motivo, sustitucion: sustitucion.trim() || undefined, autorizacion: { usuario: usuario.trim(), pin } }),
    () => 'CFDI cancelado'
  );
  return (
    <Caja titulo="Cancelar CFDI ante el SAT" textoBoton="Cancelar CFDI" peligro enviando={enviando} alCerrar={alCerrar} alEnviar={async e => { const r = await enviar(e); if (r) alCancelar(r); else setPin(''); }}>
      <select className={campo} aria-label="Motivo" value={motivo} onChange={e => setMotivo(e.target.value)}>
        {Object.entries(MOTIVOS_CANCELACION).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
      </select>
      {motivo === '01' && <input className={campo} placeholder="UUID de la factura que la sustituye" value={sustitucion} onChange={e => setSustitucion(e.target.value)} required />}
      <p className="text-xs text-slate-500">Las ventas de esta factura quedan libres para volver a facturarse.</p>
      <div className="grid grid-cols-2 gap-2">
        <input className={campo} placeholder="Usuario del dueño" aria-label="Usuario del dueño" value={usuario} onChange={e => setUsuario(e.target.value)} required autoComplete="off" />
        <input className={campo} type="password" inputMode="numeric" placeholder="PIN" aria-label="PIN del dueño" value={pin} onChange={e => setPin(e.target.value)} required autoComplete="off" />
      </div>
    </Caja>
  );
}

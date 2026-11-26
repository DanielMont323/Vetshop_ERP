import { useEffect, useState } from 'react';
import { PawPrint } from 'lucide-react';
import { autofacturaAPI, mensajeDeError } from '../services/api';
import { formatearDinero, pesosACentavos } from '../utils/formato';
import { REGIMENES, USOS_CFDI } from '../utils/sat';

const campo = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2';

function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: nombre }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Página PÚBLICA: el cliente factura su ticket dentro del mes de la compra (sin iniciar sesión).
export default function Autofactura() {
  const [sucursales, setSucursales] = useState([]);
  const [f, setF] = useState({ sucursal: '', folio: '', total: '', rfc: '', razonSocial: '', regimen: '', codigoPostal: '', usoCfdi: 'G03', email: '' });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [hecha, setHecha] = useState(null);

  useEffect(() => {
    autofacturaAPI.sucursales().then(r => {
      setSucursales(r.data.datos);
      if (r.data.datos.length === 1) setF(x => ({ ...x, sucursal: r.data.datos[0].id }));
    }).catch(() => setError('No se pudo conectar. Intenta más tarde.'));
  }, []);

  const cambiar = (k, v) => setF(x => ({ ...x, [k]: v }));
  const enviar = async e => {
    e.preventDefault();
    setError(null);
    const total = pesosACentavos(f.total);
    if (!total || Number.isNaN(total)) return setError('Escribe el total del ticket (por ejemplo 349.00)');
    setEnviando(true);
    try {
      const { data } = await autofacturaAPI.facturar({ ...f, total, rfc: f.rfc.trim().toUpperCase(), razonSocial: f.razonSocial.trim(), email: f.email.trim() || undefined });
      setHecha(data.datos);
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo generar tu factura'));
    } finally {
      setEnviando(false);
    }
  };

  const bajar = async tipo => {
    try {
      const { data } = await autofacturaAPI.documento(hecha.id, tipo, hecha.uuid);
      if (tipo === 'xml') return descargar(data, `${hecha.folio}.xml`);
      const url = URL.createObjectURL(data);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo descargar'));
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 grid place-items-center p-4">
      <div className="bg-white rounded-xl shadow w-full max-w-lg p-6 space-y-4">
        <p className="flex items-center gap-2 text-emerald-700 font-semibold text-lg"><PawPrint size={22} aria-hidden="true" /> Huellitas Vetshop · Facturación</p>
        {hecha ? (
          <div className="space-y-3">
            <p className="text-emerald-800 font-medium">¡Listo! Tu factura {hecha.folio} por {formatearDinero(hecha.total)} quedó a nombre de {hecha.receptor}.</p>
            <p className="text-sm text-slate-600 break-all">Folio fiscal: {hecha.uuid}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => bajar('representacion')} className="rounded-lg bg-emerald-600 text-white px-4 py-2">Ver factura</button>
              <button type="button" onClick={() => bajar('xml')} className="rounded-lg border border-slate-300 px-4 py-2">Descargar XML</button>
            </div>
            <p className="text-xs text-slate-500">Guarda tu XML: es el comprobante fiscal.</p>
          </div>
        ) : (
          <form onSubmit={enviar} className="space-y-3">
            <p className="text-sm text-slate-600">Factura tu compra dentro del mismo mes. Los datos del ticket vienen impresos en él.</p>
            <fieldset disabled={enviando} className="grid grid-cols-2 gap-3">
              <label className="col-span-2 block text-sm"><span className="font-medium">Sucursal</span>
                <select className={campo} value={f.sucursal} onChange={e => cambiar('sucursal', e.target.value)} required>
                  <option value="">Elige…</option>
                  {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select></label>
              <label className="block text-sm"><span className="font-medium">Folio del ticket</span>
                <input className={campo} value={f.folio} onChange={e => cambiar('folio', e.target.value)} placeholder="V-123" required /></label>
              <label className="block text-sm"><span className="font-medium">Total del ticket</span>
                <input className={campo} inputMode="decimal" value={f.total} onChange={e => cambiar('total', e.target.value)} placeholder="$0.00" required /></label>
              <label className="block text-sm"><span className="font-medium">RFC</span>
                <input className={campo} value={f.rfc} onChange={e => cambiar('rfc', e.target.value.toUpperCase())} maxLength={13} required /></label>
              <label className="block text-sm"><span className="font-medium">Código postal fiscal</span>
                <input className={campo} inputMode="numeric" value={f.codigoPostal} onChange={e => cambiar('codigoPostal', e.target.value.replace(/\D/g, '').slice(0, 5))} required /></label>
              <label className="col-span-2 block text-sm"><span className="font-medium">Nombre o razón social (como en tu constancia)</span>
                <input className={campo} value={f.razonSocial} onChange={e => cambiar('razonSocial', e.target.value)} maxLength={254} required /></label>
              <label className="col-span-2 block text-sm"><span className="font-medium">Régimen fiscal</span>
                <select className={campo} value={f.regimen} onChange={e => cambiar('regimen', e.target.value)} required>
                  <option value="">Elige…</option>
                  {Object.entries(REGIMENES).filter(([k]) => k !== '616').map(([k, n]) => <option key={k} value={k}>{k} · {n}</option>)}
                </select></label>
              <label className="block text-sm"><span className="font-medium">Uso del CFDI</span>
                <select className={campo} value={f.usoCfdi} onChange={e => cambiar('usoCfdi', e.target.value)}>
                  {Object.entries(USOS_CFDI).filter(([k]) => k !== 'S01').map(([k, n]) => <option key={k} value={k}>{k} · {n}</option>)}
                </select></label>
              <label className="block text-sm"><span className="font-medium">Correo (opcional)</span>
                <input type="email" className={campo} value={f.email} onChange={e => cambiar('email', e.target.value)} /></label>
            </fieldset>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <button type="submit" disabled={enviando} className="w-full rounded-lg bg-emerald-600 text-white py-3 font-semibold hover:bg-emerald-700 disabled:opacity-60">{enviando ? 'Generando factura…' : 'Generar factura'}</button>
          </form>
        )}
      </div>
    </main>
  );
}

// Adaptador para Facturapi (https://www.facturapi.io), API v2. Clave en FACTURAPI_KEY (de pruebas: sk_test_…).
// Los datos del emisor (RFC, régimen, CSD, lugar de expedición) se configuran en la organización de Facturapi.
//
// IMPORTANTE: construido con la documentación pública de Facturapi; probarlo con una clave de pruebas antes de
// usarlo en producción (ver docs/PENDIENTES.md).
const { ErrorApp } = require('../../helpers/errores');

const BASE = process.env.FACTURAPI_URL || 'https://www.facturapi.io/v2';
const PERIODICIDAD = { '01': 'day', '02': 'week', '03': 'fortnight', '04': 'month' };

function clave() {
  const k = process.env.FACTURAPI_KEY;
  if (!k) throw new ErrorApp(503, 'Falta configurar FACTURAPI_KEY', 'PAC_NO_CONFIGURADO');
  return k;
}

async function llamar(metodo, ruta, cuerpo, { binario = false } = {}) {
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Basic ${Buffer.from(`${clave()}:`).toString('base64')}`, ...(cuerpo && { 'Content-Type': 'application/json' }) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) {
    let mensaje = `${res.status}`;
    try {
      mensaje = (await res.json()).message || mensaje;
    } catch {
      /* respuesta sin JSON */
    }
    throw new ErrorApp(422, `El PAC rechazó el comprobante: ${mensaje}`, 'PAC_RECHAZO');
  }
  return binario ? Buffer.from(await res.arrayBuffer()) : res.json();
}

const receptor = r => ({ legal_name: r.razonSocial, tax_id: r.rfc, tax_system: r.regimen, address: { zip: r.codigoPostal }, ...(r.email && { email: r.email }) });

// Concepto: precio unitario CON IVA (tax_included) a partir de importe + IVA de la partida
const item = c => ({
  quantity: c.cantidad,
  product: {
    description: c.descripcion,
    product_key: c.claveSat,
    unit_key: c.claveUnidad,
    ...(c.noIdentificacion && { sku: c.noIdentificacion }),
    price: Number(((c.importe + c.iva) / 100 / (c.cantidad || 1)).toFixed(6)),
    tax_included: true,
    taxes: c.tasaIva ? [{ type: 'IVA', rate: c.tasaIva / 10000 }] : [{ type: 'IVA', rate: 0 }]
  }
});

function cuerpo(cfdi) {
  const base = { type: cfdi.tipo, customer: receptor(cfdi.receptor), use: cfdi.receptor.usoCfdi, series: cfdi.serie, folio_number: cfdi.folio };
  if (cfdi.tipo === 'P') {
    return {
      ...base,
      complements: [{
        type: 'pago',
        data: [{
          payment_form: cfdi.pago.formaPago,
          date: cfdi.pago.fecha,
          related_documents: cfdi.pago.documentos.map(d => ({
            uuid: d.uuid, amount: d.importePagado / 100, installment: d.parcialidad, last_balance: d.saldoAnterior / 100,
            taxes: [{ base: Number((d.importePagado / 100 / 1.16).toFixed(2)), type: 'IVA', rate: 0.16 }]
          }))
        }]
      }]
    };
  }
  return {
    ...base,
    items: cfdi.conceptos.map(item),
    payment_form: cfdi.formaPago,
    payment_method: cfdi.metodoPago,
    ...(cfdi.global?.periodicidad && { global: { periodicity: PERIODICIDAD[cfdi.global.periodicidad], months: cfdi.global.meses, year: cfdi.global.anio } }),
    ...(cfdi.relacionados?.uuids?.length && { related_documents: [{ relationship: cfdi.relacionados.tipoRelacion, documents: cfdi.relacionados.uuids }] })
  };
}

module.exports = {
  async timbrar(cfdi) {
    const r = await llamar('POST', '/invoices', cuerpo(cfdi));
    const xml = (await llamar('GET', `/invoices/${r.id}/xml`, null, { binario: true })).toString('utf8');
    return { uuid: r.uuid, pacId: r.id, xml, fechaTimbrado: r.stamp?.date ? new Date(r.stamp.date) : new Date() };
  },
  async cancelar(cfdi, { motivo, sustitucion }) {
    const q = new URLSearchParams({ motive: motivo, ...(sustitucion && { substitution: sustitucion }) });
    const r = await llamar('DELETE', `/invoices/${cfdi.pac.id}?${q}`);
    return { aceptada: r.status === 'canceled' || r.cancellation_status === 'accepted' || r.cancellation_status === 'pending' };
  },
  async representacion(cfdi) {
    return { tipo: 'application/pdf', contenido: await llamar('GET', `/invoices/${cfdi.pac.id}/pdf`, null, { binario: true }) };
  }
};

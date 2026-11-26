// PAC SIMULADO: para desarrollo, pruebas y capacitación. Hace las validaciones básicas del SAT (RFC, régimen
// contra tipo de persona, código postal, conceptos) y devuelve un UUID y un XML con la estructura de CFDI 4.0,
// marcado como de PRUEBA (sin sello ni validez fiscal).
const crypto = require('crypto');
const { ErrorApp } = require('../../helpers/errores');
const { regimenValidoPara, RE_CP, RFC_PUBLICO_GENERAL } = require('../../config/sat');

const RE_RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const pesos = c => (c / 100).toFixed(2);
const rechazo = mensaje => new ErrorApp(422, `El PAC rechazó el comprobante: ${mensaje}`, 'PAC_RECHAZO');

function validar(cfdi) {
  const r = cfdi.receptor;
  if (!RE_RFC.test(r.rfc)) throw rechazo('RFC del receptor inválido');
  if (!RE_CP.test(r.codigoPostal)) throw rechazo('código postal del receptor inválido');
  if (!regimenValidoPara(r.rfc, r.regimen)) throw rechazo(`el régimen ${r.regimen} no corresponde al RFC ${r.rfc}`);
  if (r.rfc === RFC_PUBLICO_GENERAL && cfdi.tipo === 'I' && cfdi.modalidad !== 'global') throw rechazo('a público en general solo se emite la factura global');
  if (cfdi.tipo !== 'P' && !cfdi.conceptos?.length) throw rechazo('el comprobante no tiene conceptos');
}

function xmlDe(cfdi, uuid, fecha, emisor) {
  const conceptos = (cfdi.conceptos || [])
    .map(c => `    <cfdi:Concepto ClaveProdServ="${c.claveSat}" ClaveUnidad="${c.claveUnidad}"${c.noIdentificacion ? ` NoIdentificacion="${esc(c.noIdentificacion)}"` : ''} Cantidad="${c.cantidad}" Descripcion="${esc(c.descripcion)}" ValorUnitario="${(c.importe / 100 / (c.cantidad || 1)).toFixed(6)}" Importe="${pesos(c.importe)}" ObjetoImp="02"/>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- CFDI DE PRUEBA generado por el PAC simulado: SIN VALIDEZ FISCAL -->
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="${esc(cfdi.serie)}" Folio="${cfdi.folio}" Fecha="${fecha.toISOString().slice(0, 19)}" TipoDeComprobante="${cfdi.tipo}" Moneda="${cfdi.tipo === 'P' ? 'XXX' : 'MXN'}" SubTotal="${pesos(cfdi.subtotal)}" Total="${pesos(cfdi.total)}"${cfdi.tipo === 'P' ? '' : ` FormaPago="${cfdi.formaPago}" MetodoPago="${cfdi.metodoPago}"`} LugarExpedicion="${emisor.lugarExpedicion}" Exportacion="01">
  <cfdi:Emisor Rfc="${emisor.rfc}" Nombre="${esc(emisor.nombre)}" RegimenFiscal="${emisor.regimen}"/>
  <cfdi:Receptor Rfc="${esc(cfdi.receptor.rfc)}" Nombre="${esc(cfdi.receptor.razonSocial)}" DomicilioFiscalReceptor="${cfdi.receptor.codigoPostal}" RegimenFiscalReceptor="${cfdi.receptor.regimen}" UsoCFDI="${cfdi.receptor.usoCfdi}"/>
  <cfdi:Conceptos>
${conceptos}
  </cfdi:Conceptos>
  <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="${uuid}" FechaTimbrado="${fecha.toISOString().slice(0, 19)}" RfcProvCertif="SIMULADO"/>
</cfdi:Comprobante>
`;
}

module.exports = {
  async timbrar(cfdi, { emisor }) {
    validar(cfdi);
    const uuid = crypto.randomUUID().toUpperCase();
    const fechaTimbrado = new Date();
    return { uuid, pacId: `sim_${uuid.slice(0, 8)}`, xml: xmlDe(cfdi, uuid, fechaTimbrado, emisor), fechaTimbrado };
  },
  async cancelar() {
    return { aceptada: true };
  },
  // El simulado no genera PDF: la representación impresa la arma el sistema en HTML
  async representacion() {
    return null;
  }
};

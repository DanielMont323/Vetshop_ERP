// Proveedor de timbrado (PAC). Todo el sistema llama a esta interfaz; el proveedor se elige con variables de entorno:
//
//   FACTURACION_PAC=simulado   (por defecto) timbra en memoria: UUID y XML de prueba, sin validez fiscal.
//   FACTURACION_PAC=facturapi  usa la API de Facturapi con FACTURAPI_KEY (la clave de PRUEBAS «sk_test_…»
//                              mientras no se cargue el CSD real de Huellitas).
//
// Interfaz:  timbrar(cfdi) → { uuid, pacId, xml, fechaTimbrado }
//            cancelar(cfdi, { motivo, sustitucion }) → { aceptada }
//            representacion(cfdi) → { tipo: 'application/pdf' | 'text/html', contenido: Buffer | string } | null
const simulado = require('./simulado');
const facturapi = require('./facturapi');

const PROVEEDORES = { simulado, facturapi };

function proveedor() {
  const nombre = process.env.FACTURACION_PAC || 'simulado';
  const p = PROVEEDORES[nombre];
  if (!p) throw new Error(`FACTURACION_PAC desconocido: ${nombre}`);
  return { nombre, ...p };
}

// Datos del emisor (Huellitas). En Facturapi se toman de la organización; aquí sirven para el simulado y el PDF.
function emisor() {
  return {
    rfc: process.env.FACTURA_EMISOR_RFC || 'EKU9003173C9', // RFC de pruebas del SAT
    nombre: process.env.FACTURA_EMISOR_NOMBRE || 'HUELLITAS VETSHOP (PRUEBAS)',
    regimen: process.env.FACTURA_EMISOR_REGIMEN || '601',
    lugarExpedicion: process.env.FACTURA_LUGAR_EXPEDICION || '63000' // Tepic
  };
}

module.exports = { proveedor, emisor };

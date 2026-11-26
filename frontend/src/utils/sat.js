// Catálogos del SAT para los formularios (los mismos que valida el servidor en backend/config/sat.js)
export const REGIMENES = {
  601: 'General de Ley Personas Morales',
  603: 'Personas Morales con Fines no Lucrativos',
  605: 'Sueldos y Salarios',
  606: 'Arrendamiento',
  607: 'Enajenación o Adquisición de Bienes',
  608: 'Demás ingresos',
  610: 'Residentes en el Extranjero',
  611: 'Ingresos por Dividendos',
  612: 'Personas Físicas con Actividades Empresariales y Profesionales',
  614: 'Ingresos por intereses',
  615: 'Obtención de premios',
  616: 'Sin obligaciones fiscales',
  620: 'Sociedades Cooperativas de Producción',
  621: 'Incorporación Fiscal',
  622: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras',
  623: 'Opcional para Grupos de Sociedades',
  624: 'Coordinados',
  625: 'Plataformas Tecnológicas',
  626: 'Régimen Simplificado de Confianza'
};

export const USOS_CFDI = {
  G01: 'Adquisición de mercancías',
  G03: 'Gastos en general',
  D01: 'Honorarios médicos y gastos hospitalarios',
  S01: 'Sin efectos fiscales'
};

export const FORMAS_PAGO = { '01': 'Efectivo', '03': 'Transferencia', '04': 'Tarjeta de crédito', '28': 'Tarjeta de débito', '99': 'Por definir' };

export const MOTIVOS_CANCELACION = {
  '01': '01 · Con errores, con relación (se sustituye)',
  '02': '02 · Con errores, sin relación',
  '03': '03 · No se llevó a cabo la operación',
  '04': '04 · Nominativa relacionada en una global'
};

export const TIPOS_CFDI = { I: 'Factura', E: 'Nota de crédito', P: 'Complemento de pago' };
export const MODALIDADES = { cliente: 'A cliente', global: 'Global', autofactura: 'Autofactura', nota_credito: 'Nota de crédito', pago: 'Pago' };
export const ESTADOS_FACTURA = { pendiente: 'Pendiente', timbrada: 'Vigente', error: 'Error', cancelada: 'Cancelada' };

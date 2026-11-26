// Catálogos del SAT que usa la facturación (CFDI 4.0). Solo las claves que aplican a Huellitas.
const REGIMENES = {
  601: 'General de Ley Personas Morales',
  603: 'Personas Morales con Fines no Lucrativos',
  605: 'Sueldos y Salarios e Ingresos Asimilados a Salarios',
  606: 'Arrendamiento',
  607: 'Régimen de Enajenación o Adquisición de Bienes',
  608: 'Demás ingresos',
  610: 'Residentes en el Extranjero sin Establecimiento Permanente en México',
  611: 'Ingresos por Dividendos (socios y accionistas)',
  612: 'Personas Físicas con Actividades Empresariales y Profesionales',
  614: 'Ingresos por intereses',
  615: 'Régimen de los ingresos por obtención de premios',
  616: 'Sin obligaciones fiscales',
  620: 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos',
  621: 'Incorporación Fiscal',
  622: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras',
  623: 'Opcional para Grupos de Sociedades',
  624: 'Coordinados',
  625: 'Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas',
  626: 'Régimen Simplificado de Confianza'
};

const USOS_CFDI = {
  G01: 'Adquisición de mercancías',
  G02: 'Devoluciones, descuentos o bonificaciones',
  G03: 'Gastos en general',
  D01: 'Honorarios médicos, dentales y gastos hospitalarios',
  S01: 'Sin efectos fiscales',
  CP01: 'Pagos'
};

// Formas de pago del SAT (las que usa la caja)
const FORMAS_PAGO = { '01': 'Efectivo', '03': 'Transferencia electrónica de fondos', '04': 'Tarjeta de crédito', '28': 'Tarjeta de débito', '99': 'Por definir' };
const FORMA_POR_METODO = { efectivo: '01', transferencia: '03', tarjeta: '04' };

const MOTIVOS_CANCELACION = {
  '01': 'Comprobante emitido con errores con relación',
  '02': 'Comprobante emitido con errores sin relación',
  '03': 'No se llevó a cabo la operación',
  '04': 'Operación nominativa relacionada en una factura global'
};

const PERIODICIDADES = { dia: '01', semana: '02', quincena: '03', mes: '04' };

const RFC_PUBLICO_GENERAL = 'XAXX010101000';
const CLAVE_SIN_CATALOGO = '01010101'; // «No existe en el catálogo»
const UNIDAD_POR_UNIDAD = { pieza: 'H87', kg: 'KGM' };
const RE_CLAVE_SAT = /^\d{8}$/;
const RE_CLAVE_UNIDAD = /^[A-Z0-9]{2,3}$/;
const RE_CP = /^\d{5}$/;

// Personas morales (RFC de 12) y físicas (13): regímenes que el SAT permite a cada una
const REGIMENES_MORAL = new Set(['601', '603', '610', '620', '622', '623', '624', '626']);
const REGIMENES_FISICA = new Set(['605', '606', '607', '608', '610', '611', '612', '614', '615', '616', '621', '622', '625', '626']);

function regimenValidoPara(rfc, regimen) {
  if (rfc === RFC_PUBLICO_GENERAL) return regimen === '616';
  return rfc.length === 12 ? REGIMENES_MORAL.has(regimen) : REGIMENES_FISICA.has(regimen);
}

module.exports = {
  REGIMENES, USOS_CFDI, FORMAS_PAGO, FORMA_POR_METODO, MOTIVOS_CANCELACION, PERIODICIDADES,
  RFC_PUBLICO_GENERAL, CLAVE_SIN_CATALOGO, UNIDAD_POR_UNIDAD, RE_CLAVE_SAT, RE_CLAVE_UNIDAD, RE_CP, regimenValidoPara
};

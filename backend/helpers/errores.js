// Error de negocio con el estado HTTP que debe recibir el cliente.
// Los servicios lanzan ErrorApp; el middleware de errores lo convierte en respuesta JSON.
class ErrorApp extends Error {
  constructor(status, mensaje, codigo, detalles) {
    super(mensaje);
    this.name = 'ErrorApp';
    this.status = status;
    this.codigo = codigo || codigoPorStatus(status);
    if (detalles !== undefined) this.detalles = detalles;
  }
}

function codigoPorStatus(status) {
  return {
    400: 'SOLICITUD_INVALIDA',
    401: 'NO_AUTENTICADO',
    403: 'SIN_PERMISO',
    404: 'NO_ENCONTRADO',
    409: 'CONFLICTO',
    429: 'DEMASIADOS_INTENTOS'
  }[status] || 'ERROR';
}

const solicitudInvalida = (mensaje, detalles) => new ErrorApp(400, mensaje, 'SOLICITUD_INVALIDA', detalles);
const noAutenticado = (mensaje = 'Inicia sesión para continuar') => new ErrorApp(401, mensaje, 'NO_AUTENTICADO');
const sinPermiso = (mensaje = 'No tienes permiso para esta acción') => new ErrorApp(403, mensaje, 'SIN_PERMISO');
const noEncontrado = (mensaje = 'No encontrado') => new ErrorApp(404, mensaje, 'NO_ENCONTRADO');
const conflicto = (mensaje, codigo = 'CONFLICTO') => new ErrorApp(409, mensaje, codigo);
const demasiadosIntentos = mensaje => new ErrorApp(429, mensaje, 'DEMASIADOS_INTENTOS');

module.exports = { ErrorApp, solicitudInvalida, noAutenticado, sinPermiso, noEncontrado, conflicto, demasiadosIntentos };

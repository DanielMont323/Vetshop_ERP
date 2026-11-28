import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export const CLAVE_TOKEN = 'vetshop.token';
export const CLAVE_SUCURSAL = 'vetshop.sucursal';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  // Sin Cache-Control aquí: el servidor ya responde con no-store, y un encabezado extra
  // obligaría a permitirlo en CORS.
  headers: { 'Content-Type': 'application/json' }
});

// Token y sucursal activa en cada petición. El servidor valida ambos: esto solo los envía.
api.interceptors.request.use(config => {
  const token = localStorage.getItem(CLAVE_TOKEN);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const sucursal = localStorage.getItem(CLAVE_SUCURSAL);
  if (sucursal && !config.headers['X-Sucursal']) config.headers['X-Sucursal'] = sucursal;
  return config;
});

// Un 401 (sesión vencida o contraseña cambiada) manda al login, salvo el del propio login,
// para que se vea el mensaje de "credenciales inválidas".
api.interceptors.response.use(
  respuesta => respuesta,
  error => {
    const esLogin = (error.config?.url || '').includes('/auth/login');
    if (error.response?.status === 401 && !esLogin) {
      localStorage.removeItem(CLAVE_TOKEN);
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Anti doble clic (copiado de estética canina): una petición que crea o modifica datos
// (POST/PUT/PATCH/DELETE) idéntica a otra —mismo método, URL, cuerpo y parámetros— que sigue
// en curso o terminó hace menos de 2 s no se vuelve a mandar: se devuelve el resultado de la primera.
// Si la primera falla, se puede reintentar de inmediato.
const VENTANA_DUPLICADOS_MS = 2000;
const peticionesRecientes = new Map();
const originales = {
  post: api.post.bind(api),
  put: api.put.bind(api),
  patch: api.patch.bind(api),
  delete: api.delete.bind(api)
};
const sinDuplicados = metodo => (url, ...args) => {
  const datos = metodo === 'delete' ? undefined : args[0];
  const config = (metodo === 'delete' ? args[0] : args[1]) || {};
  // Archivos: no se comparan (JSON.stringify de un archivo es {} y dos archivos distintos parecerían iguales)
  if ((typeof FormData !== 'undefined' && datos instanceof FormData) || (typeof Blob !== 'undefined' && datos instanceof Blob)) return originales[metodo](url, ...args);
  let clave;
  try {
    clave = `${metodo} ${url} ${JSON.stringify(datos ?? null)} ${JSON.stringify(config.params ?? null)}`;
  } catch {
    return originales[metodo](url, ...args);
  }
  const previa = peticionesRecientes.get(clave);
  if (previa) return previa;
  const peticion = originales[metodo](url, ...args);
  peticionesRecientes.set(clave, peticion);
  const borrar = () => {
    if (peticionesRecientes.get(clave) === peticion) peticionesRecientes.delete(clave);
  };
  peticion.then(() => setTimeout(borrar, VENTANA_DUPLICADOS_MS), borrar);
  return peticion;
};
api.post = sinDuplicados('post');
api.put = sinDuplicados('put');
api.patch = sinDuplicados('patch');
api.delete = sinDuplicados('delete');

// Mensaje legible de un error de la API
export const mensajeDeError = (error, porDefecto = 'Ocurrió un error') =>
  error?.response?.data?.mensaje || (error?.code === 'ECONNABORTED' ? 'El servidor tardó demasiado' : porDefecto);

export default api;

export const authAPI = {
  login: datos => api.post('/auth/login', datos),
  perfil: () => api.get('/auth/me'),
  cambiarPassword: datos => api.put('/auth/password', datos),
  establecerPin: datos => api.put('/auth/pin', datos)
};

export const usuariosAPI = {
  listar: params => api.get('/usuarios', { params }),
  crear: datos => api.post('/usuarios', datos),
  actualizar: (id, datos) => api.patch(`/usuarios/${id}`, datos),
  restablecerPassword: (id, nueva) => api.put(`/usuarios/${id}/password`, { nueva })
};

export const sucursalesAPI = {
  listar: params => api.get('/sucursales', { params }),
  crear: datos => api.post('/sucursales', datos),
  actualizar: (id, datos) => api.patch(`/sucursales/${id}`, datos)
};

export const productosAPI = {
  buscar: params => api.get('/productos', { params }),
  obtener: id => api.get(`/productos/${id}`),
  porCodigo: codigo => api.get(`/productos/codigo/${encodeURIComponent(codigo)}`),
  crear: datos => api.post('/productos', datos),
  actualizar: (id, datos) => api.patch(`/productos/${id}`, datos)
};

export const listasPreciosAPI = {
  listar: () => api.get('/listas-precios'),
  fijar: (clave, productoId, precio) => api.put(`/listas-precios/${clave}/precios/${productoId}`, { precio }),
  quitar: (clave, productoId) => api.delete(`/listas-precios/${clave}/precios/${productoId}`)
};

export const existenciasAPI = {
  listar: params => api.get('/existencias', { params }),
  lotes: productoId => api.get(`/existencias/${productoId}/lotes`)
};

export const inventarioAPI = {
  movimientos: params => api.get('/inventario/movimientos', { params }),
  ajustar: datos => api.post('/inventario/ajustes', datos)
};

export const proveedoresAPI = {
  listar: params => api.get('/proveedores', { params }),
  crear: datos => api.post('/proveedores', datos),
  actualizar: (id, datos) => api.patch(`/proveedores/${id}`, datos)
};

export const comprasAPI = {
  listar: params => api.get('/compras', { params }),
  obtener: id => api.get(`/compras/${id}`),
  crear: datos => api.post('/compras', datos),
  actualizar: (id, datos) => api.put(`/compras/${id}`, datos),
  confirmar: id => api.post(`/compras/${id}/confirmar`),
  cancelar: (id, motivo) => api.post(`/compras/${id}/cancelar`, { motivo }),
  sugeridas: params => api.get('/compras/sugeridas', { params })
};

export const mascotasAPI = {
  listar: (cliente, todas = false) => api.get('/mascotas', { params: { cliente, ...(todas && { todas: true }) } }),
  crear: datos => api.post('/mascotas', datos),
  actualizar: (id, datos) => api.patch(`/mascotas/${id}`, datos)
};

export const recordatoriosAPI = {
  listar: params => api.get('/recordatorios', { params }),
  crear: datos => api.post('/recordatorios', datos),
  actualizar: (id, datos) => api.patch(`/recordatorios/${id}`, datos),
  avisado: id => api.post(`/recordatorios/${id}/avisado`),
  hecho: id => api.post(`/recordatorios/${id}/hecho`),
  cancelar: id => api.post(`/recordatorios/${id}/cancelar`)
};

export const promocionesAPI = {
  listar: params => api.get('/promociones', { params }),
  crear: datos => api.post('/promociones', datos),
  actualizar: (id, datos) => api.patch(`/promociones/${id}`, datos)
};

export const configuracionAPI = {
  obtener: () => api.get('/configuracion'),
  actualizar: datos => api.put('/configuracion', datos),
  marcas: () => api.get('/configuracion/marcas'),
  actualizarMarcas: datos => api.put('/configuracion/marcas', datos),
  guardarLogo: (clave, imagen) => api.put(`/configuracion/logos/${clave}`, { imagen }),
  quitarLogo: clave => api.delete(`/configuracion/logos/${clave}`)
};

export const clientesAPI = {
  listar: params => api.get('/clientes', { params }),
  rapido: datos => api.post('/clientes/rapido', datos),
  contacto: (id, datos) => api.patch(`/clientes/${id}/contacto`, datos),
  lealtad: id => api.get(`/clientes/${id}/lealtad`),
  crear: datos => api.post('/clientes', datos),
  actualizar: (id, datos) => api.patch(`/clientes/${id}`, datos)
};

export const ventasAPI = {
  cobrar: datos => api.post('/ventas', datos),
  listar: params => api.get('/ventas', { params }),
  obtener: id => api.get(`/ventas/${id}`),
  cancelar: (id, datos) => api.post(`/ventas/${id}/cancelar`, datos),
  ticket: (id, ancho = 80) => api.get(`/ventas/${id}/ticket`, { params: { ancho }, responseType: 'text' }),
  nota: id => api.get(`/ventas/${id}/nota`, { responseType: 'text' }),
  cotizar: datos => api.post('/ventas/cotizar', datos),
  listarEspera: () => api.get('/ventas/espera'),
  guardarEspera: datos => api.post('/ventas/espera', datos),
  eliminarEspera: id => api.delete(`/ventas/espera/${id}`)
};

export const recetasAPI = {
  listar: params => api.get('/recetas', { params }),
  disponibles: producto => api.get('/recetas/disponibles', { params: { producto } }),
  obtener: id => api.get(`/recetas/${id}`),
  crear: datos => api.post('/recetas', datos),
  actualizar: (id, datos) => api.put(`/recetas/${id}`, datos),
  validar: (id, autorizacion) => api.post(`/recetas/${id}/validar`, { autorizacion }),
  cancelar: (id, motivo) => api.post(`/recetas/${id}/cancelar`, { motivo }),
  subirArchivo: (id, archivo) =>
    api.put(`/recetas/${id}/archivo`, archivo, { headers: { 'Content-Type': archivo.type, 'X-Nombre-Archivo': encodeURIComponent(archivo.name) } }),
  archivo: id => api.get(`/recetas/${id}/archivo`, { responseType: 'blob' })
};

export const turnosAPI = {
  actual: () => api.get('/turnos/actual'),
  abrir: datos => api.post('/turnos', datos),
  listar: params => api.get('/turnos', { params }),
  obtener: id => api.get(`/turnos/${id}`),
  retirar: (id, datos) => api.post(`/turnos/${id}/retiros`, datos),
  contar: (id, datos) => api.post(`/turnos/${id}/conteo`, datos),
  cerrar: (id, datos) => api.post(`/turnos/${id}/cerrar`, datos),
  corte: (id, ancho = 80) => api.get(`/turnos/${id}/corte`, { params: { ancho }, responseType: 'text' })
};

ventasAPI.cambiarFormaPago = (id, datos) => api.post(`/ventas/${id}/forma-pago`, datos);

export const traspasosAPI = {
  destinos: () => api.get('/traspasos/destinos'),
  listar: params => api.get('/traspasos', { params }),
  obtener: id => api.get(`/traspasos/${id}`),
  enviar: datos => api.post('/traspasos', datos),
  recibir: (id, datos) => api.post(`/traspasos/${id}/recibir`, datos),
  autorizarDiferencia: (id, datos) => api.post(`/traspasos/${id}/autorizar-diferencia`, datos),
  cancelar: (id, motivo) => api.post(`/traspasos/${id}/cancelar`, { motivo })
};

export const pedidosAPI = {
  listar: params => api.get('/pedidos', { params }),
  obtener: id => api.get(`/pedidos/${id}`),
  crear: datos => api.post('/pedidos', datos),
  actualizar: (id, datos) => api.put(`/pedidos/${id}`, datos),
  enviar: id => api.post(`/pedidos/${id}/enviar`),
  cancelar: (id, motivo) => api.post(`/pedidos/${id}/cancelar`, { motivo }),
  documento: id => api.get(`/pedidos/${id}/documento`, { responseType: 'text' })
};

export const cobranzaAPI = {
  cartera: params => api.get('/cobranza/cartera', { params }),
  carteraExcel: () => api.get('/cobranza/cartera/excel', { responseType: 'blob', timeout: 60000 }),
  estadoCuenta: (clienteId, params) => api.get(`/cobranza/clientes/${clienteId}`, { params }),
  impresion: (clienteId, params) => api.get(`/cobranza/clientes/${clienteId}/impresion`, { params, responseType: 'text' }),
  abonar: datos => api.post('/cobranza/abonos', datos),
  cancelarAbono: (id, datos) => api.post(`/cobranza/abonos/${id}/cancelar`, datos),
  comprobante: (id, ancho = 80) => api.get(`/cobranza/abonos/${id}/comprobante`, { params: { ancho }, responseType: 'text' }),
  detalleAbono: id => api.get(`/cobranza/abonos/${id}/detalle`),
  reintentarComplementos: id => api.post(`/cobranza/abonos/${id}/complementos`)
};

export const cuentasPagarAPI = {
  listar: params => api.get('/cuentas-por-pagar', { params }),
  excel: () => api.get('/cuentas-por-pagar/excel', { responseType: 'blob', timeout: 60000 }),
  pagos: params => api.get('/cuentas-por-pagar/pagos', { params }),
  pagar: datos => api.post('/cuentas-por-pagar/pagos', datos),
  cancelarPago: (id, datos) => api.post(`/cuentas-por-pagar/pagos/${id}/cancelar`, datos)
};

export const conteosAPI = {
  listar: params => api.get('/conteos', { params }),
  obtener: id => api.get(`/conteos/${id}`),
  iniciar: datos => api.post('/conteos', datos),
  capturar: (id, datos) => api.post(`/conteos/${id}/capturas`, datos),
  revision: id => api.post(`/conteos/${id}/revision`),
  recaptura: id => api.post(`/conteos/${id}/recaptura`),
  aplicar: (id, datos) => api.post(`/conteos/${id}/aplicar`, datos),
  cancelar: (id, datos) => api.post(`/conteos/${id}/cancelar`, datos)
};

export const cadenaFrioAPI = {
  equipos: params => api.get('/cadena-frio/equipos', { params }),
  crearEquipo: datos => api.post('/cadena-frio/equipos', datos),
  actualizarEquipo: (id, datos) => api.patch(`/cadena-frio/equipos/${id}`, datos),
  lecturas: params => api.get('/cadena-frio/lecturas', { params }),
  registrar: datos => api.post('/cadena-frio/lecturas', datos),
  bitacora: params => api.get('/cadena-frio/bitacora', { params, responseType: 'text' }),
  bitacoraExcel: params => api.get('/cadena-frio/bitacora.xlsx', { params, responseType: 'blob', timeout: 60000 })
};

export const metasAPI = {
  avance: params => api.get('/metas', { params }),
  fijar: (datos, config) => api.put('/metas', datos, config),
  miAvance: () => api.get('/metas/mi-avance'),
  vendedores: config => api.get('/metas/vendedores', config)
};

export const facturasAPI = {
  listar: params => api.get('/facturas', { params }),
  obtener: id => api.get(`/facturas/${id}`),
  ventasFacturables: params => api.get('/facturas/ventas-facturables', { params }),
  facturar: datos => api.post('/facturas', datos, { timeout: 60000 }),
  global: datos => api.post('/facturas/global', datos, { timeout: 60000 }),
  notaCredito: (id, datos) => api.post(`/facturas/${id}/nota-credito`, datos, { timeout: 60000 }),
  complementoPago: (id, datos) => api.post(`/facturas/${id}/complemento-pago`, datos, { timeout: 60000 }),
  cancelar: (id, datos) => api.post(`/facturas/${id}/cancelar`, datos, { timeout: 60000 }),
  xml: id => api.get(`/facturas/${id}/xml`, { responseType: 'blob' }),
  representacion: id => api.get(`/facturas/${id}/representacion`, { responseType: 'blob', timeout: 60000 })
};

// Pública (sin sesión)
export const autofacturaAPI = {
  sucursales: () => api.get('/autofactura/sucursales'),
  facturar: datos => api.post('/autofactura', datos, { timeout: 60000 }),
  documento: (id, tipo, uuid) => api.get(`/autofactura/${id}/${tipo}`, { params: { uuid }, responseType: 'blob', timeout: 60000 })
};

export const reportesAPI = {
  dashboard: () => api.get('/reportes/dashboard'),
  ventas: params => api.get('/reportes/ventas', { params }),
  excel: params => api.get('/reportes/ventas.xlsx', { params, responseType: 'blob', timeout: 60000 })
};

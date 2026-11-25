// Matriz de permisos por rol. Un permiso es "modulo:accion".
// requirePermiso() rechaza al arrancar cualquier permiso que no esté en PERMISOS (evita erratas).

const ROLES = ['cajero', 'almacen', 'medico_responsable', 'dueno'];

// Roles que tienen PIN de autorización (para descuentos, cancelaciones, recetas…)
const ROLES_CON_PIN = ['dueno', 'medico_responsable'];

const PERMISOS = [
  // Caja / ventas
  'ventas:cobrar',
  'ventas:ver_propias_del_dia',
  'ventas:ver_todas',
  'corte:capturar_conteo',
  // Catálogo (productos y listas de precios)
  'catalogo:ver',
  // Inventario
  'existencias:ver',
  'inventario:entradas',
  'inventario:salidas',
  'recepcion:registrar',
  'traspasos:gestionar',
  'conteo_fisico:capturar',
  // Recetas
  'recetas:validar',
  // Autorizaciones (con PIN del dueño)
  'autorizar:descuento',
  'autorizar:cancelacion',
  'autorizar:ajuste_inventario',
  'autorizar:cambio_forma_pago',
  'autorizar:diferencia_corte',
  // Administración
  'usuarios:gestionar',
  'sucursales:gestionar',
  'catalogo:gestionar',
  'auditoria:ver',
  'reportes:ver'
];

const MATRIZ = {
  cajero: ['ventas:cobrar', 'ventas:ver_propias_del_dia', 'existencias:ver', 'corte:capturar_conteo', 'catalogo:ver'],
  almacen: [
    'inventario:entradas',
    'inventario:salidas',
    'recepcion:registrar',
    'traspasos:gestionar',
    'conteo_fisico:capturar',
    'existencias:ver',
    'catalogo:ver'
  ],
  medico_responsable: ['recetas:validar', 'existencias:ver', 'catalogo:ver'],
  dueno: [...PERMISOS] // todo, incluidas las autorizaciones
};

const permisosPorRol = Object.fromEntries(ROLES.map(rol => [rol, new Set(MATRIZ[rol])]));

function existePermiso(permiso) {
  return PERMISOS.includes(permiso);
}

function tienePermiso(rol, permiso) {
  return Boolean(permisosPorRol[rol]?.has(permiso));
}

function permisosDe(rol) {
  return [...(permisosPorRol[rol] || [])];
}

// Comprobación al cargar: la matriz solo usa permisos declarados
for (const [rol, lista] of Object.entries(MATRIZ)) {
  for (const p of lista) {
    if (!existePermiso(p)) throw new Error(`permisos.js: el rol ${rol} usa el permiso desconocido "${p}"`);
  }
}

module.exports = { ROLES, ROLES_CON_PIN, PERMISOS, MATRIZ, existePermiso, tienePermiso, permisosDe };

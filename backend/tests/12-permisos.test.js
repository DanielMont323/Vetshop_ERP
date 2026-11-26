// Matriz de permisos (config/permisos.js) y middleware requirePermiso.
const { MATRIZ, PERMISOS, ROLES, tienePermiso, permisosDe } = require('../config/permisos');
const { requirePermiso } = require('../middleware/permisos');

test('los 4 roles del plan', () => {
  expect([...ROLES].sort()).toEqual(['almacen', 'cajero', 'dueno', 'medico_responsable']);
});

test('cajero: vender (también a crédito), recibir abonos, ver sus ventas del día, existencias, conteo de corte, catálogo, recetas, temperaturas', () => {
  expect([...MATRIZ.cajero].sort()).toEqual([
    'cadena_frio:capturar', 'catalogo:ver', 'cobranza:registrar_abono', 'corte:capturar_conteo', 'credito:vender', 'existencias:ver',
    'recetas:capturar', 'ventas:cobrar', 'ventas:ver_propias_del_dia'
  ]);
});

test('almacén: entradas/salidas, recepción, traspasos, conteo físico (y ver existencias)', () => {
  for (const p of ['inventario:entradas', 'inventario:salidas', 'recepcion:registrar', 'traspasos:gestionar', 'conteo_fisico:capturar', 'cadena_frio:capturar']) {
    expect(tienePermiso('almacen', p)).toBe(true);
  }
  expect(tienePermiso('almacen', 'ventas:cobrar')).toBe(false);
});

test('médico responsable: recetas, ver existencias y catálogo, registrar temperaturas; nada más', () => {
  expect(permisosDe('medico_responsable').sort()).toEqual(['cadena_frio:capturar', 'catalogo:ver', 'existencias:ver', 'recetas:capturar', 'recetas:validar']);
});

test('dueño: todo, incluidas las autorizaciones', () => {
  for (const p of PERMISOS) expect(tienePermiso('dueno', p)).toBe(true);
  for (const p of ['autorizar:descuento', 'autorizar:cancelacion', 'autorizar:ajuste_inventario', 'autorizar:cambio_forma_pago', 'autorizar:diferencia_corte']) {
    expect(tienePermiso('dueno', p)).toBe(true);
    for (const rol of ['cajero', 'almacen', 'medico_responsable']) expect(tienePermiso(rol, p)).toBe(false);
  }
});

test('catalogo:ver lo tienen los 4 roles; catalogo:gestionar solo el dueño', () => {
  for (const rol of ROLES) expect(tienePermiso(rol, 'catalogo:ver')).toBe(true);
  for (const rol of ['cajero', 'almacen', 'medico_responsable']) expect(tienePermiso(rol, 'catalogo:gestionar')).toBe(false);
});

test('nadie más que el dueño gestiona usuarios y sucursales', () => {
  for (const rol of ['cajero', 'almacen', 'medico_responsable']) {
    expect(tienePermiso(rol, 'usuarios:gestionar')).toBe(false);
    expect(tienePermiso(rol, 'sucursales:gestionar')).toBe(false);
  }
});

test('rol desconocido no tiene permisos', () => {
  expect(tienePermiso('admin', 'ventas:cobrar')).toBe(false);
  expect(permisosDe('admin')).toEqual([]);
});

describe('requirePermiso', () => {
  const ejecutar = (mw, user) => new Promise(resolve => mw({ user }, {}, resolve));

  test('un permiso con errata falla al ARRANCAR, no en producción', () => {
    expect(() => requirePermiso('ventas:cobar')).toThrow(/desconocido/);
    expect(() => requirePermiso()).toThrow();
  });

  test('deja pasar con el permiso; 403 sin él; 401 sin usuario', async () => {
    const mw = requirePermiso('ventas:cobrar');
    expect(await ejecutar(mw, { rol: 'cajero' })).toBeUndefined();
    expect(await ejecutar(mw, { rol: 'almacen' })).toMatchObject({ status: 403 });
    expect(await ejecutar(mw, undefined)).toMatchObject({ status: 401 });
  });

  test('varios permisos: exige todos', async () => {
    const mw = requirePermiso('existencias:ver', 'ventas:cobrar');
    expect(await ejecutar(mw, { rol: 'cajero' })).toBeUndefined();
    expect(await ejecutar(mw, { rol: 'medico_responsable' })).toMatchObject({ status: 403 });
  });
});

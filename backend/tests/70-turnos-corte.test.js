// Turnos y corte de caja: apertura con fondo, ventas ligadas al turno, retiros, corrección de forma
// de pago, corte ciego, cierre con diferencia autorizado, cancelaciones de turnos cerrados, impresión.
const { randomUUID } = require('crypto');
const h = require('./helpers/app');
const Producto = require('../models/Producto');
const Venta = require('../models/Venta');
const Turno = require('../models/Turno');
const inv = require('../services/inventario');
const precios = require('../services/precios');
const { conTransaccion } = require('../helpers/transaccion');
const { Auditoria } = h.modelos;

let A, dueno, cajero, cajero2, cajero3, collar;
const PRECIO = 10000; // $100.00

beforeAll(async () => {
  await h.resetDb();
  A = await h.crearSucursal({ nombre: 'A' });
  dueno = await h.sesion({ rol: 'dueno', pin: '4821' });
  cajero = await h.sesion({ rol: 'cajero', sucursales: [A._id] });
  cajero2 = await h.sesion({ rol: 'cajero', sucursales: [A._id] });
  cajero3 = await h.sesion({ rol: 'cajero', sucursales: [A._id] });
  collar = await Producto.create({ sku: 'COL', nombre: 'Collar', categoria: 'accesorio', unidad: 'pieza', iva: 'tasa_16' });
  await precios.fijarPrecio({ clave: 'publico', productoId: collar._id, precio: PRECIO }, dueno.usuario);
  await conTransaccion(s => inv.registrarEntrada({ sucursal: A._id, producto: collar._id, cantidad: 500, costoUnitario: 5000, origen: 'compra', usuario: dueno.usuario._id }, s));
});
afterAll(h.cerrar);

const api = (s, metodo, ruta) => h.request(h.app)[metodo](ruta).set(h.auth(s.token, A));
const vender = (s, cantidad, pagos) => api(s, 'post', '/api/ventas').send({ claveOperacion: randomUUID(), partidas: [{ producto: String(collar._id), cantidad }], pagos });
const pinDueno = () => ({ usuario: dueno.usuario.usuario, pin: '4821' });
const den = (...pares) => pares.map(([denominacion, cantidad]) => ({ denominacion, cantidad }));

let turno;
const v = {};

describe('apertura', () => {
  test('sin turno no se cobra (409 TURNO_REQUERIDO)', async () => {
    const res = await vender(cajero, 1, [{ metodo: 'efectivo', monto: PRECIO }]);
    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe('TURNO_REQUERIDO');
  });

  test('abrir con el fondo contado por denominación; una caja y un turno por cajero', async () => {
    const res = await api(cajero, 'post', '/api/turnos').send({ caja: 1, denominaciones: den([20000, 2], [10000, 1]) });
    expect(res.status).toBe(201);
    turno = res.body.datos;
    expect(turno).toMatchObject({ estado: 'abierto', caja: 1, apertura: { fondo: 50000 } });
    expect((await api(cajero, 'post', '/api/turnos').send({ caja: 2, fondo: 0 })).body.codigo).toBe('TURNO_YA_ABIERTO');
    expect((await api(cajero2, 'post', '/api/turnos').send({ caja: 1, fondo: 0 })).body.codigo).toBe('CAJA_OCUPADA');
    expect((await api(cajero2, 'post', '/api/turnos').send({ caja: 2, fondo: 0 })).status).toBe(201);
    expect((await api(cajero, 'post', '/api/turnos').send({ denominaciones: den([3000, 1]) })).status).toBe(400);
  });

  test('el cajero ve su turno actual SIN importes esperados (corte ciego)', async () => {
    const res = await api(cajero, 'get', '/api/turnos/actual');
    expect(res.body.datos.id).toBe(turno.id);
    expect(res.body.datos.esperado).toBeUndefined();
  });
});

describe('durante el turno', () => {
  test('las ventas quedan ligadas al turno y a su caja', async () => {
    v.efectivo = (await vender(cajero, 2, [{ metodo: 'efectivo', monto: 30000 }])).body.datos; // cambio 100
    v.tarjeta = (await vender(cajero, 1, [{ metodo: 'tarjeta', monto: PRECIO }])).body.datos;
    v.transferencia = (await vender(cajero, 1, [{ metodo: 'transferencia', monto: PRECIO }])).body.datos;
    v.cancelada = (await vender(cajero, 1, [{ metodo: 'efectivo', monto: PRECIO }])).body.datos;
    expect(v.efectivo).toMatchObject({ turno: turno.id, caja: 1, cambio: 10000 });
    // Cancelar una venta del propio turno abierto: simplemente deja de contar
    const c = await api(cajero, 'post', `/api/ventas/${v.cancelada.id}/cancelar`).send({ motivo: 'Prueba', autorizacion: pinDueno() });
    expect(c.status).toBe(200);
    expect(c.body.datos.cancelacion.turno).toBeUndefined();
  });

  test('retiro de efectivo con PIN del dueño; no más de lo que hay en caja', async () => {
    const retirar = cuerpo => api(cajero, 'post', `/api/turnos/${turno.id}/retiros`).send(cuerpo);
    expect((await retirar({ monto: 5000, motivo: 'Pago de garrafón', autorizacion: { usuario: dueno.usuario.usuario, pin: '0000' } })).status).toBe(401);
    expect((await retirar({ monto: 10000000, motivo: 'Demasiado', autorizacion: pinDueno() })).body.codigo).toBe('EFECTIVO_INSUFICIENTE');
    const ok = await retirar({ monto: 5000, motivo: 'Pago de garrafón', autorizacion: pinDueno() });
    expect(ok.status).toBe(201);
    expect(await Auditoria.countDocuments({ accion: 'turno.retiro', entidadId: turno.id })).toBe(1);
  });

  test('el dueño ve lo esperado en vivo; el cajero no', async () => {
    const delDueno = await api(dueno, 'get', `/api/turnos/${turno.id}`);
    // 500 fondo + 200 efectivo neto − 50 retiro = 650; tarjeta 100; transferencia 100
    expect(delDueno.body.datos.esperado).toEqual({ efectivo: 65000, tarjeta: 10000, transferencia: 10000 });
    expect((await api(cajero, 'get', `/api/turnos/${turno.id}`)).body.datos.esperado).toBeUndefined();
  });

  test('corregir forma de pago (tarjeta → efectivo) con PIN del dueño: historial y bitácora', async () => {
    const ruta = `/api/ventas/${v.tarjeta.id}/forma-pago`;
    expect((await api(cajero, 'post', ruta).send({ pagos: [{ metodo: 'efectivo', monto: PRECIO }], motivo: 'Se capturó mal' })).status).toBe(400);
    expect((await api(cajero, 'post', ruta).send({ pagos: [{ metodo: 'efectivo', monto: 5000 }], motivo: 'Se capturó mal', autorizacion: pinDueno() })).status).toBe(400); // no cubre el total
    const res = await api(cajero, 'post', ruta).send({ pagos: [{ metodo: 'efectivo', monto: PRECIO }], motivo: 'Se capturó mal', autorizacion: pinDueno() });
    expect(res.status).toBe(200);
    expect(res.body.datos.pagos).toEqual([{ metodo: 'efectivo', monto: PRECIO }]);
    expect(res.body.datos.cambiosFormaPago[0]).toMatchObject({ motivo: 'Se capturó mal', antes: [{ metodo: 'tarjeta', monto: PRECIO }] });
    expect(await Auditoria.countDocuments({ accion: 'venta.cambiar_forma_pago', entidadId: v.tarjeta.id })).toBe(1);
    const esperado = (await api(dueno, 'get', `/api/turnos/${turno.id}`)).body.datos.esperado;
    expect(esperado).toEqual({ efectivo: 75000, tarjeta: 0, transferencia: 10000 });
  });
});

describe('corte ciego', () => {
  test('solo el cajero del turno cuenta', async () => {
    const res = await api(cajero2, 'post', `/api/turnos/${turno.id}/conteo`).send({ denominaciones: [], tarjeta: 0, transferencia: 0 });
    expect(res.status).toBe(403);
  });

  test('si todo cuadra el turno se cierra solo; no se puede recontar', async () => {
    const res = await api(cajero, 'post', `/api/turnos/${turno.id}/conteo`).send({
      denominaciones: den([20000, 3], [10000, 1], [5000, 1]), tarjeta: 0, transferencia: 10000
    });
    expect(res.status).toBe(200);
    expect(res.body.datos).toMatchObject({
      estado: 'cerrado',
      conteo: { contado: { efectivo: 75000, tarjeta: 0, transferencia: 10000 }, diferencias: { efectivo: 0, tarjeta: 0, transferencia: 0 }, ventas: 3, canceladas: 1 }
    });
    expect((await api(cajero, 'post', `/api/turnos/${turno.id}/conteo`).send({ denominaciones: [], tarjeta: 0, transferencia: 0 })).body.codigo).toBe('CONTEO_YA_REGISTRADO');
    expect((await api(cajero, 'get', '/api/turnos/actual')).body.datos).toBeNull();
  });

  test('turno cerrado: no se corrige la forma de pago; cancelar exige un turno abierto de quien devuelve', async () => {
    expect((await api(cajero, 'post', `/api/ventas/${v.transferencia.id}/forma-pago`).send({ pagos: [{ metodo: 'efectivo', monto: PRECIO }], motivo: 'x x x', autorizacion: pinDueno() })).body.codigo).toBe('TURNO_NO_ABIERTO');
    const cancelar = () => api(cajero, 'post', `/api/ventas/${v.efectivo.id}/cancelar`).send({ motivo: 'Devolución', autorizacion: pinDueno() });
    expect((await cancelar()).body.codigo).toBe('TURNO_REQUERIDO');

    const nuevo = await h.abrirTurno(cajero, A, { caja: 1, fondo: 50000 });
    const res = await cancelar();
    expect(res.status).toBe(200);
    expect(res.body.datos.cancelacion.turno).toBe(nuevo.id);
    // El dinero de la devolución (200 efectivo neto) sale del turno nuevo
    expect((await api(dueno, 'get', `/api/turnos/${nuevo.id}`)).body.datos.esperado.efectivo).toBe(50000 - 20000);
    // y el turno cerrado no cambia
    expect((await Turno.findOne({ _id: turno.id, sucursal: A._id }).lean()).conteo.esperado.efectivo).toBe(75000);
  });
});

describe('corte con diferencia', () => {
  let t2;
  test('faltante: el turno queda "contado" y ya no se puede vender ni cancelar en él', async () => {
    t2 = (await api(cajero2, 'get', '/api/turnos/actual')).body.datos;
    const venta = (await vender(cajero2, 1, [{ metodo: 'efectivo', monto: PRECIO }])).body.datos;
    const res = await api(cajero2, 'post', `/api/turnos/${t2.id}/conteo`).send({ denominaciones: den([5000, 1], [2000, 2]), tarjeta: 0, transferencia: 0 });
    expect(res.body.datos).toMatchObject({ estado: 'contado', conteo: { diferencias: { efectivo: -1000, tarjeta: 0, transferencia: 0 } } });
    expect((await vender(cajero2, 1, [{ metodo: 'efectivo', monto: PRECIO }])).body.codigo).toBe('TURNO_EN_CORTE');
    expect((await api(cajero2, 'post', `/api/ventas/${venta.id}/cancelar`).send({ motivo: 'x x x', autorizacion: pinDueno() })).body.codigo).toBe('TURNO_EN_CORTE');
  });

  test('cerrar exige justificación y PIN del dueño; queda en bitácora', async () => {
    const cerrar = cuerpo => api(cajero2, 'post', `/api/turnos/${t2.id}/cerrar`).send(cuerpo);
    expect((await cerrar({ justificacion: 'x', autorizacion: pinDueno() })).status).toBe(400);
    expect((await cerrar({ justificacion: 'Se dio cambio de más', autorizacion: { usuario: cajero2.usuario.usuario, pin: '1234' } })).status).toBe(401);
    const res = await cerrar({ justificacion: 'Se dio cambio de más', autorizacion: pinDueno() });
    expect(res.status).toBe(200);
    expect(res.body.datos).toMatchObject({ estado: 'cerrado', cierre: { justificacion: 'Se dio cambio de más', autorizadoPorNombre: dueno.usuario.nombre } });
    expect(await Auditoria.countDocuments({ accion: 'turno.cerrar_con_diferencia', entidadId: t2.id })).toBe(1);
    expect((await cerrar({ justificacion: 'otra vez', autorizacion: pinDueno() })).status).toBe(409);
  });

  test('corte impreso: esperado, contado, diferencia y quién autorizó', async () => {
    const res = await api(cajero2, 'get', `/api/turnos/${t2.id}/corte`);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Falta $10.00');
    expect(res.text).toContain('Se dio cambio de más');
    expect(res.text).toContain(dueno.usuario.nombre);
    const abierto = (await api(cajero, 'get', '/api/turnos/actual')).body.datos;
    expect((await api(cajero, 'get', `/api/turnos/${abierto.id}/corte`)).body.codigo).toBe('TURNO_SIN_CONTEO');
  });
});

test('una venta y el conteo al mismo tiempo nunca se cruzan: lo esperado coincide con las ventas del turno', async () => {
  const t = await h.abrirTurno(cajero3, A, { caja: 3, fondo: 0 });
  await Promise.allSettled([
    vender(cajero3, 1, [{ metodo: 'efectivo', monto: PRECIO }]),
    api(cajero3, 'post', `/api/turnos/${t.id}/conteo`).send({ denominaciones: [], tarjeta: 0, transferencia: 0 })
  ]);
  const final = await Turno.findOne({ _id: t.id, sucursal: A._id }).lean();
  const ventas = await Venta.find({ sucursal: A._id, turno: t.id, estado: 'cobrada' }).lean();
  expect(final.conteo.esperado.efectivo).toBe(ventas.reduce((s, x) => s + x.total, 0));
});

test('listar: el cajero ve sus turnos; el dueño todos, con lo esperado', async () => {
  const mios = await api(cajero, 'get', '/api/turnos');
  expect(mios.body.datos.every(t => t.cajero.id === String(cajero.usuario._id))).toBe(true);
  const todos = await api(dueno, 'get', '/api/turnos');
  expect(new Set(todos.body.datos.map(t => t.cajero.id)).size).toBe(3);
  const abierto = todos.body.datos.find(t => t.estado === 'abierto');
  expect(abierto.esperado).toBeDefined();
});

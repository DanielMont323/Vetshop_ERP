// Crédito y cobranza: configuración del crédito, venta a crédito (límite, vencido, PIN), abonos con
// bonificación por pronto pago, corte de caja, cancelaciones, estado de cuenta, cartera e impresiones.
const { randomUUID } = require('crypto');
const h = require('./helpers/app');
const Producto = require('../models/Producto');
const CargoCliente = require('../models/CargoCliente');
const inv = require('../services/inventario');
const precios = require('../services/precios');
const credito = require('../services/credito');
const { conTransaccion } = require('../helpers/transaccion');
const { diaLocal, finDeDiaTras } = require('../helpers/fechas');
const { Auditoria } = h.modelos;

let A, dueno, cajero, cajero2, collar, turno;
const PRECIO = 10000; // $100.00
const PIN = '4821';

beforeAll(async () => {
  await h.resetDb();
  A = await h.crearSucursal({ nombre: 'A' });
  dueno = await h.sesion({ rol: 'dueno', pin: PIN });
  cajero = await h.sesion({ rol: 'cajero', sucursales: [A._id] });
  cajero2 = await h.sesion({ rol: 'cajero', sucursales: [A._id] });
  collar = await Producto.create({ sku: 'COL', nombre: 'Collar', categoria: 'accesorio', unidad: 'pieza', iva: 'tasa_16' });
  await precios.fijarPrecio({ clave: 'publico', productoId: collar._id, precio: PRECIO }, dueno.usuario);
  await conTransaccion(s => inv.registrarEntrada({ sucursal: A._id, producto: collar._id, cantidad: 500, costoUnitario: 5000, origen: 'compra', usuario: dueno.usuario._id }, s));
  turno = await h.abrirTurno(cajero, A, { fondo: 0 });
});
afterAll(h.cerrar);

const api = (s, metodo, ruta) => h.request(h.app)[metodo](ruta).set(h.auth(s.token, A));
const pinDueno = () => ({ usuario: dueno.usuario.usuario, pin: PIN });
const vender = (s, cliente, cantidad, pagos, extra = {}) =>
  api(s, 'post', '/api/ventas').send({ claveOperacion: randomUUID(), cliente: cliente ? String(cliente.id) : undefined, partidas: [{ producto: String(collar._id), cantidad }], pagos, ...extra });
const abonar = (s, cliente, monto, metodo = 'efectivo', extra = {}) =>
  api(s, 'post', '/api/cobranza/abonos').send({ claveOperacion: randomUUID(), cliente: String(cliente.id), monto, metodo, ...extra });
const estado = async cliente => (await api(dueno, 'get', `/api/cobranza/clientes/${cliente.id}`)).body.datos;
const crearCliente = async (nombre, creditoCfg) => {
  const res = await h.request(h.app).post('/api/clientes').set(h.auth(dueno.token)).send({ nombre, tipo: 'clinica', listaPrecios: 'publico', ...(creditoCfg && { credito: creditoCfg }) });
  expect(res.status).toBe(201);
  return res.body.datos;
};

describe('cálculo del reparto de un abono (puro)', () => {
  const hoy = new Date();
  const manana = new Date(hoy.getTime() + 86400000);
  const cargo = (folio, saldo, extra = {}) => ({ _id: folio, folio, importe: saldo, saldo, bonificado: 0, prontoPago: { tasa: 0 }, ...extra });

  test('paga del primero al último; lo parcial queda parcial', () => {
    expect(credito.repartir(15000, [cargo('V-1', 10000), cargo('V-2', 10000)], hoy)).toEqual([
      { cargo: 'V-1', folio: 'V-1', monto: 10000, bonificacion: 0 },
      { cargo: 'V-2', folio: 'V-2', monto: 5000, bonificacion: 0 }
    ]);
  });

  test('bonificación solo si se liquida completo dentro del plazo', () => {
    const conBonif = cargo('V-1', 10000, { prontoPago: { tasa: 200, fechaLimite: manana } }); // 2 % = $2.00
    expect(credito.repartir(9800, [conBonif], hoy)).toEqual([{ cargo: 'V-1', folio: 'V-1', monto: 9800, bonificacion: 200 }]);
    expect(credito.repartir(5000, [conBonif], hoy)[0].bonificacion).toBe(0); // parcial: sin bonificación
    const vencida = cargo('V-1', 10000, { prontoPago: { tasa: 200, fechaLimite: new Date(hoy.getTime() - 1000) } });
    expect(credito.repartir(10000, [vencida], hoy)[0].bonificacion).toBe(0);
  });

  test('no se acepta más de lo que se debe (409 con el máximo)', () => {
    expect(() => credito.repartir(20001, [cargo('V-1', 20000)], hoy)).toThrow(expect.objectContaining({ codigo: 'ABONO_EXCEDE_SALDO', detalles: { maximo: 20000 } }));
  });
});

describe('configurar el crédito del cliente', () => {
  test('el dueño lo configura; el cajero no; "Público en general" no puede tener crédito', async () => {
    const c = await crearCliente('Clínica Uno');
    expect(c.credito).toEqual({ activo: false, limite: 0, dias: 30, bonificacionProntoPago: 0, diasProntoPago: 8 });
    const res = await h.request(h.app).patch(`/api/clientes/${c.id}`).set(h.auth(dueno.token)).send({ credito: { activo: true, limite: 50000 } });
    expect(res.status).toBe(200);
    expect(res.body.datos.credito).toMatchObject({ activo: true, limite: 50000, dias: 30 });
    expect((await h.request(h.app).patch(`/api/clientes/${c.id}`).set(h.auth(cajero.token)).send({ credito: { limite: 1 } })).status).toBe(403);
    expect((await h.request(h.app).patch(`/api/clientes/${c.id}`).set(h.auth(dueno.token)).send({ credito: { dias: 0 } })).status).toBe(400);

    const lista = await h.request(h.app).get('/api/clientes').set(h.auth(dueno.token));
    const publico = lista.body.datos.find(x => x.esPublicoGeneral);
    expect((await h.request(h.app).patch(`/api/clientes/${publico.id}`).set(h.auth(dueno.token)).send({ credito: { activo: true } })).status).toBe(400);
  });
});

describe('venta a crédito', () => {
  let cliente;
  beforeAll(async () => {
    cliente = await crearCliente('Veterinaria Crédito', { activo: true, limite: 30000, dias: 30 });
  });

  test('sin crédito activo no se vende a crédito; tampoco a "Público en general"', async () => {
    const sin = await crearCliente('Sin Crédito');
    expect((await vender(cajero, sin, 1, [{ metodo: 'credito', monto: PRECIO }])).body.codigo).toBe('SIN_CREDITO');
    expect((await vender(cajero, null, 1, [{ metodo: 'credito', monto: PRECIO }])).body.codigo).toBe('SIN_CREDITO');
  });

  test('dentro del límite: crea el cargo con vencimiento a 30 días y el ticket pide firma', async () => {
    const res = await vender(cajero, cliente, 2, [{ metodo: 'credito', monto: 2 * PRECIO }]);
    expect(res.status).toBe(201);
    expect(res.body.datos.aCredito).toBe(20000);
    const cargo = await CargoCliente.findOne({ venta: res.body.datos.id }).lean();
    expect(cargo).toMatchObject({ importe: 20000, saldo: 20000, estado: 'pendiente', folio: `V-${res.body.datos.folio}` });
    expect(cargo.vencimiento.getTime()).toBe(finDeDiaTras(cargo.fecha, 30).getTime());
    const ticket = await api(cajero, 'get', `/api/ventas/${res.body.datos.id}/ticket`);
    expect(ticket.text).toContain('A crédito');
    expect(ticket.text).toContain('Firma de conformidad');
  });

  test('si rebasa el límite pide PIN del dueño; con PIN se vende y queda en bitácora', async () => {
    const sinPin = await vender(cajero, cliente, 2, [{ metodo: 'credito', monto: 2 * PRECIO }]);
    expect(sinPin.status).toBe(409);
    expect(sinPin.body).toMatchObject({ codigo: 'CREDITO_REQUIERE_AUTORIZACION', detalles: { saldo: 20000, limite: 30000, disponible: 10000 } });
    expect((await vender(cajero, cliente, 2, [{ metodo: 'credito', monto: 2 * PRECIO }], { autorizacionCredito: { usuario: dueno.usuario.usuario, pin: '0000' } })).status).toBe(401);
    const ok = await vender(cajero, cliente, 2, [{ metodo: 'credito', monto: 2 * PRECIO }], { autorizacionCredito: pinDueno() });
    expect(ok.status).toBe(201);
    expect(await Auditoria.exists({ accion: 'venta.credito_excedido', entidadId: ok.body.datos.id })).toBeTruthy();
    expect((await estado(cliente)).resumen).toMatchObject({ saldo: 40000, disponible: 0 });
  });

  test('una venta con parte a crédito no se corrige de forma de pago', async () => {
    const otro = await crearCliente('Petshop Mixto', { activo: true, limite: 100000 });
    const v = (await vender(cajero, otro, 1, [{ metodo: 'credito', monto: PRECIO }])).body.datos;
    const res = await api(cajero, 'post', `/api/ventas/${v.id}/forma-pago`).send({ pagos: [{ metodo: 'efectivo', monto: PRECIO }], motivo: 'Pagó', autorizacion: pinDueno() });
    expect(res.body.codigo).toBe('VENTA_A_CREDITO');
  });
});

describe('abonos y corte', () => {
  let cliente, venta;
  beforeAll(async () => {
    cliente = await crearCliente('Estética Abonos', { activo: true, limite: 100000, bonificacionProntoPago: 200, diasProntoPago: 8 });
  });

  test('venta mixta: el anticipo en efectivo entra al corte, la parte a crédito no', async () => {
    const antes = (await api(dueno, 'get', `/api/turnos/${turno.id}`)).body.datos.esperado;
    const res = await vender(cajero, cliente, 3, [{ metodo: 'efectivo', monto: 10000 }, { metodo: 'credito', monto: 20000 }]);
    expect(res.status).toBe(201);
    venta = res.body.datos;
    const despues = (await api(dueno, 'get', `/api/turnos/${turno.id}`)).body.datos.esperado;
    expect(despues.efectivo - antes.efectivo).toBe(10000);
    expect(despues).not.toHaveProperty('credito');
  });

  test('abono parcial en efectivo: baja el saldo y entra al corte del turno; un reintento no se duplica', async () => {
    const antes = (await api(dueno, 'get', `/api/turnos/${turno.id}`)).body.datos.esperado.efectivo;
    const clave = randomUUID();
    const res = await abonar(cajero, cliente, 5000, 'efectivo', { claveOperacion: clave });
    expect(res.status).toBe(201);
    expect(res.body.datos).toMatchObject({ serie: 'A', folio: 1, monto: 5000, bonificacion: 0, turno: turno.id, aplicaciones: [{ monto: 5000, bonificacion: 0 }] });
    const otraVez = await abonar(cajero, cliente, 5000, 'efectivo', { claveOperacion: clave });
    expect(otraVez.status).toBe(200);
    expect(otraVez.body.repetido).toBe(true);
    expect((await api(dueno, 'get', `/api/turnos/${turno.id}`)).body.datos.esperado.efectivo - antes).toBe(5000);
    const ec = await estado(cliente);
    expect(ec.resumen.saldo).toBe(15000);
    // Ya hubo abono parcial; si liquida dentro del plazo, la bonificación (2 % de 20000 = 400) aún aplica
    expect(ec.pendientes[0]).toMatchObject({ saldo: 15000, bonificacionHoy: 400, paraLiquidar: 14600 });
  });

  test('abono que excede el saldo: 409 con el máximo a pagar', async () => {
    const res = await abonar(cajero, cliente, 15000);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ codigo: 'ABONO_EXCEDE_SALDO', detalles: { maximo: 14600 } });
  });

  test('liquidar dentro del plazo aplica la bonificación por pronto pago (y queda en bitácora)', async () => {
    const res = await abonar(cajero, cliente, 14600, 'tarjeta', { referencia: '1234' });
    expect(res.status).toBe(201);
    expect(res.body.datos).toMatchObject({ monto: 14600, bonificacion: 400 });
    const cargo = await CargoCliente.findOne({ venta: venta.id }).lean();
    expect(cargo).toMatchObject({ estado: 'pagado', saldo: 0, abonado: 19600, bonificado: 400 });
    expect(await Auditoria.exists({ accion: 'credito.bonificacion_pronto_pago', entidadId: res.body.datos.id })).toBeTruthy();
    expect((await abonar(cajero, cliente, 100)).body.codigo).toBe('SIN_SALDO');
  });

  test('sin turno no se reciben abonos en efectivo; por transferencia sí (sin turno)', async () => {
    await vender(cajero, cliente, 1, [{ metodo: 'credito', monto: PRECIO }]);
    expect((await abonar(cajero2, cliente, 1000, 'efectivo')).body.codigo).toBe('TURNO_REQUERIDO');
    const res = await abonar(dueno, cliente, 1000, 'transferencia', { referencia: 'SPEI 99' });
    expect(res.status).toBe(201);
    expect(res.body.datos.turno).toBeNull();
  });

  test('el cajero no ve la cartera; sí el estado de cuenta (para cobrar)', async () => {
    expect((await api(cajero, 'get', '/api/cobranza/cartera')).status).toBe(403);
    expect((await api(cajero, 'get', `/api/cobranza/clientes/${cliente.id}`)).status).toBe(200);
  });
});

describe('cancelaciones', () => {
  let cliente, venta, abono;
  beforeAll(async () => {
    cliente = await crearCliente('Clínica Cancela', { activo: true, limite: 100000 });
    venta = (await vender(cajero, cliente, 2, [{ metodo: 'credito', monto: 2 * PRECIO }])).body.datos;
    abono = (await abonar(cajero, cliente, 5000)).body.datos;
  });

  test('una venta con abonos no se cancela; primero se cancela el abono (PIN), y luego la venta', async () => {
    const cancelarVenta = () => api(cajero, 'post', `/api/ventas/${venta.id}/cancelar`).send({ motivo: 'Error', autorizacion: pinDueno() });
    expect((await cancelarVenta()).body.codigo).toBe('CARGO_CON_ABONOS');

    const antes = (await api(dueno, 'get', `/api/turnos/${turno.id}`)).body.datos.esperado.efectivo;
    const c = await api(cajero, 'post', `/api/cobranza/abonos/${abono.id}/cancelar`).send({ motivo: 'Capturado de más', autorizacion: pinDueno() });
    expect(c.status).toBe(200);
    expect(c.body.datos.estado).toBe('cancelado');
    expect(antes - (await api(dueno, 'get', `/api/turnos/${turno.id}`)).body.datos.esperado.efectivo).toBe(5000);
    expect((await api(cajero, 'post', `/api/cobranza/abonos/${abono.id}/cancelar`).send({ motivo: 'Otra vez', autorizacion: pinDueno() })).body.codigo).toBe('ABONO_CANCELADO');

    expect((await cancelarVenta()).status).toBe(200);
    expect(await CargoCliente.findOne({ venta: venta.id }).lean()).toMatchObject({ estado: 'cancelado', saldo: 0 });
    const ec = await estado(cliente);
    expect(ec.resumen.saldo).toBe(0);
    expect(ec.movimientos.map(m => [m.tipo, m.cancelado, m.saldo])).toEqual([['cargo', true, 0], ['abono', true, 0]]);
  });
});

describe('vencidos, estado de cuenta y cartera', () => {
  let cliente;
  beforeAll(async () => {
    cliente = await crearCliente('Clínica Morosa', { activo: true, limite: 100000 });
    const v1 = (await vender(cajero, cliente, 1, [{ metodo: 'credito', monto: PRECIO }])).body.datos;
    await vender(cajero, cliente, 2, [{ metodo: 'credito', monto: 2 * PRECIO }]);
    // El primer cargo venció hace 40 días
    const hace70 = new Date(Date.now() - 70 * 86400000);
    await CargoCliente.updateOne({ venta: v1.id }, { $set: { fecha: hace70, vencimiento: finDeDiaTras(hace70, 30) } });
  });

  test('con saldo vencido, una venta nueva a crédito pide PIN aunque haya límite', async () => {
    const res = await vender(cajero, cliente, 1, [{ metodo: 'credito', monto: PRECIO }]);
    expect(res.body.codigo).toBe('CREDITO_REQUIERE_AUTORIZACION');
    expect(res.body.mensaje).toContain('vencido');
  });

  test('estado de cuenta: resumen, pendientes del más vencido al más nuevo y saldo acumulado', async () => {
    const ec = await estado(cliente);
    expect(ec.resumen).toMatchObject({ saldo: 30000, vencido: 10000, limite: 100000, disponible: 70000 });
    expect(ec.pendientes.map(c => c.importe)).toEqual([10000, 20000]);
    expect(ec.pendientes[0].diasVencido).toBe(40);
    expect(ec.movimientos.map(m => m.saldo)).toEqual([10000, 30000]);
    // Con periodo: el cargo viejo queda en el saldo inicial
    const hoy = diaLocal();
    const conRango = (await api(dueno, 'get', `/api/cobranza/clientes/${cliente.id}?desde=${hoy}`)).body.datos;
    expect(conRango.saldoInicial).toBe(10000);
    expect(conRango.movimientos).toHaveLength(1);
  });

  test('cartera por antigüedad con totales', async () => {
    const res = await api(dueno, 'get', '/api/cobranza/cartera');
    expect(res.status).toBe(200);
    const fila = res.body.datos.find(f => f.cliente.nombre === 'Clínica Morosa');
    expect(fila).toMatchObject({ saldo: 30000, corriente: 20000, d31_60: 10000, vencido: 10000, cargos: 2 });
    expect(res.body.datos[0].cliente.nombre).toBe('Clínica Morosa'); // los de más vencido primero
    expect(res.body.totales.saldo).toBe(res.body.datos.reduce((s, f) => s + f.saldo, 0));
  });

  test('impresiones: estado de cuenta, comprobante de abono y Excel de cartera', async () => {
    const ec = await api(dueno, 'get', `/api/cobranza/clientes/${cliente.id}/impresion`);
    expect(ec.status).toBe(200);
    expect(ec.headers['content-type']).toContain('text/html');
    expect(ec.text).toContain('Clínica Morosa');
    const abono = (await abonar(cajero, cliente, 1000)).body.datos;
    const comp = await api(cajero, 'get', `/api/cobranza/abonos/${abono.id}/comprobante`);
    expect(comp.text).toContain(`A-${abono.folio}`);
    expect(comp.text).toContain('Saldo pendiente');
    const xls = await api(dueno, 'get', '/api/cobranza/cartera/excel').buffer(true).parse((r, cb) => {
      const partes = [];
      r.on('data', d => partes.push(d));
      r.on('end', () => cb(null, Buffer.concat(partes)));
    });
    expect(xls.status).toBe(200);
    expect(xls.body.subarray(0, 2).toString()).toBe('PK');
  });
});

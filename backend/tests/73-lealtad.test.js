// Paso 22: programa de lealtad. Costales premium (5.º 5 %, 10.º 10 %, 15.º 15 %, y vuelve a empezar) y puntos
// por compra (hasta $500 → 5 %, hasta $1,500 → 10 %, más → 15 %; 1 punto = $0.10) que se usan como forma de pago.
const { randomUUID } = require('crypto');
const h = require('./helpers/app');
const Producto = require('../models/Producto');
const Cliente = require('../models/Cliente');
const MovimientoLealtad = require('../models/MovimientoLealtad');
const inv = require('../services/inventario');
const precios = require('../services/precios');
const { puntosPorCompra } = require('../services/lealtad');
const { conTransaccion } = require('../helpers/transaccion');

let A, dueno, cajero, premium, normal, juguete, ana, clinica;
const PIN = '4821';
const CONFIG = { escalones: [{ hasta: 50000, porcentaje: 500 }, { hasta: 150000, porcentaje: 1000 }, { hasta: null, porcentaje: 1500 }] };

beforeAll(async () => {
  await h.resetDb();
  A = await h.crearSucursal({ nombre: 'A' });
  dueno = await h.sesion({ rol: 'dueno', pin: PIN });
  cajero = await h.sesion({ rol: 'cajero', sucursales: [A._id] });
  premium = await Producto.create({ sku: 'PREM', nombre: 'Costal premium', categoria: 'alimento', unidad: 'pieza', iva: 'tasa_0', alimentoPremium: true });
  normal = await Producto.create({ sku: 'NORM', nombre: 'Costal económico', categoria: 'alimento', unidad: 'pieza', iva: 'tasa_0' });
  juguete = await Producto.create({ sku: 'JUG', nombre: 'Juguete', categoria: 'accesorio', unidad: 'pieza', iva: 'tasa_16', alimentoPremium: true });
  for (const [p, precio] of [[premium, 100000], [normal, 40000], [juguete, 10000]]) {
    await precios.fijarPrecio({ clave: 'publico', productoId: p._id, precio }, dueno.usuario);
  }
  await conTransaccion(async s => {
    for (const p of [premium, normal, juguete]) {
      await inv.registrarEntrada({ sucursal: A._id, producto: p._id, cantidad: 100, costoUnitario: 1000, caducidad: '12/2028', origen: 'compra', usuario: dueno.usuario._id }, s);
    }
  });
  await h.abrirTurno(cajero, A);
  ana = (await h.request(h.app).post('/api/clientes/rapido').set(h.auth(cajero.token)).send({ nombre: 'Ana (prueba)' })).body.datos;
  clinica = (await h.request(h.app).post('/api/clientes').set(h.auth(dueno.token)).send({ nombre: 'Clínica (prueba)', tipo: 'clinica', listaPrecios: 'publico' })).body.datos;
});
afterAll(h.cerrar);

const api = (s, metodo, ruta) => h.request(h.app)[metodo](ruta).set(h.auth(s.token, A));
const vender = (cliente, partidas, pagos) => api(cajero, 'post', '/api/ventas').send({ claveOperacion: randomUUID(), cliente, partidas, pagos: pagos || [{ metodo: 'efectivo', monto: 100000000 }] });
const saldo = async id => (await Cliente.findById(id).lean()).lealtad;

describe('puntos por compra', () => {
  test('escalones: 5 % hasta $500, 10 % hasta $1,500, 15 % arriba; en pesos, hacia abajo', () => {
    expect(puntosPorCompra(40000, CONFIG)).toBe(20); // $400 → 20 puntos = $2.00
    expect(puntosPorCompra(50000, CONFIG)).toBe(25);
    expect(puntosPorCompra(50001, CONFIG)).toBe(50);
    expect(puntosPorCompra(150000, CONFIG)).toBe(150);
    expect(puntosPorCompra(150100, CONFIG)).toBe(225);
    expect(puntosPorCompra(1999, CONFIG)).toBe(0);
  });
});

describe('costales premium', () => {
  test('solo el alimento por pieza puede ser premium', async () => {
    expect((await Producto.findById(juguete._id).lean()).alimentoPremium).toBe(false);
    const r = await api(dueno, 'patch', `/api/productos/${normal._id}`).send({ alimentoPremium: false });
    expect(r.body.datos.alimentoPremium).toBe(false);
  });

  test('el 5.º costal lleva 5 %; la cotización lo muestra; suma puntos por el total', async () => {
    const r4 = await vender(ana.id, [{ producto: premium._id, cantidad: 4 }]); // costales 1–4, $4,000 → 15 %
    expect(r4.status).toBe(201);
    expect(r4.body.datos.lealtad).toMatchObject({ costales: 4, costalesDespues: 4, puntosGanados: 600, puntosUsados: 0, saldoPuntos: 600 });
    const cot = await api(cajero, 'post', '/api/ventas/cotizar').send({ cliente: ana.id, partidas: [{ producto: premium._id, cantidad: 1 }] });
    expect(cot.body.datos[0]).toMatchObject({ descuentoLealtad: 5000, premiosCostal: [5] });
    const r5 = await vender(ana.id, [{ producto: premium._id, cantidad: 1 }, { producto: normal._id, cantidad: 1 }]);
    expect(r5.status).toBe(201); // sin PIN aunque haya descuento
    const p = r5.body.datos.partidas[0];
    expect(p).toMatchObject({ descuento: 5000, descuentoLealtad: 5000, importe: 95000, premiosCostal: [5], costalesLealtad: 1 });
    expect(r5.body.datos.partidas[1].costalesLealtad).toBeUndefined();
    expect(r5.body.datos.total).toBe(135000); // 95,000 + 40,000 → 10 % = 135 puntos
    expect(r5.body.datos.lealtad).toMatchObject({ puntosGanados: 135, costalesDespues: 5, saldoPuntos: 735 });
  });

  test('10.º 10 %, 15.º 15 % y el ciclo vuelve a empezar', async () => {
    const r = await vender(ana.id, [{ producto: premium._id, cantidad: 11 }]); // costales 6–16
    const p = r.body.datos.partidas[0];
    expect(p.premiosCostal).toEqual([10, 15]);
    expect(p.descuentoLealtad).toBe(10000 + 15000);
    expect(r.body.datos.lealtad.costalesDespues).toBe(1);
    expect((await saldo(ana.id)).costales).toBe(1);
  });

  test('distribuidores y Público en general no participan', async () => {
    const r = await vender(clinica.id, [{ producto: premium._id, cantidad: 5 }]);
    expect(r.body.datos.lealtad).toBeNull();
    expect(r.body.datos.descuento).toBe(0);
    const pg = await vender(undefined, [{ producto: premium._id, cantidad: 5 }]);
    expect(pg.body.datos.lealtad).toBeNull();
    expect((await vender(clinica.id, [{ producto: normal._id, cantidad: 1 }], [{ metodo: 'puntos', monto: 1000 }, { metodo: 'efectivo', monto: 39000 }])).status).toBe(400);
  });
});

describe('canje y cancelación', () => {
  let ventaCanje;
  test('pagar con puntos: descuenta del saldo y no gana puntos por lo pagado con puntos', async () => {
    const antes = (await saldo(ana.id)).puntos;
    const r = await vender(ana.id, [{ producto: juguete._id, cantidad: 1 }], [{ metodo: 'puntos', monto: 5000 }, { metodo: 'efectivo', monto: 5000 }]);
    expect(r.status).toBe(201);
    ventaCanje = r.body.datos;
    expect(ventaCanje.lealtad).toMatchObject({ puntosUsados: 500, puntosGanados: 2 }); // $50 con efectivo → 5 % = 2.5 → 2
    expect((await saldo(ana.id)).puntos).toBe(antes - 500 + 2);
    const sinSaldo = await vender(ana.id, [{ producto: premium._id, cantidad: 1 }], [{ metodo: 'puntos', monto: 100000 }]);
    expect(sinSaldo.status).toBe(409);
    expect(sinSaldo.body.codigo).toBe('PUNTOS_INSUFICIENTES');
  });

  test('cancelar la venta regresa los puntos y los costales', async () => {
    const antes = await saldo(ana.id);
    const r = await vender(ana.id, [{ producto: premium._id, cantidad: 2 }]);
    const despues = await saldo(ana.id);
    expect(despues.costales).toBe(antes.costales + 2);
    const c = await api(cajero, 'post', `/api/ventas/${r.body.datos.id}/cancelar`).send({ motivo: 'Prueba de cancelación', autorizacion: { usuario: dueno.usuario.usuario, pin: PIN } });
    expect(c.status).toBe(200);
    expect(await saldo(ana.id)).toEqual(antes);
    expect(await MovimientoLealtad.exists({ venta: r.body.datos.id, tipo: 'cancelacion' })).toBeTruthy();
  });

  test('historial del cliente y forma de pago en el reporte', async () => {
    const h1 = await api(cajero, 'get', `/api/clientes/${ana.id}/lealtad`);
    expect(h1.body.datos.puntos).toBe((await saldo(ana.id)).puntos);
    expect(h1.body.datos.movimientos.map(m => m.tipo)).toEqual(expect.arrayContaining(['acumulo', 'canje', 'cancelacion']));
    const rep = await api(dueno, 'get', '/api/reportes/ventas');
    expect(rep.body.datos.formasPago.find(f => f.metodo === 'puntos')).toMatchObject({ monto: 5000, ventas: 1 });
  });
});

// Paso 21: mayoreo por cantidad (escalas), promociones (producto, categoría, lote) y descuentos con motivo.
const { randomUUID } = require('crypto');
const h = require('./helpers/app');
const Producto = require('../models/Producto');
const Venta = require('../models/Venta');
const inv = require('../services/inventario');
const precios = require('../services/precios');
const { conTransaccion } = require('../helpers/transaccion');
const { diaLocal } = require('../helpers/fechas');
const { Auditoria } = h.modelos;

let A, B, dueno, cajero, costal, shampoo, vacuna;
const PIN = '4821';
const hoy = diaLocal();
const enDias = n => diaLocal(new Date(Date.now() + n * 86400000));

beforeAll(async () => {
  await h.resetDb();
  A = await h.crearSucursal({ nombre: 'A' });
  B = await h.crearSucursal({ nombre: 'B' });
  dueno = await h.sesion({ rol: 'dueno', pin: PIN });
  cajero = await h.sesion({ rol: 'cajero', sucursales: [A._id] });
  costal = await Producto.create({ sku: 'COS', nombre: 'Costal 20 kg', categoria: 'alimento', unidad: 'pieza', iva: 'tasa_0' });
  shampoo = await Producto.create({ sku: 'SHA', nombre: 'Shampoo', categoria: 'higiene', unidad: 'pieza', iva: 'tasa_16' });
  vacuna = await Producto.create({ sku: 'VAC', nombre: 'Desparasitante', categoria: 'medicamento', unidad: 'pieza', iva: 'tasa_0' });
  for (const [p, precio] of [[costal, 100000], [shampoo, 20000], [vacuna, 30000]]) {
    await precios.fijarPrecio({ clave: 'publico', productoId: p._id, precio }, dueno.usuario);
  }
  await conTransaccion(async s => {
    const u = dueno.usuario._id;
    await inv.registrarEntrada({ sucursal: A._id, producto: costal._id, cantidad: 50, costoUnitario: 70000, caducidad: '12/2027', origen: 'compra', usuario: u }, s);
    await inv.registrarEntrada({ sucursal: A._id, producto: shampoo._id, cantidad: 50, costoUnitario: 10000, origen: 'compra', usuario: u }, s);
    // Lote que caduca después (VX-LEJOS) y lote en promoción que caduca antes… y otro aún más próximo (VX-PRIMERO)
    await inv.registrarEntrada({ sucursal: A._id, producto: vacuna._id, cantidad: 10, costoUnitario: 15000, lote: 'VX-PRIMERO', caducidad: '06/2027', origen: 'compra', usuario: u }, s);
    await inv.registrarEntrada({ sucursal: A._id, producto: vacuna._id, cantidad: 3, costoUnitario: 15000, lote: 'VX-PROMO', caducidad: '08/2027', origen: 'compra', usuario: u }, s);
  });
  await h.abrirTurno(cajero, A);
});
afterAll(h.cerrar);

const api = (s, metodo, ruta, suc = A) => h.request(h.app)[metodo](ruta).set(h.auth(s.token, suc));
const cotizar = partidas => api(cajero, 'post', '/api/ventas/cotizar').send({ partidas });
const vender = (partidas, extra = {}) => api(cajero, 'post', '/api/ventas').send({ claveOperacion: randomUUID(), partidas, pagos: [{ metodo: 'efectivo', monto: 10000000 }], ...extra });
const promo = cuerpo => api(dueno, 'post', '/api/promociones').send({ desde: hoy, hasta: enDias(7), ...cuerpo });

describe('mayoreo por cantidad', () => {
  test('el dueño define escalas; la caja cobra la que aplica según la cantidad', async () => {
    const r = await api(dueno, 'patch', `/api/productos/${costal._id}`).send({ escalas: [{ desde: 10, precio: 85000 }, { desde: 3, precio: 95000 }] });
    expect(r.status).toBe(200);
    expect(r.body.datos.escalas).toEqual([{ desde: 3, precio: 95000 }, { desde: 10, precio: 85000 }]);
    expect((await api(dueno, 'patch', `/api/productos/${costal._id}`).send({ escalas: [{ desde: 3, precio: 1 }, { desde: 3, precio: 2 }] })).status).toBe(400);

    const c = await cotizar([{ producto: costal._id, cantidad: 2 }, { producto: costal._id, cantidad: 3 }, { producto: costal._id, cantidad: 12 }]);
    expect(c.body.datos.map(p => [p.origenPrecio, p.precioUnitario, p.escalaDesde])).toEqual([['lista', 100000, null], ['escala', 95000, 3], ['escala', 85000, 10]]);

    const v = await vender([{ producto: costal._id, cantidad: 10 }]);
    expect(v.status).toBe(201);
    expect(v.body.datos.partidas[0]).toMatchObject({ precioUnitario: 85000, precioLista: 100000, origenPrecio: 'escala', escalaDesde: 10, ahorroPrecio: 150000, importe: 850000 });
  });
});

describe('promociones', () => {
  test('solo el dueño las crea; validaciones', async () => {
    expect((await api(cajero, 'post', '/api/promociones').send({ nombre: 'X', tipo: 'porcentaje', valor: 1000, alcance: 'categoria', categoria: 'higiene', desde: hoy, hasta: hoy })).status).toBe(403);
    expect((await promo({ nombre: 'Mal', tipo: 'precio', valor: 100, alcance: 'categoria', categoria: 'higiene' })).status).toBe(400); // precio fijo por categoría
    expect((await promo({ nombre: 'Mal', tipo: 'porcentaje', valor: 1000, alcance: 'producto' })).status).toBe(400); // sin producto
    expect((await promo({ nombre: 'Mal', tipo: 'porcentaje', valor: 1000, alcance: 'categoria', categoria: 'higiene', desde: enDias(3), hasta: hoy })).status).toBe(400);
  });

  test('por categoría (%), con vigencia y por sucursal; gana el precio más bajo', async () => {
    const p = await promo({ nombre: 'Higiene 15%', tipo: 'porcentaje', valor: 1500, alcance: 'categoria', categoria: 'higiene', sucursales: [A._id] });
    expect(p.status).toBe(201);
    expect(p.body.datos).toMatchObject({ vigente: true, desde: hoy, hasta: enDias(7) });
    const c = await cotizar([{ producto: shampoo._id, cantidad: 1 }]);
    expect(c.body.datos[0]).toMatchObject({ origenPrecio: 'promocion', precioUnitario: 17000, promocion: { nombre: 'Higiene 15%' } });
    // En otra sucursal no aplica
    const cajeroB = await h.sesion({ rol: 'cajero', sucursales: [B._id] });
    const cb = await api(cajeroB, 'post', '/api/ventas/cotizar', B).send({ partidas: [{ producto: shampoo._id, cantidad: 1 }] });
    expect(cb.body.datos[0].origenPrecio).toBe('lista');
    // Futura: todavía no aplica
    await promo({ nombre: 'Futura', tipo: 'precio', valor: 100, alcance: 'producto', producto: shampoo._id, desde: enDias(2), hasta: enDias(3) });
    expect((await cotizar([{ producto: shampoo._id, cantidad: 1 }])).body.datos[0].precioUnitario).toBe(17000);
    // Desactivada: ya no aplica
    await api(dueno, 'patch', `/api/promociones/${p.body.datos.id}`).send({ activa: false });
    expect((await cotizar([{ producto: shampoo._id, cantidad: 1 }])).body.datos[0].origenPrecio).toBe('lista');
    expect(await Auditoria.countDocuments({ accion: { $in: ['promocion.crear', 'promocion.actualizar'] } })).toBe(3);
  });

  test('por lote: vende primero ese lote y solo aplica si alcanza su existencia', async () => {
    await promo({ nombre: 'Lote por caducar', tipo: 'precio', valor: 20000, alcance: 'lote', producto: vacuna._id, lote: 'VX-PROMO' });
    const c = await cotizar([{ producto: vacuna._id, cantidad: 3 }, { producto: vacuna._id, cantidad: 4 }]);
    expect(c.body.datos.map(p => p.origenPrecio)).toEqual(['promocion', 'lista']); // del lote solo hay 3
    const v = await vender([{ producto: vacuna._id, cantidad: 2 }]);
    expect(v.status).toBe(201);
    expect(v.body.datos.partidas[0]).toMatchObject({ precioUnitario: 20000, origenPrecio: 'promocion', promocion: { lote: 'VX-PROMO' } });
    expect(v.body.datos.partidas[0].lotes.map(l => l.lote)).toEqual(['VX-PROMO']); // aunque VX-PRIMERO caduca antes
  });
});

describe('descuentos con motivo', () => {
  test('motivos por defecto piden PIN; el dueño quita el PIN a uno con su tope', async () => {
    const cfg = await api(cajero, 'get', '/api/configuracion');
    expect(cfg.body.datos.descuentos.motivos[0]).toEqual({ nombre: 'Cliente frecuente', maximo: 1000, requierePin: true });
    const sinPin = await vender([{ producto: shampoo._id, cantidad: 1, descuentoPorcentaje: 1000, descuentoMotivo: 'Cliente frecuente' }]);
    expect(sinPin.status).toBe(403);
    const motivos = [{ nombre: 'Cliente frecuente', maximo: 1000, requierePin: false }, { nombre: 'Otro', maximo: 10000, requierePin: true }];
    expect((await api(dueno, 'put', '/api/configuracion').send({ descuentos: { motivos } })).status).toBe(200);
  });

  test('dentro del tope del motivo: sin PIN y en bitácora; arriba del tope: 400; motivo desconocido: 400', async () => {
    const v = await vender([{ producto: shampoo._id, cantidad: 2, descuentoPorcentaje: 1000, descuentoMotivo: 'Cliente frecuente' }]);
    expect(v.status).toBe(201);
    expect(v.body.datos.partidas[0]).toMatchObject({ descuento: 4000, descuentoMotivo: 'Cliente frecuente' });
    const aud = await Auditoria.findOne({ accion: 'venta.descuento', entidadId: v.body.datos.id }).lean();
    expect(aud.autorizadoPor).toBeUndefined();
    expect(aud.despues.partidas[0].motivo).toBe('Cliente frecuente');
    expect((await vender([{ producto: shampoo._id, cantidad: 1, descuentoPorcentaje: 1500, descuentoMotivo: 'Cliente frecuente' }])).status).toBe(400);
    expect((await vender([{ producto: shampoo._id, cantidad: 1, descuentoPorcentaje: 500, descuentoMotivo: 'Porque sí' }])).status).toBe(400);
    // Sin motivo, como antes: PIN
    expect((await vender([{ producto: shampoo._id, cantidad: 1, descuentoPorcentaje: 500 }])).status).toBe(403);
    const conPin = await vender([{ producto: shampoo._id, cantidad: 1, descuentoPorcentaje: 5000, descuentoMotivo: 'Otro' }], { autorizacion: { usuario: dueno.usuario.usuario, pin: PIN } });
    expect(conPin.status).toBe(201);
  });

  test('reporte: descuentos por motivo y precios especiales', async () => {
    const r = await api(dueno, 'get', `/api/reportes/ventas?desde=${hoy}&hasta=${hoy}`);
    expect(r.body.datos.descuentosPorMotivo).toEqual(expect.arrayContaining([
      { motivo: 'Cliente frecuente', descuento: 4000, partidas: 1 },
      { motivo: 'Otro', descuento: 10000, partidas: 1 }
    ]));
    expect(r.body.datos.preciosEspeciales).toEqual(expect.arrayContaining([
      expect.objectContaining({ concepto: 'Mayoreo por cantidad', ahorro: 150000 }),
      expect.objectContaining({ concepto: 'Promoción: Lote por caducar', ahorro: 20000 })
    ]));
    expect(await Venta.countDocuments({ sucursal: A._id })).toBe(4);
  });
});

// Recepción de mercancía: proveedores, compra en borrador, confirmación que crea capas (todo o nada).
const h = require('./helpers/app');
const Producto = require('../models/Producto');
const Compra = require('../models/Compra');
const InventoryLayer = require('../models/InventoryLayer');
const InventoryMovement = require('../models/InventoryMovement');
const { diaLocal } = require('../helpers/fechas');
const { Auditoria } = h.modelos;

let A, B, dueno, almacen, almacenB, cajero, proveedor, med, vacuna, granel, collar;

beforeAll(async () => {
  await h.resetDb();
  A = await h.crearSucursal({ nombre: 'A' });
  B = await h.crearSucursal({ nombre: 'B' });
  dueno = await h.sesion({ rol: 'dueno' });
  almacen = await h.sesion({ rol: 'almacen', sucursales: [A._id] });
  almacenB = await h.sesion({ rol: 'almacen', sucursales: [B._id] });
  cajero = await h.sesion({ rol: 'cajero', sucursales: [A._id] });
  med = await Producto.create({ sku: 'MED-1', nombre: 'Antibiótico', categoria: 'medicamento', unidad: 'pieza', iva: 'tasa_0' });
  vacuna = await Producto.create({ sku: 'VAC-1', nombre: 'Vacuna', categoria: 'biologico', unidad: 'pieza', iva: 'tasa_0', requiereRefrigeracion: true });
  granel = await Producto.create({ sku: 'GRA-1', nombre: 'Granel', categoria: 'alimento', unidad: 'kg', iva: 'tasa_0' });
  collar = await Producto.create({ sku: 'COL-1', nombre: 'Collar', categoria: 'accesorio', unidad: 'pieza', iva: 'tasa_16' });
});
afterAll(h.cerrar);

const api = (s, metodo, ruta, sucursal = A) => h.request(h.app)[metodo](ruta).set(h.auth(s.token, sucursal));

let folio = 0;
const compraBase = (extra = {}) => {
  folio += 1;
  return {
    proveedor: String(proveedor.id),
    folioFactura: `F-${folio}`,
    fechaFactura: diaLocal(),
    condicionPago: 'contado',
    partidas: [
      { producto: String(med._id), cantidad: 10, costoUnitario: 4550, lote: 'L-MED', caducidad: '06/2028' },
      { producto: String(collar._id), cantidad: 3, costoUnitario: 1001 }
    ],
    ...extra
  };
};

describe('proveedores', () => {
  test('almacén crea proveedor; queda en bitácora; nombre y RFC únicos', async () => {
    const res = await api(almacen, 'post', '/api/proveedores', null).send({ nombre: 'Distribuidora Vet (prueba)', rfc: 'dve850101ab1', diasCredito: 30, telefono: '3110000000' });
    expect(res.status).toBe(201);
    proveedor = res.body.datos;
    expect(proveedor).toMatchObject({ rfc: 'DVE850101AB1', diasCredito: 30, activo: true });
    expect(await Auditoria.countDocuments({ accion: 'proveedor.crear', entidadId: proveedor.id })).toBe(1);
    expect((await api(almacen, 'post', '/api/proveedores', null).send({ nombre: 'DISTRIBUIDORA VET (PRUEBA)' })).status).toBe(409);
    expect((await api(almacen, 'post', '/api/proveedores', null).send({ nombre: 'Otro', rfc: 'DVE850101AB1' })).status).toBe(409);
  });

  test('validaciones y permisos', async () => {
    expect((await api(almacen, 'post', '/api/proveedores', null).send({ nombre: 'X', rfc: 'MALO' })).status).toBe(400);
    expect((await api(almacen, 'post', '/api/proveedores', null).send({ nombre: 'X', diasCredito: -1 })).status).toBe(400);
    expect((await api(cajero, 'get', '/api/proveedores', null)).status).toBe(403);
    const lista = await api(almacen, 'get', '/api/proveedores?q=distribuidora', null);
    expect(lista.body.datos.map(p => p.nombre)).toEqual(['Distribuidora Vet (prueba)']);
  });
});

describe('borrador de compra', () => {
  test('calcula importes (sin IVA), IVA por tasa del producto y total; NO toca el inventario', async () => {
    const res = await api(almacen, 'post', '/api/compras').send(compraBase());
    expect(res.status).toBe(201);
    const c = res.body.datos;
    expect(c).toMatchObject({ estado: 'borrador', proveedor: { nombre: 'Distribuidora Vet (prueba)' }, subtotal: 45500 + 3003, iva: 480, total: 48983 });
    expect(c.partidas[1]).toMatchObject({ sku: 'COL-1', importe: 3003, iva: 480, tasaIva: 1600 }); // 30.03 × 16 % = 4.8048 → 4.80
    expect(await InventoryLayer.countDocuments({ sucursal: A._id })).toBe(0);
  });

  test('granel: cantidad en gramos y costo por kg', async () => {
    const res = await api(almacen, 'post', '/api/compras').send(compraBase({ partidas: [{ producto: String(granel._id), cantidad: 25500, costoUnitario: 3999, caducidad: '12/2027' }] }));
    expect(res.status).toBe(201);
    expect(res.body.datos.partidas[0].importe).toBe(101975); // 39.99 × 25.5 = 1019.745 → 1019.75
  });

  test('a crédito: vencimiento = fecha de factura + días del proveedor, fin del día en Tepic', async () => {
    const res = await api(almacen, 'post', '/api/compras').send(compraBase({ condicionPago: 'credito', fechaFactura: '2026-11-10' }));
    expect(res.body.datos.diasCredito).toBe(30);
    expect(res.body.datos.vencimiento).toBe('2026-12-11T06:59:59.999Z'); // 10/12/2026 23:59:59.999 en Tepic
    const otro = await api(almacen, 'post', '/api/compras').send(compraBase({ condicionPago: 'credito', diasCredito: 8, fechaFactura: '2026-11-10' }));
    expect(otro.body.datos.vencimiento).toBe('2026-11-19T06:59:59.999Z');
    const contado = await api(almacen, 'post', '/api/compras').send(compraBase());
    expect(contado.body.datos.vencimiento).toBeNull();
  });

  test('cadena de frío: temperatura fuera de 2–8 °C marca la partida (y la compra en la lista)', async () => {
    const res = await api(almacen, 'post', '/api/compras').send(compraBase({
      partidas: [
        { producto: String(vacuna._id), cantidad: 5, costoUnitario: 15000, lote: 'V1', caducidad: '06/2027', temperaturaLlegada: 9.5 },
        { producto: String(vacuna._id), cantidad: 5, costoUnitario: 15000, lote: 'V2', caducidad: '06/2027', temperaturaLlegada: 4.2 }
      ]
    }));
    expect(res.body.datos.partidas.map(p => p.fueraDeRango)).toEqual([true, false]);
    const lista = await api(almacen, 'get', '/api/compras?estado=borrador');
    expect(lista.body.datos.find(c => c.id === res.body.datos.id).alertaTemperatura).toBe(true);
  });

  test('avisa ANTES de confirmar: lote/caducidad faltante, caducado, fecha futura, centavos', async () => {
    const casos = {
      'medicamento sin lote': compraBase({ partidas: [{ producto: String(med._id), cantidad: 1, costoUnitario: 1, caducidad: '06/2028' }] }),
      'alimento sin caducidad': compraBase({ partidas: [{ producto: String(granel._id), cantidad: 1, costoUnitario: 1 }] }),
      'lote ya caducado': compraBase({ partidas: [{ producto: String(med._id), cantidad: 1, costoUnitario: 1, lote: 'X', caducidad: '01/2020' }] }),
      'factura futura': compraBase({ fechaFactura: '2099-01-01' }),
      'costo con decimales': compraBase({ partidas: [{ producto: String(collar._id), cantidad: 1, costoUnitario: 10.5 }] }),
      'sin partidas': compraBase({ partidas: [] }),
      'temperatura como texto': compraBase({ partidas: [{ producto: String(collar._id), cantidad: 1, costoUnitario: 1, temperaturaLlegada: '5' }] })
    };
    for (const [caso, cuerpo] of Object.entries(casos)) {
      const res = await api(almacen, 'post', '/api/compras').send(cuerpo);
      expect({ caso, status: res.status }).toEqual({ caso, status: 400 });
    }
  });

  test('la misma factura del mismo proveedor no se captura dos veces (aunque sea en otra sucursal)', async () => {
    await api(almacen, 'post', '/api/compras').send(compraBase({ folioFactura: 'dup-1' }));
    expect((await api(almacen, 'post', '/api/compras').send(compraBase({ folioFactura: 'DUP-1' }))).status).toBe(409);
    expect((await api(almacenB, 'post', '/api/compras', B).send(compraBase({ folioFactura: 'DUP-1' }))).status).toBe(409);
  });

  test('editar el borrador (PUT) recalcula todo', async () => {
    const creada = (await api(almacen, 'post', '/api/compras').send(compraBase())).body.datos;
    const res = await api(almacen, 'put', `/api/compras/${creada.id}`).send(compraBase({ folioFactura: creada.folioFactura, partidas: [{ producto: String(collar._id), cantidad: 1, costoUnitario: 10000 }] }));
    expect(res.status).toBe(200);
    expect(res.body.datos).toMatchObject({ subtotal: 10000, iva: 1600, total: 11600 });
    expect(res.body.datos.partidas).toHaveLength(1);
  });
});

describe('confirmar recepción', () => {
  test('crea una capa y un movimiento de entrada por partida, con referencia a la compra; queda en bitácora', async () => {
    const c = (await api(almacen, 'post', '/api/compras').send(compraBase())).body.datos;
    const res = await api(almacen, 'post', `/api/compras/${c.id}/confirmar`);
    expect(res.status).toBe(200);
    expect(res.body.datos.estado).toBe('recibida');
    expect(res.body.datos.partidas.every(p => p.capa)).toBe(true);

    const capas = await InventoryLayer.find({ sucursal: A._id, 'referencia.id': c.id }).sort({ _id: 1 }).lean();
    expect(capas.map(x => [x.lote || null, x.cantidadInicial, x.costoUnitario, x.origen])).toEqual([['L-MED', 10, 4550, 'compra'], [null, 3, 1001, 'compra']]);
    const movs = await InventoryMovement.find({ sucursal: A._id, 'referencia.id': c.id }).lean();
    expect(movs.map(m => [m.tipo, m.cantidad, m.referencia.partida]).sort()).toEqual([['entrada', 10, 0], ['entrada', 3, 1]]);
    expect(await Auditoria.countDocuments({ accion: 'compra.recibir', entidadId: c.id })).toBe(1);

    const existencias = await api(almacen, 'get', '/api/existencias?q=antibio');
    expect(existencias.body.datos[0].existencia).toBeGreaterThanOrEqual(10);
  });

  test('una compra recibida ya no se edita, no se confirma otra vez ni se cancela (409)', async () => {
    const c = (await api(almacen, 'post', '/api/compras').send(compraBase())).body.datos;
    await api(almacen, 'post', `/api/compras/${c.id}/confirmar`);
    expect((await api(almacen, 'post', `/api/compras/${c.id}/confirmar`)).status).toBe(409);
    expect((await api(almacen, 'put', `/api/compras/${c.id}`).send(compraBase({ folioFactura: c.folioFactura }))).status).toBe(409);
    expect((await api(almacen, 'post', `/api/compras/${c.id}/cancelar`)).status).toBe(409);
    expect(await InventoryLayer.countDocuments({ sucursal: A._id, 'referencia.id': c.id })).toBe(2);
  });

  test('dos confirmaciones simultáneas: solo una crea capas', async () => {
    const c = (await api(almacen, 'post', '/api/compras').send(compraBase())).body.datos;
    const r = await Promise.all([1, 2, 3].map(() => api(almacen, 'post', `/api/compras/${c.id}/confirmar`)));
    expect(r.filter(x => x.status === 200)).toHaveLength(1);
    expect(await InventoryLayer.countDocuments({ sucursal: A._id, 'referencia.id': c.id })).toBe(2);
  });

  test('si una partida falla al confirmar, no se crea NINGUNA capa y sigue en borrador', async () => {
    const c = (await api(almacen, 'post', '/api/compras').send(compraBase())).body.datos;
    // Simula que el lote quedó caducado entre la captura y la confirmación
    await Compra.updateOne({ _id: c.id, sucursal: A._id }, { $set: { 'partidas.1.caducidad': new Date('2020-01-01T00:00:00Z') } });
    const res = await api(almacen, 'post', `/api/compras/${c.id}/confirmar`);
    expect(res.status).toBe(400);
    expect(await InventoryLayer.countDocuments({ sucursal: A._id, 'referencia.id': c.id })).toBe(0);
    expect((await Compra.findOne({ _id: c.id, sucursal: A._id })).estado).toBe('borrador');
  });
});

describe('cancelar y alcance', () => {
  test('cancelar un borrador libera el folio de factura', async () => {
    const c = (await api(almacen, 'post', '/api/compras').send(compraBase({ folioFactura: 'REUSO-1' }))).body.datos;
    const res = await api(almacen, 'post', `/api/compras/${c.id}/cancelar`).send({ motivo: 'Capturada por error' });
    expect(res.body.datos.estado).toBe('cancelada');
    expect((await api(almacen, 'post', '/api/compras').send(compraBase({ folioFactura: 'REUSO-1' }))).status).toBe(201);
    expect(await Auditoria.countDocuments({ accion: 'compra.cancelar', entidadId: c.id })).toBe(1);
  });

  test('el almacén de B no ve ni confirma compras de A; el cajero no tiene acceso', async () => {
    const c = (await api(almacen, 'post', '/api/compras').send(compraBase())).body.datos;
    expect((await api(almacenB, 'get', `/api/compras/${c.id}`, B)).status).toBe(404);
    expect((await api(almacenB, 'post', `/api/compras/${c.id}/confirmar`, B)).status).toBe(404);
    expect((await api(almacenB, 'post', `/api/compras/${c.id}/confirmar`, A)).status).toBe(403);
    expect((await api(cajero, 'get', '/api/compras')).status).toBe(403);
  });

  test('el dueño ve las compras de todas las sucursales y debe elegir una para registrar', async () => {
    const lista = await api(dueno, 'get', '/api/compras', null);
    expect(lista.status).toBe(200);
    expect(lista.body.total).toBeGreaterThan(0);
    expect((await api(dueno, 'post', '/api/compras', null).send(compraBase())).status).toBe(400);
  });
});

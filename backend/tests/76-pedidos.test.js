// Paso 25: pedidos a proveedores. Alta, envío, documento carta, recepción contra el pedido (parcial y completa),
// «en camino» en compras sugeridas y cancelación.
const h = require('./helpers/app');
const Producto = require('../models/Producto');
const { Auditoria } = h.modelos;

let A, B, dueno, almacen, almacenB, cajero, croqueta, vacuna, prov, otroProv, pedido;

beforeAll(async () => {
  await h.resetDb();
  A = await h.crearSucursal({ nombre: 'Centro' });
  B = await h.crearSucursal({ nombre: 'Norte' });
  dueno = await h.sesion({ rol: 'dueno', pin: '4821' });
  almacen = await h.sesion({ rol: 'almacen', sucursales: [A._id] });
  almacenB = await h.sesion({ rol: 'almacen', sucursales: [B._id] });
  cajero = await h.sesion({ rol: 'cajero', sucursales: [A._id] });
  croqueta = await Producto.create({ sku: 'CRQ', nombre: 'Croqueta <20 kg>', categoria: 'alimento', unidad: 'pieza', iva: 'tasa_0', minimos: [{ sucursal: A._id, cantidad: 10 }] });
  vacuna = await Producto.create({ sku: 'VAC', nombre: 'Vacuna', categoria: 'biologico', unidad: 'pieza', iva: 'tasa_0' });
  const alta = datos => h.request(h.app).post('/api/proveedores').set(h.auth(dueno.token)).send(datos);
  prov = (await alta({ nombre: 'Distribuidora Pet (prueba)', whatsapp: '3119998877', contacto: 'Luis' })).body.datos;
  otroProv = (await alta({ nombre: 'Otro (prueba)' })).body.datos;
});
afterAll(h.cerrar);

const api = (s, metodo, ruta, suc = A) => h.request(h.app)[metodo](ruta).set(h.auth(s.token, suc));
const compra = (partidas, extra = {}) => api(almacen, 'post', '/api/compras').send({
  proveedor: prov.id, folioFactura: `F-${Math.random().toString(36).slice(2, 8)}`, fechaFactura: '2026-11-20', condicionPago: 'contado', partidas, ...extra
});

describe('pedidos', () => {
  test('proveedor con WhatsApp; crear pedido con folio y total estimado; el cajero no puede', async () => {
    expect(prov.whatsapp).toBe('3119998877');
    const r = await api(almacen, 'post', '/api/pedidos').send({
      proveedor: prov.id, origen: 'sugeridas', notas: 'Entregar en la mañana',
      partidas: [{ producto: croqueta._id, cantidad: 10, costoEstimado: 70000 }, { producto: vacuna._id, cantidad: 5 }]
    });
    expect(r.status).toBe(201);
    pedido = r.body.datos;
    expect(pedido).toMatchObject({ folio: 'PED-1', estado: 'borrador', totalEstimado: 700000, origen: 'sugeridas' });
    expect(pedido.partidas.map(p => p.pendiente)).toEqual([10, 5]);
    expect((await api(cajero, 'post', '/api/pedidos').send({ proveedor: prov.id, partidas: [{ producto: vacuna._id, cantidad: 1 }] })).status).toBe(403);
    expect((await api(almacen, 'post', '/api/pedidos').send({ proveedor: prov.id, partidas: [{ producto: vacuna._id, cantidad: 1 }, { producto: vacuna._id, cantidad: 2 }] })).status).toBe(400);
  });

  test('borrador editable; enviado ya no; documento carta escapado; otra sucursal no lo ve', async () => {
    const ed = await api(almacen, 'put', `/api/pedidos/${pedido.id}`).send({ proveedor: prov.id, partidas: [{ producto: croqueta._id, cantidad: 12, costoEstimado: 70000 }, { producto: vacuna._id, cantidad: 5 }] });
    expect(ed.body.datos.partidas[0].cantidad).toBe(12);
    const env = await api(almacen, 'post', `/api/pedidos/${pedido.id}/enviar`);
    expect(env.body.datos.estado).toBe('enviado');
    expect((await api(almacen, 'put', `/api/pedidos/${pedido.id}`).send({ proveedor: prov.id, partidas: [{ producto: vacuna._id, cantidad: 1 }] })).status).toBe(409);
    const doc = await api(almacen, 'get', `/api/pedidos/${pedido.id}/documento`);
    expect(doc.text).toContain('PEDIDO DE COMPRA');
    expect(doc.text).toContain('Croqueta &lt;20 kg&gt;');
    expect(doc.text).toContain('Atn. Luis');
    expect((await api(almacenB, 'get', `/api/pedidos/${pedido.id}`, B)).status).toBe(404);
  });

  test('lo pendiente del pedido cuenta como «en camino» en compras sugeridas', async () => {
    const s = await api(almacen, 'get', '/api/compras/sugeridas?todos=true');
    const fila = s.body.datos.find(f => f.producto.sku === 'CRQ');
    expect(fila.enCamino).toBe(12);
    expect(fila.sugerido).toBe(0);
  });

  test('recepción contra el pedido: parcial y luego completa', async () => {
    expect((await compra([{ producto: vacuna._id, cantidad: 1, costoUnitario: 100, lote: 'L1', caducidad: '12/2027' }], { pedido: pedido.id, proveedor: otroProv.id })).status).toBe(400);
    const c1 = await compra([{ producto: croqueta._id, cantidad: 7, costoUnitario: 70000, caducidad: '12/2027' }], { pedido: pedido.id });
    expect(c1.status).toBe(201);
    expect(c1.body.datos.pedido).toBe(pedido.id);
    await api(almacen, 'post', `/api/compras/${c1.body.datos.id}/confirmar`);
    let p = (await api(almacen, 'get', `/api/pedidos/${pedido.id}`)).body.datos;
    expect(p.estado).toBe('parcial');
    expect(p.partidas.map(x => x.pendiente)).toEqual([5, 5]);

    const c2 = await compra([
      { producto: croqueta._id, cantidad: 5, costoUnitario: 70000, caducidad: '12/2027' },
      { producto: vacuna._id, cantidad: 5, costoUnitario: 15000, lote: 'V1', caducidad: '06/2027' }
    ], { pedido: pedido.id });
    await api(almacen, 'post', `/api/compras/${c2.body.datos.id}/confirmar`);
    p = (await api(almacen, 'get', `/api/pedidos/${pedido.id}`)).body.datos;
    expect(p).toMatchObject({ estado: 'recibido', compras: [c1.body.datos.id, c2.body.datos.id] });
    expect(p.recibidoEn).toBeTruthy();
    // Ya recibido: no se recibe más contra él ni se cancela
    expect((await compra([{ producto: croqueta._id, cantidad: 1, costoUnitario: 1, caducidad: '12/2027' }], { pedido: pedido.id })).status).toBe(409);
    expect((await api(almacen, 'post', `/api/pedidos/${pedido.id}/cancelar`).send({ motivo: 'Ya no' })).status).toBe(409);
  });

  test('cancelar un pedido; listar abiertos', async () => {
    const p2 = (await api(almacen, 'post', '/api/pedidos').send({ proveedor: otroProv.id, partidas: [{ producto: vacuna._id, cantidad: 2 }] })).body.datos;
    expect(p2.folio).toBe('PED-2');
    expect((await api(almacen, 'get', '/api/pedidos?estado=abiertos')).body.datos.map(x => x.folio)).toEqual(['PED-2']);
    const c = await api(almacen, 'post', `/api/pedidos/${p2.id}/cancelar`).send({ motivo: 'El proveedor no tiene' });
    expect(c.body.datos.estado).toBe('cancelado');
    expect(await Auditoria.countDocuments({ accion: { $in: ['pedido.crear', 'pedido.enviar', 'pedido.cancelar'] } })).toBe(4);
  });
});

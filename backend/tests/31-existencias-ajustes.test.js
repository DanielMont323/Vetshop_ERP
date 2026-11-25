// Existencias con estado (vigente, por caducar, caducado, bajo mínimo), lotes, kárdex y ajustes con PIN del dueño.
const h = require('./helpers/app');
const Producto = require('../models/Producto');
const InventoryLayer = require('../models/InventoryLayer');
const inv = require('../services/inventario');
const { conTransaccion } = require('../helpers/transaccion');
const { diaLocal, formatearLocal } = require('../helpers/fechas');
const { Auditoria } = h.modelos;

let A, B, dueno, almacen, cajero, medico;
let med, collar, granel, sinStock, loteCaducado;

// DD/MM/AAAA de dentro de `dias` días (en Tepic)
const enDias = dias => formatearLocal(new Date(Date.now() + dias * 86400000), 'dd/MM/yyyy');

beforeAll(async () => {
  await h.resetDb();
  A = await h.crearSucursal({ nombre: 'A' });
  B = await h.crearSucursal({ nombre: 'B' });
  dueno = await h.sesion({ rol: 'dueno', pin: '4821' });
  almacen = await h.sesion({ rol: 'almacen', sucursales: [A._id] });
  cajero = await h.sesion({ rol: 'cajero', sucursales: [A._id] });
  medico = await h.sesion({ rol: 'medico_responsable', sucursales: [A._id], pin: '7373' });

  med = await Producto.create({ sku: 'MED-1', nombre: 'Antibiótico', categoria: 'medicamento', unidad: 'pieza', iva: 'tasa_0', minimos: [{ sucursal: A._id, cantidad: 2 }] });
  collar = await Producto.create({ sku: 'COL-1', nombre: 'Collar', categoria: 'accesorio', unidad: 'pieza', iva: 'tasa_16', minimos: [{ sucursal: A._id, cantidad: 5 }] });
  granel = await Producto.create({ sku: 'GRA-1', nombre: 'Granel gato', categoria: 'alimento', unidad: 'kg', iva: 'tasa_0' });
  sinStock = await Producto.create({ sku: 'SIN-1', nombre: 'Shampoo', categoria: 'higiene', unidad: 'pieza', iva: 'tasa_16', minimos: [{ sucursal: A._id, cantidad: 1 }] });

  const usuario = dueno.usuario._id;
  await conTransaccion(async s => {
    loteCaducado = (await inv.registrarEntrada({ sucursal: A._id, producto: med._id, cantidad: 3, costoUnitario: 5000, lote: 'CAD', caducidad: '01/2020', origen: 'inventario_inicial', permitirCaducado: true, usuario }, s)).capa;
    await inv.registrarEntrada({ sucursal: A._id, producto: med._id, cantidad: 4, costoUnitario: 5200, lote: 'PRONTO', caducidad: enDias(10), origen: 'compra', usuario }, s);
    await inv.registrarEntrada({ sucursal: A._id, producto: med._id, cantidad: 6, costoUnitario: 5300, lote: 'LEJOS', caducidad: '12/2028', origen: 'compra', usuario }, s);
    await inv.registrarEntrada({ sucursal: A._id, producto: collar._id, cantidad: 3, costoUnitario: 900, origen: 'compra', usuario }, s);
    await inv.registrarEntrada({ sucursal: B._id, producto: collar._id, cantidad: 20, costoUnitario: 900, origen: 'compra', usuario }, s);
    await inv.registrarEntrada({ sucursal: A._id, producto: granel._id, cantidad: 12500, costoUnitario: 4000, caducidad: '12/2027', origen: 'compra', usuario }, s);
  });
});
afterAll(h.cerrar);

const get = (ruta, s, sucursal) => h.request(h.app).get(ruta).set(h.auth(s.token, sucursal));
const ajustar = (s, cuerpo, sucursal = A) => h.request(h.app).post('/api/inventario/ajustes').set(h.auth(s.token, sucursal)).send(cuerpo);
const fila = (res, producto, sucursal = A) => res.body.datos.find(f => f.producto.id === String(producto._id) && f.sucursal.id === String(sucursal._id));
const pinDueno = () => ({ usuario: dueno.usuario.usuario, pin: '4821' });

describe('GET /api/existencias', () => {
  test('existencia = lo vendible; lo caducado y lo por caducar se informan aparte', async () => {
    const res = await get('/api/existencias', cajero);
    expect(res.status).toBe(200);
    expect(fila(res, med)).toMatchObject({ existencia: 10, caducado: 3, porCaducar: 4, minimo: 2, lotes: 3, alertas: ['caducado', 'por_caducar'] });
    expect(fila(res, med).proximaCaducidad).toBeTruthy();
    expect(fila(res, granel)).toMatchObject({ existencia: 12500, alertas: [] });
  });

  test('bajo mínimo, y productos SIN existencia que tienen mínimo', async () => {
    const res = await get('/api/existencias', cajero);
    expect(fila(res, collar)).toMatchObject({ existencia: 3, minimo: 5, alertas: ['bajo_minimo'] });
    expect(fila(res, sinStock)).toMatchObject({ existencia: 0, minimo: 1, alertas: ['bajo_minimo', 'sin_existencia'] });
  });

  test('filtro por estado y por búsqueda', async () => {
    const caducados = await get('/api/existencias?estado=caducado', cajero);
    expect(caducados.body.datos.map(f => f.producto.sku)).toEqual(['MED-1']);
    const bajo = await get('/api/existencias?estado=bajo_minimo', cajero);
    expect(bajo.body.datos.map(f => f.producto.sku).sort()).toEqual(['COL-1', 'SIN-1']);
    const busqueda = await get('/api/existencias?q=antibio', cajero);
    expect(busqueda.body.datos.map(f => f.producto.sku)).toEqual(['MED-1']);
    expect((await get('/api/existencias?estado=raro', cajero)).status).toBe(400);
  });

  test('el cajero de A no ve B; el dueño ve ambas o la que elija', async () => {
    const res = await get('/api/existencias', cajero);
    expect(res.body.datos.every(f => f.sucursal.id === String(A._id))).toBe(true);
    expect((await get('/api/existencias', cajero, B)).status).toBe(403);

    const todas = await get('/api/existencias?q=collar', dueno);
    expect(todas.body.datos.map(f => [f.sucursal.nombre, f.existencia])).toEqual([['A', 3], ['B', 20]]);
    const soloB = await get('/api/existencias?q=collar', dueno, B);
    expect(soloB.body.datos.map(f => f.existencia)).toEqual([20]);
  });
});

describe('GET /api/existencias/:id/lotes', () => {
  test('lotes en orden FEFO con estado; el cajero no ve costos, el almacén sí', async () => {
    const res = await get(`/api/existencias/${med._id}/lotes`, cajero);
    expect(res.body.datos.map(l => [l.lote, l.estado, l.cantidad])).toEqual([['CAD', 'caducado', 3], ['PRONTO', 'por_caducar', 4], ['LEJOS', 'vigente', 6]]);
    expect(res.body.datos[1].diasParaCaducar).toBe(10);
    expect(res.body.datos[0].costoUnitario).toBeUndefined();
    const conCosto = await get(`/api/existencias/${med._id}/lotes`, almacen);
    expect(conCosto.body.datos[0].costoUnitario).toBe(5000);
  });
});

describe('POST /api/inventario/ajustes', () => {
  test('entrada del almacén con PIN del dueño: crea el lote y queda en bitácora con quién autorizó', async () => {
    const res = await ajustar(almacen, { tipo: 'entrada', producto: String(collar._id), cantidad: 4, costoUnitario: 950, motivo: 'conteo_fisico', nota: 'Apareció en bodega', autorizacion: pinDueno() });
    expect(res.status).toBe(201);
    expect(res.body.datos.autorizadoPor).toBe(dueno.usuario.nombre);
    const registro = await Auditoria.findOne({ accion: 'inventario.ajuste_entrada', usuario: almacen.usuario._id });
    expect(registro.autorizadoPor).toEqual(dueno.usuario._id);
    expect(registro.sucursal).toEqual(A._id);
    expect(fila(await get('/api/existencias?q=collar', almacen), collar).existencia).toBe(7);
  });

  test('salida de un lote CADUCADO concreto (merma por caducidad)', async () => {
    const res = await ajustar(almacen, { tipo: 'salida', producto: String(med._id), cantidad: 3, capa: String(loteCaducado._id), motivo: 'caducado', autorizacion: pinDueno() });
    expect(res.status).toBe(201);
    const f = fila(await get('/api/existencias?q=antibio', almacen), med);
    expect(f).toMatchObject({ caducado: 0, existencia: 10 });
    expect(f.alertas).not.toContain('caducado');
  });

  test('salida sin lote indicado: FEFO sobre lo vigente', async () => {
    const res = await ajustar(almacen, { tipo: 'salida', producto: String(med._id), cantidad: 1, motivo: 'danado', autorizacion: pinDueno() });
    expect(res.status).toBe(201);
    const lotes = (await get(`/api/existencias/${med._id}/lotes`, almacen)).body.datos;
    expect(lotes.find(l => l.lote === 'PRONTO').cantidad).toBe(3);
  });

  test('salida mayor que la existencia → 409 con mensaje claro', async () => {
    const res = await ajustar(almacen, { tipo: 'salida', producto: String(granel._id), cantidad: 20000, motivo: 'merma', autorizacion: pinDueno() });
    expect(res.status).toBe(409);
    expect(res.body.mensaje).toMatch(/hay 12\.5 kg, se pidieron 20 kg/);
  });

  test('PIN equivocado → 401 y no se registra nada', async () => {
    const antes = await InventoryLayer.countDocuments({ sucursal: A._id, producto: collar._id });
    const res = await ajustar(almacen, { tipo: 'entrada', producto: String(collar._id), cantidad: 1, costoUnitario: 900, motivo: 'otro', autorizacion: { usuario: dueno.usuario.usuario, pin: '0000' } });
    expect(res.status).toBe(401);
    expect(await InventoryLayer.countDocuments({ sucursal: A._id, producto: collar._id })).toBe(antes);
  });

  test('el PIN del médico no autoriza ajustes (403)', async () => {
    const res = await ajustar(almacen, { tipo: 'entrada', producto: String(collar._id), cantidad: 1, costoUnitario: 900, motivo: 'otro', autorizacion: { usuario: medico.usuario.usuario, pin: '7373' } });
    expect(res.status).toBe(403);
  });

  test('cajero y médico no pueden pedir ajustes (403)', async () => {
    for (const s of [cajero, medico]) {
      expect((await ajustar(s, { tipo: 'salida', producto: String(collar._id), cantidad: 1, motivo: 'merma', autorizacion: pinDueno() })).status).toBe(403);
    }
  });

  test('sin X-Sucursal → 400 (también para el dueño)', async () => {
    const res = await ajustar(dueno, { tipo: 'salida', producto: String(collar._id), cantidad: 1, motivo: 'merma', autorizacion: pinDueno() }, null);
    expect(res.status).toBe(400);
  });

  test('validaciones → 400', async () => {
    const base = { producto: String(collar._id), cantidad: 1, autorizacion: pinDueno() };
    const casos = {
      'motivo de salida en una entrada': { ...base, tipo: 'entrada', costoUnitario: 1, motivo: 'merma' },
      'entrada sin costo': { ...base, tipo: 'entrada', motivo: 'otro' },
      'cantidad decimal': { ...base, tipo: 'salida', motivo: 'merma', cantidad: 1.5 },
      'sin autorización': { tipo: 'salida', producto: String(collar._id), cantidad: 1, motivo: 'merma' },
      'medicamento sin lote': { ...base, producto: String(med._id), tipo: 'entrada', costoUnitario: 1, motivo: 'otro', caducidad: '12/2028' },
      'lote de otro producto': { ...base, tipo: 'salida', motivo: 'merma', capa: String(loteCaducado._id) }
    };
    for (const [caso, cuerpo] of Object.entries(casos)) {
      const res = await ajustar(almacen, cuerpo);
      expect({ caso, status: res.status }).toEqual({ caso, status: 400 });
    }
  });
});

describe('GET /api/inventario/movimientos (kárdex)', () => {
  test('muestra entradas y ajustes con quién lo hizo y quién autorizó; costos solo para almacén/dueño', async () => {
    const res = await get(`/api/inventario/movimientos?producto=${collar._id}`, almacen);
    expect(res.status).toBe(200);
    const ajuste = res.body.datos.find(m => m.tipo === 'ajuste');
    expect(ajuste).toMatchObject({ cantidad: 4, motivo: 'conteo_fisico', usuario: almacen.usuario.nombre, autorizadoPor: dueno.usuario.nombre });
    expect(ajuste.costoTotal).toBe(3800);
    const delCajero = await get(`/api/inventario/movimientos?producto=${collar._id}`, cajero);
    expect(delCajero.body.datos[0].costoTotal).toBeUndefined();
  });

  test('filtra por día en hora de Tepic; solo la sucursal del alcance', async () => {
    const hoy = diaLocal();
    const res = await get(`/api/inventario/movimientos?desde=${hoy}&hasta=${hoy}`, cajero);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.datos.every(m => m.sucursal === String(A._id))).toBe(true);
    expect((await get('/api/inventario/movimientos?desde=01-01-2026', cajero)).status).toBe(400);
  });
});

test('no se puede cambiar la unidad de un producto con inventario (409)', async () => {
  const res = await h.request(h.app).patch(`/api/productos/${granel._id}`).set(h.auth(dueno.token)).send({ unidad: 'pieza' });
  expect(res.status).toBe(409);
  const sinInventario = await h.request(h.app).patch(`/api/productos/${sinStock._id}`).set(h.auth(dueno.token)).send({ unidad: 'kg' });
  expect(sinInventario.status).toBe(200);
});

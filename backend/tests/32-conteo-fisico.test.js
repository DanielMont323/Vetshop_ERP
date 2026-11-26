// Conteo físico: foto de existencias, captura ciega (sumar / reemplazar), ventas durante el conteo,
// revisión con diferencias, aplicación con PIN (faltantes y sobrantes por lote), bloqueo de ajustes,
// un conteo abierto por sucursal, cancelación y alerta del tablero.
const h = require('./helpers/app');
const Producto = require('../models/Producto');
const InventoryLayer = require('../models/InventoryLayer');
const InventoryMovement = require('../models/InventoryMovement');
const Sucursal = require('../models/Sucursal');
const inv = require('../services/inventario');
const precios = require('../services/precios');
const { conTransaccion } = require('../helpers/transaccion');
const { Auditoria } = h.modelos;

let A, dueno, almacen, cajero, collar, croqueta, capaCollar1, capaCollar2, capaCroqueta;
const PIN = '4821';

beforeAll(async () => {
  await h.resetDb();
  A = await h.crearSucursal({ nombre: 'A' });
  dueno = await h.sesion({ rol: 'dueno', pin: PIN });
  almacen = await h.sesion({ rol: 'almacen', sucursales: [A._id] });
  cajero = await h.sesion({ rol: 'cajero', sucursales: [A._id] });
  collar = await Producto.create({ sku: 'COL', nombre: 'Collar', categoria: 'accesorio', unidad: 'pieza', iva: 'tasa_16' });
  croqueta = await Producto.create({ sku: 'CRO', nombre: 'Croqueta', categoria: 'alimento', unidad: 'kg', iva: 'tasa_0' });
  await precios.fijarPrecio({ clave: 'publico', productoId: collar._id, precio: 10000 }, dueno.usuario);
  const entrada = (producto, cantidad, extra = {}) =>
    conTransaccion(s => inv.registrarEntrada({ sucursal: A._id, producto: producto._id, cantidad, costoUnitario: 5000, origen: 'compra', usuario: dueno.usuario._id, ...extra }, s));
  capaCollar1 = (await entrada(collar, 10, { lote: 'C1' })).capa;
  capaCollar2 = (await entrada(collar, 5, { lote: 'C2' })).capa;
  capaCroqueta = (await entrada(croqueta, 20000, { lote: 'K1', caducidad: '12/2030' })).capa; // 20 kg a $50/kg
});
afterAll(h.cerrar);

const api = (s, metodo, ruta) => h.request(h.app)[metodo](ruta).set(h.auth(s.token, A));
const pinDueno = () => ({ usuario: dueno.usuario.usuario, pin: PIN });
const renglonDe = (conteo, capa) => conteo.renglones.find(r => String(r.capa) === String(capa._id));

let conteo;

describe('iniciar y capturar', () => {
  test('foto de existencias por lote; el cajero no puede contar; uno abierto por sucursal', async () => {
    expect((await api(cajero, 'post', '/api/conteos').send({})).status).toBe(403);
    const res = await api(almacen, 'post', '/api/conteos').send({ nota: 'Semanal' });
    expect(res.status).toBe(201);
    conteo = res.body.datos;
    expect(conteo).toMatchObject({ folio: 'CF-1', estado: 'en_captura', resumen: { renglones: 3, contados: 0, pendientes: 3 } });
    // Captura ciega: no viaja lo esperado
    expect(conteo.renglones[0]).not.toHaveProperty('esperado');
    expect((await api(almacen, 'post', '/api/conteos').send({})).body.codigo).toBe('CONTEO_EN_CURSO');
  });

  test('con un conteo abierto no se hacen ajustes manuales', async () => {
    const res = await api(almacen, 'post', '/api/inventario/ajustes').send({ tipo: 'salida', producto: String(collar._id), cantidad: 1, motivo: 'merma', autorizacion: pinDueno() });
    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe('CONTEO_EN_CURSO');
  });

  test('sumar (dos personas) y reemplazar (recontar); ni el dueño ve lo esperado en captura', async () => {
    const capt = (renglon, cantidad, modo) => api(almacen, 'post', `/api/conteos/${conteo.id}/capturas`).send({ renglon, cantidad, modo });
    const r1 = renglonDe(conteo, capaCollar1).id;
    expect((await capt(r1, 4)).body.datos.contado).toBe(4);
    expect((await capt(r1, 4)).body.datos.contado).toBe(8);
    expect((await capt(r1, 9, 'reemplazar')).body.datos.contado).toBe(9); // faltante de 1
    expect((await capt(renglonDe(conteo, capaCroqueta).id, 20500)).body.datos.contado).toBe(20500); // sobran 500 g
    const visto = (await api(dueno, 'get', `/api/conteos/${conteo.id}`)).body.datos;
    expect(visto.renglones[0]).not.toHaveProperty('esperado');
    expect(visto.resumen).toMatchObject({ contados: 2, pendientes: 1 });
  });

  test('una salida DESPUÉS de contar un lote no se vuelve diferencia', async () => {
    // Se cuenta el lote C2 completo (5) y después salen 2 de ese lote (como una venta; se simula con una
    // salida directa porque la venta por FEFO tomaría primero el lote C1)
    const r2 = renglonDe(conteo, capaCollar2).id;
    await api(almacen, 'post', `/api/conteos/${conteo.id}/capturas`).send({ renglon: r2, cantidad: 5 });
    await conTransaccion(s => inv.consumirDeCapa({ sucursal: A._id, capaId: capaCollar2._id, cantidad: 2, usuario: dueno.usuario._id, motivo: 'otro', referencia: { modelo: 'Prueba' } }, s));
    expect((await InventoryLayer.findById(capaCollar2._id).setOptions({ sinAlcance: true }).lean()).cantidadRestante).toBe(3);
  });
});

describe('revisión y aplicación', () => {
  test('en revisión el dueño ve las diferencias con su valor a costo; el almacén no', async () => {
    const res = await api(almacen, 'post', `/api/conteos/${conteo.id}/revision`);
    expect(res.body.datos.estado).toBe('en_revision');
    expect(res.body.datos.renglones[0]).not.toHaveProperty('esperado');
    const d = (await api(dueno, 'get', `/api/conteos/${conteo.id}`)).body.datos;
    expect(renglonDe(d, capaCollar1)).toMatchObject({ esperado: 10, contado: 9, diferencia: -1, valor: -5000 });
    expect(renglonDe(d, capaCollar2)).toMatchObject({ esperado: 5, contado: 5, diferencia: 0 });
    expect(renglonDe(d, capaCroqueta)).toMatchObject({ esperado: 20000, contado: 20500, diferencia: 500, valor: 2500 });
    expect(d.resumen).toMatchObject({ conDiferencia: 2, faltante: 5000, sobrante: 2500 });
  });

  test('aplicar: solo dueño con PIN; genera salida y entrada por lote; queda en bitácora', async () => {
    expect((await api(almacen, 'post', `/api/conteos/${conteo.id}/aplicar`).send({ autorizacion: pinDueno() })).status).toBe(403);
    expect((await api(dueno, 'post', `/api/conteos/${conteo.id}/aplicar`).send({ autorizacion: { usuario: dueno.usuario.usuario, pin: '0000' } })).status).toBe(401);
    const res = await api(dueno, 'post', `/api/conteos/${conteo.id}/aplicar`).send({ autorizacion: pinDueno() });
    expect(res.status).toBe(200);
    expect(res.body.datos).toMatchObject({ estado: 'aplicado', aplicacion: { faltante: 5000, sobrante: 2500 } });
    expect(res.body.datos.aplicacion.movimientos).toHaveLength(2);

    const capa1 = await InventoryLayer.findById(capaCollar1._id).setOptions({ sinAlcance: true }).lean();
    expect(capa1.cantidadRestante).toBe(9);
    expect((await InventoryLayer.findById(capaCollar2._id).setOptions({ sinAlcance: true }).lean()).cantidadRestante).toBe(3); // la venta no se tocó
    const entradaCroqueta = await InventoryLayer.findOne({ sucursal: A._id, producto: croqueta._id, origen: 'ajuste_entrada' }).lean();
    expect(entradaCroqueta).toMatchObject({ lote: 'K1', cantidadInicial: 500, costoUnitario: 5000 });
    const movs = await InventoryMovement.find({ sucursal: A._id, 'referencia.id': conteo.id }).lean();
    expect(movs.map(m => [m.motivo, m.cantidad]).sort()).toEqual([['conteo_fisico', -1], ['conteo_fisico', 500]]);
    expect(await Auditoria.exists({ accion: 'conteo.aplicar', entidadId: conteo.id })).toBeTruthy();
    // Ya cerrado: se pueden volver a hacer ajustes
    const ajuste = await api(almacen, 'post', '/api/inventario/ajustes').send({ tipo: 'salida', producto: String(collar._id), cantidad: 1, motivo: 'merma', autorizacion: pinDueno() });
    expect(ajuste.status).toBe(201);
  });
});

describe('no contados, cancelación y tablero', () => {
  test('con renglones sin contar no se aplica, salvo que cuenten como cero', async () => {
    const c = (await api(almacen, 'post', '/api/conteos').send({ categorias: ['alimento'] })).body.datos;
    expect(c.resumen.renglones).toBe(2); // croqueta: lote K1 (20 kg) y el sobrante registrado (500 g)
    const k1 = c.renglones.find(r => r.capa === String(capaCroqueta._id));
    await api(almacen, 'post', `/api/conteos/${c.id}/capturas`).send({ renglon: k1.id, cantidad: 20000 });
    await api(almacen, 'post', `/api/conteos/${c.id}/revision`);
    const sin = await api(dueno, 'post', `/api/conteos/${c.id}/aplicar`).send({ autorizacion: pinDueno() });
    expect(sin.body).toMatchObject({ codigo: 'RENGLONES_SIN_CONTAR', detalles: { pendientes: 1 } });
    // El de 500 g no se encontró: cuenta como cero y sale del inventario
    const ok = await api(dueno, 'post', `/api/conteos/${c.id}/aplicar`).send({ autorizacion: pinDueno(), noContadosEnCero: true });
    expect(ok.body.datos.aplicacion).toMatchObject({ faltante: 2500, sobrante: 0, noContadosEnCero: true });
    const restante = await InventoryLayer.find({ sucursal: A._id, producto: croqueta._id }).lean();
    expect(restante.reduce((s, k) => s + k.cantidadRestante, 0)).toBe(20000);
  });

  test('volver a captura y cancelar: ya no admite capturas', async () => {
    const c = (await api(almacen, 'post', '/api/conteos').send({ categorias: ['accesorio'] })).body.datos;
    await api(almacen, 'post', `/api/conteos/${c.id}/revision`);
    expect((await api(almacen, 'post', `/api/conteos/${c.id}/recaptura`)).body.datos.estado).toBe('en_captura');
    const cancel = await api(almacen, 'post', `/api/conteos/${c.id}/cancelar`).send({ motivo: 'Se repetirá el lunes' });
    expect(cancel.body.datos.estado).toBe('cancelado');
    expect(await Auditoria.exists({ accion: 'conteo.cancelar', entidadId: c.id })).toBeTruthy();
    expect((await api(almacen, 'post', `/api/conteos/${c.id}/capturas`).send({ renglon: c.renglones[0].id, cantidad: 1 })).body.codigo).toBe('CONTEO_CERRADO');
  });

  test('historial con resumen; alerta de sucursales sin conteo en 7 días', async () => {
    const lista = (await api(almacen, 'get', '/api/conteos')).body;
    expect(lista.datos.map(c => c.estado)).toEqual(['cancelado', 'aplicado', 'aplicado']);
    expect(lista.datos[2]).toMatchObject({ folio: 'CF-1', sucursal: { nombre: 'A' } });

    const tablero = async () => (await h.request(h.app).get('/api/reportes/dashboard').set(h.auth(dueno.token))).body.datos.alertas.sucursalesSinConteo;
    expect(await tablero()).toBe(0); // A tiene conteo aplicado hoy
    const B = await h.crearSucursal({ nombre: 'B' });
    await Sucursal.collection.updateOne({ _id: B._id }, { $set: { createdAt: new Date(Date.now() - 10 * 86400000) } });
    expect(await tablero()).toBe(1);
  });

  test('sin existencias que contar: 409', async () => {
    const res = await api(almacen, 'post', '/api/conteos').send({ categorias: ['biologico'] });
    expect(res.body.codigo).toBe('SIN_EXISTENCIAS');
  });
});

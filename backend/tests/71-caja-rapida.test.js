// Caja más rápida: configuración (conceptos y tope), gastos de caja sin PIN hasta el tope, retiros con PIN,
// corte e impresión, alta rápida de clientes y datos de contacto desde la caja.
const h = require('./helpers/app');
const Turno = require('../models/Turno');
const { Auditoria } = h.modelos;

let A, dueno, cajero, almacen, turno;
const PIN = '4821';

beforeAll(async () => {
  await h.resetDb();
  A = await h.crearSucursal({ nombre: 'A' });
  dueno = await h.sesion({ rol: 'dueno', pin: PIN });
  cajero = await h.sesion({ rol: 'cajero', sucursales: [A._id] });
  almacen = await h.sesion({ rol: 'almacen', sucursales: [A._id] });
  turno = await h.abrirTurno(cajero, A, { fondo: 100000 }); // $1,000 de fondo
});
afterAll(h.cerrar);

const api = (s, metodo, ruta) => h.request(h.app)[metodo](ruta).set(h.auth(s.token, A));
const gasto = (cuerpo, s = cajero) => api(s, 'post', `/api/turnos/${turno.id}/retiros`).send({ tipo: 'gasto', ...cuerpo });
const pinDueno = () => ({ usuario: dueno.usuario.usuario, pin: PIN });

describe('configuración', () => {
  test('valores por defecto; solo el dueño la cambia; queda en bitácora', async () => {
    const leida = await api(cajero, 'get', '/api/configuracion');
    expect(leida.body.datos.caja).toEqual({ conceptosGasto: ['Mandadito', 'Garrafón de agua', 'Papelería', 'Limpieza', 'Otro'], topeGastoSinPin: 30000 });
    expect((await api(cajero, 'put', '/api/configuracion').send({ caja: { topeGastoSinPin: 1 } })).status).toBe(403);
    const r = await api(dueno, 'put', '/api/configuracion').send({ caja: { conceptosGasto: ['Mandadito', 'Garrafón de agua', 'Otro'], topeGastoSinPin: 20000 } });
    expect(r.body.datos.caja).toEqual({ conceptosGasto: ['Mandadito', 'Garrafón de agua', 'Otro'], topeGastoSinPin: 20000 });
    expect((await api(dueno, 'put', '/api/configuracion').send({ caja: { conceptosGasto: ['Otro', 'otro'] } })).status).toBe(400);
    expect(await Auditoria.exists({ accion: 'configuracion.actualizar' })).toBeTruthy();
  });
});

describe('gastos de caja', () => {
  test('sin PIN hasta el tope del turno ($200); arriba del tope pide PIN y con PIN pasa', async () => {
    const g1 = await gasto({ concepto: 'Mandadito', monto: 15000, motivo: 'Tortillas para la clínica' });
    expect(g1.status).toBe(201);
    expect(g1.body.datos).toMatchObject({ tipo: 'gasto', concepto: 'Mandadito', motivo: 'Mandadito: Tortillas para la clínica', autorizadoPor: null });
    const sinPin = await gasto({ concepto: 'Garrafón de agua', monto: 6000 });
    expect(sinPin.status).toBe(403);
    expect(sinPin.body).toMatchObject({ codigo: 'AUTORIZACION_REQUERIDA', detalles: { tope: 20000, usado: 15000, disponible: 5000 } });
    expect((await gasto({ concepto: 'Garrafón de agua', monto: 5000 })).status).toBe(201); // justo el tope
    const conPin = await gasto({ concepto: 'Garrafón de agua', monto: 6000, autorizacion: pinDueno() });
    expect(conPin.status).toBe(201);
    expect(conPin.body.datos.autorizadoPor).toBeTruthy();
  });

  test('concepto fuera de la lista: 400; el retiro sigue pidiendo PIN y motivo', async () => {
    expect((await gasto({ concepto: 'Comida', monto: 100 })).status).toBe(400);
    const retiro = cuerpo => api(cajero, 'post', `/api/turnos/${turno.id}/retiros`).send({ monto: 10000, ...cuerpo });
    expect((await retiro({ motivo: 'Banco' })).status).toBe(401); // sin PIN
    expect((await retiro({ motivo: 'B', autorizacion: pinDueno() })).status).toBe(400); // sin motivo
    expect((await retiro({ motivo: 'Depósito al banco', autorizacion: pinDueno() })).status).toBe(201);
  });

  test('salen del efectivo esperado y el corte impreso los separa de los retiros', async () => {
    const t = await Turno.findById(turno.id).setOptions({ sinAlcance: true }).lean();
    expect(t.retiros.map(r => [r.tipo, r.monto])).toEqual([['gasto', 15000], ['gasto', 5000], ['gasto', 6000], ['retiro', 10000]]);
    const visto = await api(dueno, 'get', `/api/turnos/${turno.id}`);
    expect(visto.body.datos.esperado.efectivo).toBe(100000 - 36000);
    expect(await Auditoria.countDocuments({ accion: 'turno.gasto' })).toBe(3);
    // Corte (con diferencia, para que quede «contado» e imprimible)
    await api(cajero, 'post', `/api/turnos/${turno.id}/conteo`).send({ denominaciones: [{ denominacion: 50000, cantidad: 1 }], tarjeta: 0, transferencia: 0 });
    const html = await api(cajero, 'get', `/api/turnos/${turno.id}/corte`);
    expect(html.text).toContain('Gastos de caja');
    expect(html.text).toContain('Mandadito: Tortillas para la clínica');
    expect(html.text).toContain('Retiros');
  });
});

describe('clientes desde la caja', () => {
  let cliente;
  test('alta rápida: queda de público con lista de público; el almacén no puede', async () => {
    const r = await h.request(h.app).post('/api/clientes/rapido').set(h.auth(cajero.token)).send({ nombre: 'Ana López', telefono: '311 123 4567', whatsapp: '3111234567', direccion: 'Av. México 10, Tepic' });
    expect(r.status).toBe(201);
    cliente = r.body.datos;
    expect(cliente).toMatchObject({ tipo: 'publico', listaPrecios: 'publico', whatsapp: '3111234567', direccion: 'Av. México 10, Tepic', credito: { activo: false } });
    expect((await h.request(h.app).post('/api/clientes/rapido').set(h.auth(almacen.token)).send({ nombre: 'X' })).status).toBe(403);
    expect((await h.request(h.app).post('/api/clientes/rapido').set(h.auth(cajero.token)).send({ nombre: 'Y', whatsapp: '123' })).status).toBe(400);
  });

  test('la caja actualiza solo el contacto; no puede tocar crédito ni lista', async () => {
    const r = await h.request(h.app).patch(`/api/clientes/${cliente.id}/contacto`).set(h.auth(cajero.token)).send({ direccion: 'Calle Nueva 5', notas: 'Tiene 2 perros', listaPrecios: 'mayoreo' });
    expect(r.status).toBe(200);
    expect(r.body.datos).toMatchObject({ direccion: 'Calle Nueva 5', notas: 'Tiene 2 perros', listaPrecios: 'publico' });
    expect((await h.request(h.app).patch(`/api/clientes/${cliente.id}`).set(h.auth(cajero.token)).send({ listaPrecios: 'mayoreo' })).status).toBe(403);
    // El directorio busca por dirección o WhatsApp
    const busqueda = await h.request(h.app).get('/api/clientes?q=calle nueva').set(h.auth(cajero.token));
    expect(busqueda.body.datos.map(c => c.nombre)).toEqual(['Ana López']);
    expect(await Auditoria.exists({ accion: 'cliente.contacto', entidadId: cliente.id })).toBeTruthy();
  });
});

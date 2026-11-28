// Paso 23: mascotas de los clientes y recordatorios (cita en su clínica o estética, alimento, vacunas…).
const h = require('./helpers/app');
const Producto = require('../models/Producto');
const Recordatorio = require('../models/Recordatorio');
const { diaLocal } = require('../helpers/fechas');
const { sumarDias } = require('../services/recordatorios');

let A, B, dueno, cajero, cajeroB, almacen, ana, otro, croqueta, firulais, michi;
const hoy = diaLocal();

beforeAll(async () => {
  await h.resetDb();
  A = await h.crearSucursal({ nombre: 'A' });
  B = await h.crearSucursal({ nombre: 'B' });
  dueno = await h.sesion({ rol: 'dueno', pin: '4821' });
  cajero = await h.sesion({ rol: 'cajero', sucursales: [A._id] });
  cajeroB = await h.sesion({ rol: 'cajero', sucursales: [B._id] });
  almacen = await h.sesion({ rol: 'almacen', sucursales: [A._id] });
  croqueta = await Producto.create({ sku: 'CRQ', nombre: 'Croqueta 20 kg', categoria: 'alimento', unidad: 'pieza', iva: 'tasa_0' });
  const alta = nombre => h.request(h.app).post('/api/clientes/rapido').set(h.auth(cajero.token)).send({ nombre, whatsapp: '3111234567' });
  ana = (await alta('Ana (prueba)')).body.datos;
  otro = (await alta('Beto (prueba)')).body.datos;
});
afterAll(h.cerrar);

const api = (s, metodo, ruta, suc = A) => h.request(h.app)[metodo](ruta).set(h.auth(s.token, suc));

describe('mascotas', () => {
  test('la caja registra y edita mascotas; el almacén no; Público en general no', async () => {
    const r = await api(cajero, 'post', '/api/mascotas').send({ cliente: ana.id, nombre: 'Firulais', especie: 'perro', raza: 'Mestizo', nacimiento: '2022-05-10', peso: 12500 });
    expect(r.status).toBe(201);
    firulais = r.body.datos;
    expect(firulais).toMatchObject({ nombre: 'Firulais', especie: 'perro', peso: 12500, nacimiento: '2022-05-10', activa: true });
    michi = (await api(cajero, 'post', '/api/mascotas').send({ cliente: ana.id, nombre: 'Michi', especie: 'gato' })).body.datos;
    expect((await api(almacen, 'post', '/api/mascotas').send({ cliente: ana.id, nombre: 'X', especie: 'perro' })).status).toBe(403);
    expect((await api(cajero, 'post', '/api/mascotas').send({ cliente: ana.id, nombre: 'X', especie: 'dragón' })).status).toBe(400);
    const pg = (await api(cajero, 'get', '/api/clientes')).body.datos.find(c => c.esPublicoGeneral);
    expect((await api(cajero, 'post', '/api/mascotas').send({ cliente: pg.id, nombre: 'X', especie: 'perro' })).status).toBe(400);

    expect((await api(cajero, 'patch', `/api/mascotas/${michi.id}`).send({ activa: false, peso: 4000 })).body.datos).toMatchObject({ activa: false, peso: 4000 });
    const lista = await api(almacen, 'get', `/api/mascotas?cliente=${ana.id}`);
    expect(lista.body.datos.map(m => m.nombre)).toEqual(['Firulais']);
    expect((await api(almacen, 'get', `/api/mascotas?cliente=${ana.id}&todas=true`)).body.datos).toHaveLength(2);
  });
});

describe('recordatorios', () => {
  let cita, alimento;
  test('cita avisa 5 días antes (por defecto); la mascota debe ser del cliente', async () => {
    const r = await api(cajero, 'post', '/api/recordatorios').send({ cliente: ana.id, mascota: firulais.id, tipo: 'cita', descripcion: 'Estética en Patitas', fecha: sumarDias(hoy, 5) });
    expect(r.status).toBe(201);
    cita = r.body.datos;
    expect(cita).toMatchObject({ diasAntes: 5, fechaAviso: hoy, estado: 'pendiente', mascota: { nombre: 'Firulais' }, cliente: { nombre: 'Ana (prueba)', whatsapp: '3111234567' } });
    expect((await api(cajero, 'post', '/api/recordatorios').send({ cliente: otro.id, mascota: firulais.id, tipo: 'cita', descripcion: 'X', fecha: hoy })).status).toBe(400);
    expect((await api(cajero, 'post', '/api/recordatorios').send({ cliente: ana.id, tipo: 'cita', descripcion: 'X', fecha: '2026-02-30' })).status).toBe(400);
  });

  test('alimento cada 30 días: no se duplica, se reprograma', async () => {
    const datos = { cliente: ana.id, mascota: firulais.id, tipo: 'alimento', descripcion: 'Croqueta 20 kg', producto: croqueta._id, fecha: sumarDias(hoy, 30), repetirCadaDias: 30 };
    alimento = (await api(cajero, 'post', '/api/recordatorios').send(datos)).body.datos;
    expect(alimento).toMatchObject({ diasAntes: 3, fechaAviso: sumarDias(hoy, 27), reprogramado: false });
    const otra = await api(cajero, 'post', '/api/recordatorios').send({ ...datos, fecha: sumarDias(hoy, 2) });
    expect(otra.body.datos).toMatchObject({ id: alimento.id, reprogramado: true, fecha: sumarDias(hoy, 2) });
    expect(await Recordatorio.countDocuments({ sucursal: A._id, tipo: 'alimento' })).toBe(1);
  });

  test('vistas: hoy (incluye atrasados), próximos y avisados; cada sucursal ve los suyos', async () => {
    await api(cajero, 'post', '/api/recordatorios').send({ cliente: otro.id, tipo: 'vacuna', descripcion: 'Antirrábica', fecha: sumarDias(hoy, 20), diasAntes: 0 });
    const hoyR = await api(cajero, 'get', '/api/recordatorios?vista=hoy');
    expect(hoyR.body.datos.map(r => r.descripcion)).toEqual(['Croqueta 20 kg', 'Estética en Patitas']); // el atrasado primero
    const prox = await api(cajero, 'get', '/api/recordatorios?vista=proximos');
    expect(prox.body.datos.map(r => r.descripcion)).toEqual(['Antirrábica']);
    expect((await api(cajeroB, 'get', '/api/recordatorios?vista=hoy', B)).body.datos).toEqual([]);
    expect((await api(almacen, 'get', '/api/recordatorios?vista=hoy')).status).toBe(403);
  });

  test('avisado → sale de «hoy»; hecho de uno que se repite programa el siguiente', async () => {
    const av = await api(cajero, 'post', `/api/recordatorios/${alimento.id}/avisado`);
    expect(av.body.datos.estado).toBe('avisado');
    expect((await api(cajero, 'post', `/api/recordatorios/${alimento.id}/avisado`)).status).toBe(409);
    expect((await api(cajero, 'get', '/api/recordatorios?vista=avisados')).body.datos.map(r => r.id)).toEqual([alimento.id]);
    const hecho = await api(cajero, 'post', `/api/recordatorios/${alimento.id}/hecho`);
    expect(hecho.body.datos.estado).toBe('hecho');
    expect(hecho.body.datos.siguiente).toMatchObject({ fecha: sumarDias(hoy, 30), estado: 'pendiente', tipo: 'alimento', mascota: { nombre: 'Firulais' } });
    // La cita no se repite; cancelarla la cierra sin siguiente
    const cancel = await api(cajero, 'post', `/api/recordatorios/${cita.id}/cancelar`);
    expect(cancel.body.datos).toMatchObject({ estado: 'cancelado', siguiente: null });
    expect((await api(cajero, 'patch', `/api/recordatorios/${cita.id}`).send({ fecha: hoy })).status).toBe(409);
  });

  test('cambiar la fecha recalcula el aviso; el historial del cliente', async () => {
    const abiertos = (await api(cajero, 'get', `/api/recordatorios?vista=abiertos&cliente=${otro.id}`)).body.datos;
    const r = await api(cajero, 'patch', `/api/recordatorios/${abiertos[0].id}`).send({ fecha: sumarDias(hoy, 10), diasAntes: 10 });
    expect(r.body.datos).toMatchObject({ fechaAviso: hoy, estado: 'pendiente' });
  });
});

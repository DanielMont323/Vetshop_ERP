// Alcance por sucursal de punta a punta (HTTP): un usuario de la sucursal A no puede leer
// ni escribir datos de la B. Usa la ruta operativa de prueba /api/prueba-notas
// (montada con autenticar + scopeSucursal, igual que las rutas reales).
const h = require('./helpers/app');
const { NotaPrueba, Usuario } = h.modelos;

let A, B, inactiva, notaA, notaB;
let cajeroA, dueno, almacenAB;

beforeAll(async () => {
  await h.resetDb();
  A = await h.crearSucursal({ nombre: 'Sucursal A' });
  B = await h.crearSucursal({ nombre: 'Sucursal B' });
  inactiva = await h.crearSucursal({ nombre: 'Cerrada', activa: false });
  notaA = await NotaPrueba.create({ sucursal: A._id, texto: 'nota A', importe: 100 });
  notaB = await NotaPrueba.create({ sucursal: B._id, texto: 'nota B', importe: 900 });
  cajeroA = await h.sesion({ rol: 'cajero', sucursales: [A._id] });
  almacenAB = await h.sesion({ rol: 'almacen', sucursales: [A._id, B._id] });
  dueno = await h.sesion({ rol: 'dueno' });
});
afterAll(h.cerrar);

const get = (ruta, token, sucursal) => h.request(h.app).get(ruta).set(h.auth(token, sucursal));
const post = (ruta, token, sucursal, cuerpo) => h.request(h.app).post(ruta).set(h.auth(token, sucursal)).send(cuerpo);
const textos = res => res.body.datos.map(n => n.texto);

describe('cajero de la sucursal A', () => {
  test('LEE solo lo de A (sin encabezado: su única sucursal)', async () => {
    const res = await get('/api/prueba-notas', cajeroA.token);
    expect(res.status).toBe(200);
    expect(textos(res)).toEqual(['nota A']);
  });

  test('no puede leer un documento de B por id → 404 (no revela que existe)', async () => {
    expect((await get(`/api/prueba-notas/${notaB._id}`, cajeroA.token)).status).toBe(404);
    expect((await get(`/api/prueba-notas/${notaA._id}`, cajeroA.token)).status).toBe(200);
  });

  test('pedir B con X-Sucursal → 403', async () => {
    expect((await get('/api/prueba-notas', cajeroA.token, B)).status).toBe(403);
  });

  test('los agregados (aggregate) solo suman A', async () => {
    const res = await get('/api/prueba-notas/total', cajeroA.token);
    expect(res.body.datos).toBe(100);
  });

  test('ESCRIBIR en B → 403 y no se crea nada', async () => {
    const antes = await NotaPrueba.countDocuments({ sucursal: B._id });
    expect((await post('/api/prueba-notas', cajeroA.token, B, { texto: 'intrusa' })).status).toBe(403);
    expect(await NotaPrueba.countDocuments({ sucursal: B._id })).toBe(antes);
  });

  test('mandar sucursal: B en el CUERPO no sirve: se guarda en la sucursal activa (A)', async () => {
    const res = await post('/api/prueba-notas', cajeroA.token, A, { texto: 'con truco', sucursal: String(B._id) });
    expect(res.status).toBe(201);
    expect(res.body.datos.sucursal).toBe(String(A._id));
  });

  test('modificar un documento de B (aun con X-Sucursal: A) → 404 y no cambia', async () => {
    const res = await h.request(h.app).patch(`/api/prueba-notas/${notaB._id}`).set(h.auth(cajeroA.token, A)).send({ texto: 'hackeada' });
    expect(res.status).toBe(404);
    expect((await NotaPrueba.findOne({ _id: notaB._id, sucursal: B._id })).texto).toBe('nota B');
  });

  test('escritura SIN X-Sucursal → 400 (aunque solo tenga una sucursal)', async () => {
    const res = await post('/api/prueba-notas', cajeroA.token, null, { texto: 'sin cabecera' });
    expect(res.status).toBe(400);
    expect(res.body.mensaje).toMatch(/X-Sucursal/);
  });

  test('si el dueño le quita A, pierde el acceso en su siguiente petición', async () => {
    const temporal = await h.sesion({ rol: 'cajero', sucursales: [A._id] });
    expect((await get('/api/prueba-notas', temporal.token)).status).toBe(200);
    await Usuario.updateOne({ _id: temporal.usuario._id }, { $set: { sucursales: [B._id] } });
    const res = await get('/api/prueba-notas', temporal.token);
    expect(textos(res)).toEqual(['nota B']);
    expect((await get('/api/prueba-notas', temporal.token, A)).status).toBe(403);
  });
});

describe('dueño', () => {
  test('lee todas sin encabezado, o una sola con X-Sucursal', async () => {
    expect(textos(await get('/api/prueba-notas', dueno.token))).toEqual(expect.arrayContaining(['nota A', 'nota B']));
    const soloB = await get('/api/prueba-notas', dueno.token, B);
    expect(new Set(textos(soloB))).toEqual(new Set(['nota B']));
    expect((await get('/api/prueba-notas/total', dueno.token, B)).body.datos).toBe(900);
  });

  test('toda escritura exige X-Sucursal explícito: sin él → 400', async () => {
    const res = await post('/api/prueba-notas', dueno.token, null, { texto: 'del dueño' });
    expect(res.status).toBe(400);
    const ok = await post('/api/prueba-notas', dueno.token, B, { texto: 'del dueño en B' });
    expect(ok.status).toBe(201);
    expect(ok.body.datos.sucursal).toBe(String(B._id));
  });
});

describe('usuario con varias sucursales (almacén en A y B)', () => {
  test('sin encabezado lee las dos; con encabezado, solo la elegida', async () => {
    expect(textos(await get('/api/prueba-notas', almacenAB.token))).toEqual(expect.arrayContaining(['nota A', 'nota B']));
    expect(textos(await get('/api/prueba-notas', almacenAB.token, A))).not.toContain('nota B');
  });
});

describe('encabezado X-Sucursal', () => {
  test('id mal formado → 400; inexistente → 404 (dueño) o 403 (ajena)', async () => {
    expect((await get('/api/prueba-notas', dueno.token, 'no-es-id')).status).toBe(400);
    expect((await get('/api/prueba-notas', dueno.token, '64b7f0c2a1b2c3d4e5f60718')).status).toBe(404);
    expect((await get('/api/prueba-notas', cajeroA.token, '64b7f0c2a1b2c3d4e5f60718')).status).toBe(403);
  });

  test('sucursal desactivada: se puede consultar, no escribir', async () => {
    expect((await get('/api/prueba-notas', dueno.token, inactiva)).status).toBe(200);
    expect((await post('/api/prueba-notas', dueno.token, inactiva, { texto: 'x' })).status).toBe(403);
  });

  test('sin sesión → 401 antes de mirar la sucursal', async () => {
    expect((await h.request(h.app).get('/api/prueba-notas').set('X-Sucursal', String(A._id))).status).toBe(401);
  });

  test('el permiso se sigue exigiendo dentro del alcance', async () => {
    // La ruta de prueba pide existencias:ver, que tienen los 4 roles; un rol fuera de la matriz no pasa.
    const raro = await h.crearUsuario({ rol: 'cajero', sucursales: [A._id] });
    await Usuario.collection.updateOne({ _id: raro._id }, { $set: { rol: 'invitado' } });
    const token = require('../middleware/auth').generarToken({ _id: raro._id, versionToken: 0 });
    expect((await get('/api/prueba-notas', token, A)).status).toBe(403);
  });
});

describe('GET /api/sucursales también respeta el alcance', () => {
  test('el cajero solo ve la suya; la ajena por id → 404', async () => {
    const lista = await get('/api/sucursales', cajeroA.token);
    expect(lista.body.datos.map(s => s.nombre)).toEqual(['Sucursal A']);
    expect((await get(`/api/sucursales/${B._id}`, cajeroA.token)).status).toBe(404);
  });

  test('el dueño ve todas (las inactivas solo si las pide)', async () => {
    const activas = await get('/api/sucursales', dueno.token);
    expect(activas.body.datos.map(s => s.nombre)).toEqual(['Sucursal A', 'Sucursal B']);
    const todas = await get('/api/sucursales?incluirInactivas=true', dueno.token);
    expect(todas.body.datos).toHaveLength(3);
  });

  test('solo el dueño crea y modifica sucursales; queda en bitácora', async () => {
    expect((await post('/api/sucursales', cajeroA.token, null, { nombre: 'Nueva', tipo: 'tienda' })).status).toBe(403);
    const res = await post('/api/sucursales', dueno.token, null, { nombre: 'Almacén general', tipo: 'almacen' });
    expect(res.status).toBe(201);
    expect((await post('/api/sucursales', dueno.token, null, { nombre: 'ALMACÉN GENERAL', tipo: 'almacen' })).status).toBe(409);
    expect((await post('/api/sucursales', dueno.token, null, { nombre: 'X', tipo: 'bodega' })).status).toBe(400);
    const patch = await h.request(h.app).patch(`/api/sucursales/${res.body.datos.id}`).set(h.auth(dueno.token)).send({ activa: false });
    expect(patch.status).toBe(200);
    expect(await h.modelos.Auditoria.countDocuments({ entidad: 'Sucursal', entidadId: res.body.datos.id })).toBe(2);
  });
});

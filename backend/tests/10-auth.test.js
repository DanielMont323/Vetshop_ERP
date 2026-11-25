// Login, bloqueo por intentos (en BD), sesión invalidada al cambiar contraseña y PIN propio.
const h = require('./helpers/app');
const { Usuario, Auditoria } = h.modelos;

let sucursal;
beforeAll(async () => {
  await h.resetDb();
  sucursal = await h.crearSucursal({ nombre: 'Centro' });
});
afterAll(h.cerrar);

describe('POST /api/auth/login', () => {
  test('credenciales correctas → token y perfil con sucursales y permisos (sin hashes)', async () => {
    const u = await h.crearUsuario({ rol: 'cajero', sucursales: [sucursal._id] });
    const res = await h.login(u);
    expect(res.status).toBe(200);
    expect(res.body.datos.token).toEqual(expect.any(String));
    const perfil = res.body.datos.usuario;
    expect(perfil).toMatchObject({ usuario: u.usuario, rol: 'cajero' });
    expect(perfil.sucursales).toEqual([{ id: String(sucursal._id), nombre: 'Centro', tipo: 'tienda' }]);
    expect(perfil.permisos).toContain('ventas:cobrar');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|pinHash/);
  });

  test('el usuario no distingue mayúsculas ni espacios', async () => {
    const u = await h.crearUsuario({ rol: 'cajero', sucursales: [sucursal._id] });
    const res = await h.login(`  ${u.usuario.toUpperCase()} `);
    expect(res.status).toBe(200);
  });

  test('contraseña incorrecta y usuario inexistente dan el MISMO mensaje', async () => {
    const u = await h.crearUsuario({ rol: 'cajero', sucursales: [sucursal._id] });
    const mala = await h.login(u, 'otra-cosa-123');
    const inexistente = await h.login('no.existe', 'otra-cosa-123');
    expect(mala.status).toBe(401);
    expect(inexistente.status).toBe(401);
    expect(mala.body.mensaje).toBe(inexistente.body.mensaje);
  });

  test('faltan campos → 400', async () => {
    const res = await h.request(h.app).post('/api/auth/login').send({ usuario: 'x' });
    expect(res.status).toBe(400);
    const res2 = await h.request(h.app).post('/api/auth/login').send({ usuario: { $gt: '' }, password: 'x' });
    expect(res2.status).toBe(400); // inyección de operadores rechazada por la validación
  });

  test('usuario desactivado no entra', async () => {
    const u = await h.crearUsuario({ rol: 'cajero', sucursales: [sucursal._id], activo: false });
    expect((await h.login(u)).status).toBe(401);
  });

  test('5 intentos fallidos bloquean 15 min (contador en la BD), incluso con la contraseña correcta', async () => {
    const u = await h.crearUsuario({ rol: 'cajero', sucursales: [sucursal._id] });
    for (let i = 1; i <= 4; i++) {
      const r = await h.login(u, 'mala-contrasena');
      expect(r.status).toBe(401);
      expect((await Usuario.findById(u._id)).intentosFallidos).toBe(i);
    }
    const quinto = await h.login(u, 'mala-contrasena');
    expect(quinto.status).toBe(429);
    expect(quinto.body.mensaje).toMatch(/bloqueada/i);

    const bloqueado = await Usuario.findById(u._id);
    const minutos = (bloqueado.bloqueadoHasta - Date.now()) / 60000;
    expect(minutos).toBeGreaterThan(14);
    expect(minutos).toBeLessThanOrEqual(15);

    expect((await h.login(u)).status).toBe(429);

    // Pasado el bloqueo, entra y el contador se limpia
    await Usuario.updateOne({ _id: u._id }, { $set: { bloqueadoHasta: new Date(Date.now() - 1000) } });
    expect((await h.login(u)).status).toBe(200);
    const limpio = await Usuario.findById(u._id);
    expect(limpio.intentosFallidos).toBe(0);
    expect(limpio.bloqueadoHasta).toBeUndefined();
  });

  test('intentos simultáneos no se pierden (incremento atómico)', async () => {
    const u = await h.crearUsuario({ rol: 'cajero', sucursales: [sucursal._id] });
    await Promise.all([1, 2, 3].map(() => h.login(u, 'mala-contrasena')));
    expect((await Usuario.findById(u._id)).intentosFallidos).toBe(3);
  });
});

describe('sesión', () => {
  test('GET /api/auth/me con y sin token', async () => {
    const { token } = await h.sesion({ rol: 'almacen', sucursales: [sucursal._id] });
    const ok = await h.request(h.app).get('/api/auth/me').set(h.auth(token));
    expect(ok.status).toBe(200);
    expect(ok.body.datos.rol).toBe('almacen');
    expect((await h.request(h.app).get('/api/auth/me')).status).toBe(401);
    expect((await h.request(h.app).get('/api/auth/me').set({ Authorization: 'Bearer basura' })).status).toBe(401);
  });

  test('token firmado con otro secreto o con alg none → 401', async () => {
    const jwt = require('jsonwebtoken');
    const u = await h.crearUsuario({ rol: 'cajero', sucursales: [sucursal._id] });
    const ajeno = jwt.sign({ sub: String(u._id), v: 0 }, 'otro-secreto');
    const sinFirma = jwt.sign({ sub: String(u._id), v: 0 }, null, { algorithm: 'none' });
    for (const t of [ajeno, sinFirma]) {
      expect((await h.request(h.app).get('/api/auth/me').set(h.auth(t))).status).toBe(401);
    }
  });

  test('token vencido → 401 con mensaje de sesión expirada', async () => {
    const jwt = require('jsonwebtoken');
    const u = await h.crearUsuario({ rol: 'cajero', sucursales: [sucursal._id] });
    const vencido = jwt.sign({ sub: String(u._id), v: 0, exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET);
    const res = await h.request(h.app).get('/api/auth/me').set(h.auth(vencido));
    expect(res.status).toBe(401);
    expect(res.body.mensaje).toMatch(/expiró/);
  });
});

describe('PUT /api/auth/password', () => {
  test('cambia la contraseña e invalida TODAS las sesiones anteriores', async () => {
    const u = await h.crearUsuario({ rol: 'cajero', sucursales: [sucursal._id] });
    const caja = (await h.login(u)).body.datos.token;
    const celular = (await h.login(u)).body.datos.token;

    const res = await h.request(h.app).put('/api/auth/password').set(h.auth(caja))
      .send({ actual: h.PASSWORD, nueva: 'Nueva-Clave-789' });
    expect(res.status).toBe(200);
    const nuevo = res.body.datos.token;

    expect((await h.request(h.app).get('/api/auth/me').set(h.auth(caja))).status).toBe(401);
    expect((await h.request(h.app).get('/api/auth/me').set(h.auth(celular))).status).toBe(401);
    expect((await h.request(h.app).get('/api/auth/me').set(h.auth(nuevo))).status).toBe(200);

    expect((await h.login(u, h.PASSWORD)).status).toBe(401);
    expect((await h.login(u, 'Nueva-Clave-789')).status).toBe(200);

    const bitacora = await Auditoria.find({ entidadId: u._id, accion: 'usuario.cambiar_password' });
    expect(bitacora).toHaveLength(1);
    expect(JSON.stringify(bitacora)).not.toMatch(/Nueva-Clave/);
  });

  test('contraseña actual incorrecta, nueva corta o igual → 400', async () => {
    const { token } = await h.sesion({ rol: 'cajero', sucursales: [sucursal._id] });
    const put = body => h.request(h.app).put('/api/auth/password').set(h.auth(token)).send(body);
    expect((await put({ actual: 'incorrecta', nueva: 'Nueva-Clave-789' })).status).toBe(400);
    expect((await put({ actual: h.PASSWORD, nueva: 'corta' })).status).toBe(400);
    expect((await put({ actual: h.PASSWORD, nueva: h.PASSWORD })).status).toBe(400);
  });
});

describe('PUT /api/auth/pin', () => {
  test('el dueño define su PIN confirmando su contraseña; queda cifrado', async () => {
    const { usuario, token } = await h.sesion({ rol: 'dueno' });
    const res = await h.request(h.app).put('/api/auth/pin').set(h.auth(token)).send({ password: h.PASSWORD, pin: '4821' });
    expect(res.status).toBe(200);
    const guardado = await Usuario.findById(usuario._id).select('+pinHash');
    expect(guardado.pinHash).toMatch(/^\$2[aby]\$/);
    expect(await guardado.compararPin('4821')).toBe(true);
  });

  test('contraseña incorrecta → 400; PIN con letras → 400; cajero → 403', async () => {
    const dueno = await h.sesion({ rol: 'dueno' });
    const put = (token, body) => h.request(h.app).put('/api/auth/pin').set(h.auth(token)).send(body);
    expect((await put(dueno.token, { password: 'mala', pin: '1234' })).status).toBe(400);
    expect((await put(dueno.token, { password: h.PASSWORD, pin: '12ab' })).status).toBe(400);
    const cajero = await h.sesion({ rol: 'cajero', sucursales: [sucursal._id] });
    expect((await put(cajero.token, { password: h.PASSWORD, pin: '1234' })).status).toBe(403);
  });
});

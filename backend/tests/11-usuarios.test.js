// Gestión de usuarios (solo dueño) y bitácora de cada cambio.
const h = require('./helpers/app');
const { Usuario, Auditoria } = h.modelos;

let centro, norte, dueno;
beforeAll(async () => {
  await h.resetDb();
  centro = await h.crearSucursal({ nombre: 'Centro' });
  norte = await h.crearSucursal({ nombre: 'Norte' });
  dueno = await h.sesion({ rol: 'dueno' });
});
afterAll(h.cerrar);

const api = (metodo, ruta, token = dueno.token) => h.request(h.app)[metodo](ruta).set(h.auth(token));

describe('acceso', () => {
  test('cajero, almacén y médico no pueden gestionar usuarios (403)', async () => {
    for (const rol of ['cajero', 'almacen', 'medico_responsable']) {
      const s = await h.sesion({ rol, sucursales: [centro._id] });
      expect((await api('get', '/api/usuarios', s.token)).status).toBe(403);
      expect((await api('post', '/api/usuarios', s.token).send({})).status).toBe(403);
    }
  });
  test('sin sesión → 401', async () => {
    expect((await h.request(h.app).get('/api/usuarios')).status).toBe(401);
  });
});

describe('POST /api/usuarios', () => {
  const base = { nombre: 'Ana Cajera', password: 'Clave-Segura-1', rol: 'cajero' };

  test('crea un cajero con sucursal; no devuelve hashes; queda en bitácora', async () => {
    const res = await api('post', '/api/usuarios').send({ ...base, usuario: 'Ana.Caja', sucursales: [String(centro._id)] });
    expect(res.status).toBe(201);
    expect(res.body.datos).toMatchObject({ usuario: 'ana.caja', rol: 'cajero', sucursales: [String(centro._id)] });
    expect(JSON.stringify(res.body)).not.toMatch(/Hash|Clave-Segura/);
    expect((await h.login('ana.caja', 'Clave-Segura-1')).status).toBe(200);

    const registro = await Auditoria.findOne({ accion: 'usuario.crear', entidadId: res.body.datos.id });
    expect(registro.usuario).toEqual(dueno.usuario._id);
    expect(JSON.stringify(registro.despues)).not.toMatch(/Hash/);
  });

  test('usuario repetido → 409', async () => {
    await api('post', '/api/usuarios').send({ ...base, usuario: 'repetido', sucursales: [String(centro._id)] });
    const res = await api('post', '/api/usuarios').send({ ...base, usuario: 'REPETIDO', sucursales: [String(centro._id)] });
    expect(res.status).toBe(409);
  });

  test('validaciones → 400', async () => {
    const casos = [
      { ...base, usuario: 'sin.sucursal' }, // cajero sin sucursal
      { ...base, usuario: 'suc.falsa', sucursales: ['64b7f0c2a1b2c3d4e5f60718'] }, // sucursal inexistente
      { ...base, usuario: 'suc.mala', sucursales: ['no-es-id'] },
      { ...base, usuario: 'rol.malo', rol: 'admin', sucursales: [String(centro._id)] },
      { ...base, usuario: 'corta', password: '123', sucursales: [String(centro._id)] },
      { ...base, usuario: 'con espacios', sucursales: [String(centro._id)] },
      { ...base, usuario: 'cajero.pin', pin: '1234', sucursales: [String(centro._id)] } // cajero no usa PIN
    ];
    for (const cuerpo of casos) {
      const res = await api('post', '/api/usuarios').send(cuerpo);
      expect({ cuerpo: cuerpo.usuario, status: res.status }).toEqual({ cuerpo: cuerpo.usuario, status: 400 });
    }
  });

  test('crea un médico responsable con PIN y un dueño sin sucursales', async () => {
    const medico = await api('post', '/api/usuarios').send({ ...base, usuario: 'dra.lopez', rol: 'medico_responsable', pin: '9090', sucursales: [String(norte._id)] });
    expect(medico.status).toBe(201);
    const guardado = await Usuario.findById(medico.body.datos.id).select('+pinHash');
    expect(await guardado.compararPin('9090')).toBe(true);

    const otroDueno = await api('post', '/api/usuarios').send({ ...base, usuario: 'socio', rol: 'dueno', sucursales: [String(centro._id)] });
    expect(otroDueno.status).toBe(201);
    expect(otroDueno.body.datos.sucursales).toEqual([]); // el dueño ve todas: su lista no se usa
  });
});

describe('PATCH /api/usuarios/:id', () => {
  test('desactivar cierra sus sesiones al instante', async () => {
    const cajero = await h.sesion({ rol: 'cajero', sucursales: [centro._id] });
    expect((await api('get', '/api/auth/me', cajero.token)).status).toBe(200);
    const res = await api('patch', `/api/usuarios/${cajero.usuario._id}`).send({ activo: false });
    expect(res.status).toBe(200);
    expect((await api('get', '/api/auth/me', cajero.token)).status).toBe(401);
    expect((await h.login(cajero.usuario)).status).toBe(401);
  });

  test('cambio de sucursales queda en bitácora con antes y después', async () => {
    const u = await h.crearUsuario({ rol: 'almacen', sucursales: [centro._id] });
    const res = await api('patch', `/api/usuarios/${u._id}`).send({ sucursales: [String(centro._id), String(norte._id)] });
    expect(res.status).toBe(200);
    const registro = await Auditoria.findOne({ accion: 'usuario.actualizar', entidadId: u._id });
    expect(registro.antes.sucursales.map(String)).toEqual([String(centro._id)]);
    expect(registro.despues.sucursales.map(String)).toEqual([String(centro._id), String(norte._id)]);
  });

  test('pasar a cajero borra el PIN', async () => {
    const medico = await h.crearUsuario({ rol: 'medico_responsable', sucursales: [centro._id], pin: '1111' });
    await api('patch', `/api/usuarios/${medico._id}`).send({ rol: 'cajero' });
    const guardado = await Usuario.findById(medico._id).select('+pinHash');
    expect(guardado.pinHash).toBeUndefined();
  });

  test('el dueño no puede desactivarse ni cambiarse el rol a sí mismo', async () => {
    expect((await api('patch', `/api/usuarios/${dueno.usuario._id}`).send({ activo: false })).status).toBe(400);
    expect((await api('patch', `/api/usuarios/${dueno.usuario._id}`).send({ rol: 'cajero', sucursales: [String(centro._id)] })).status).toBe(400);
  });

  test('desactivar a otro dueño se permite si queda uno; quitar al último dueño activo → 409', async () => {
    const otro = await h.crearUsuario({ rol: 'dueno' });
    expect((await api('patch', `/api/usuarios/${otro._id}`).send({ activo: false })).status).toBe(200);

    // Escenario: "dueno" es el único dueño activo y otra persona (p. ej. un script) intenta quitarlo
    await Usuario.updateMany({ rol: 'dueno', _id: { $ne: dueno.usuario._id } }, { $set: { activo: false } });
    const svc = require('../services/usuarios');
    const actor = { _id: otro._id };
    await expect(svc.actualizar(dueno.usuario._id, { activo: false }, actor)).rejects.toMatchObject({ status: 409 });
    await expect(svc.actualizar(dueno.usuario._id, { rol: 'cajero', sucursales: [String(centro._id)] }, actor))
      .rejects.toMatchObject({ status: 409 });
    expect((await Usuario.findById(dueno.usuario._id)).activo).toBe(true);
  });

  test('id inválido → 400; inexistente → 404; campo booleano como texto → 400', async () => {
    expect((await api('patch', '/api/usuarios/xyz').send({ nombre: 'x' })).status).toBe(400);
    expect((await api('patch', '/api/usuarios/64b7f0c2a1b2c3d4e5f60718').send({ nombre: 'x' })).status).toBe(404);
    const u = await h.crearUsuario({ rol: 'cajero', sucursales: [centro._id] });
    expect((await api('patch', `/api/usuarios/${u._id}`).send({ activo: 'false' })).status).toBe(400);
  });
});

describe('PUT /api/usuarios/:id/password', () => {
  test('restablece, desbloquea y cierra las sesiones del usuario', async () => {
    const cajero = await h.sesion({ rol: 'cajero', sucursales: [centro._id] });
    await Usuario.updateOne({ _id: cajero.usuario._id }, { $set: { bloqueadoHasta: new Date(Date.now() + 600000), intentosFallidos: 3 } });
    const res = await api('put', `/api/usuarios/${cajero.usuario._id}/password`).send({ nueva: 'Restablecida-1' });
    expect(res.status).toBe(200);
    expect((await api('get', '/api/auth/me', cajero.token)).status).toBe(401);
    expect((await h.login(cajero.usuario, 'Restablecida-1')).status).toBe(200);
    expect(await Auditoria.countDocuments({ accion: 'usuario.restablecer_password', entidadId: cajero.usuario._id })).toBe(1);
  });
});

describe('GET /api/usuarios', () => {
  test('lista sin hashes; los inactivos solo con incluirInactivos', async () => {
    const res = await api('get', '/api/usuarios');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/Hash/);
    expect(res.body.datos.every(u => u.activo)).toBe(true);
    const todos = await api('get', '/api/usuarios?incluirInactivos=true');
    expect(todos.body.datos.some(u => !u.activo)).toBe(true);
  });
});

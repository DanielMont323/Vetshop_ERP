// PIN de autorización (dueño y médico responsable) con bloqueo propio en la BD.
const h = require('./helpers/app');
const { verificarPin, MAX_INTENTOS_PIN } = require('../services/autorizaciones');
const { Usuario } = h.modelos;

let centro, norte;
beforeAll(async () => {
  await h.resetDb();
  centro = await h.crearSucursal({ nombre: 'Centro' });
  norte = await h.crearSucursal({ nombre: 'Norte' });
});
afterAll(h.cerrar);

test('PIN correcto del dueño autoriza un descuento', async () => {
  const dueno = await h.crearUsuario({ rol: 'dueno', pin: '4821' });
  const r = await verificarPin({ usuario: dueno.usuario, pin: '4821', permiso: 'autorizar:descuento', sucursal: centro._id });
  expect(r).toMatchObject({ rol: 'dueno', nombre: dueno.nombre });
  expect(r.id).toEqual(dueno._id);
});

test('PIN incorrecto → 401 y cuenta el intento; 5 seguidos bloquean el PIN (no la cuenta)', async () => {
  const dueno = await h.crearUsuario({ rol: 'dueno', pin: '4821' });
  const intentar = pin => verificarPin({ usuario: dueno.usuario, pin, permiso: 'autorizar:cancelacion' });
  for (let i = 1; i < MAX_INTENTOS_PIN; i++) {
    await expect(intentar('0000')).rejects.toMatchObject({ status: 401 });
    expect((await Usuario.findById(dueno._id)).intentosPinFallidos).toBe(i);
  }
  await expect(intentar('0000')).rejects.toMatchObject({ status: 429 });
  await expect(intentar('4821')).rejects.toMatchObject({ status: 429 }); // bloqueado aunque sea el correcto
  expect((await h.login(dueno)).status).toBe(200); // la sesión normal sigue funcionando
});

test('un acierto reinicia el contador de fallos', async () => {
  const dueno = await h.crearUsuario({ rol: 'dueno', pin: '4821' });
  await expect(verificarPin({ usuario: dueno.usuario, pin: '1111', permiso: 'autorizar:descuento' })).rejects.toBeTruthy();
  await verificarPin({ usuario: dueno.usuario, pin: '4821', permiso: 'autorizar:descuento' });
  expect((await Usuario.findById(dueno._id)).intentosPinFallidos).toBe(0);
});

test('médico responsable: valida recetas en SU sucursal; no autoriza descuentos', async () => {
  const medico = await h.crearUsuario({ rol: 'medico_responsable', sucursales: [centro._id], pin: '7373' });
  const base = { usuario: medico.usuario, pin: '7373' };
  await expect(verificarPin({ ...base, permiso: 'recetas:validar', sucursal: centro._id })).resolves.toMatchObject({ rol: 'medico_responsable' });
  await expect(verificarPin({ ...base, permiso: 'recetas:validar', sucursal: norte._id })).rejects.toMatchObject({ status: 403 });
  await expect(verificarPin({ ...base, permiso: 'autorizar:descuento' })).rejects.toMatchObject({ status: 403 });
});

test('cajero, usuario inexistente, dueño sin PIN o inactivo → 401 con el mismo mensaje', async () => {
  const cajero = await h.crearUsuario({ rol: 'cajero', sucursales: [centro._id] });
  const sinPin = await h.crearUsuario({ rol: 'dueno' });
  const inactivo = await h.crearUsuario({ rol: 'dueno', pin: '5555', activo: false });
  const mensajes = new Set();
  for (const [usuario, pin] of [[cajero.usuario, '1234'], ['nadie', '1234'], [sinPin.usuario, '1234'], [inactivo.usuario, '5555']]) {
    const error = await verificarPin({ usuario, pin, permiso: 'autorizar:descuento' }).catch(e => e);
    expect(error.status).toBe(401);
    mensajes.add(error.message);
  }
  expect(mensajes.size).toBe(1);
});

test('permiso con errata → error de programación (no se autoriza nada)', async () => {
  await expect(verificarPin({ usuario: 'x', pin: '1', permiso: 'autorizar:descuentos' })).rejects.toThrow(/desconocido/);
});

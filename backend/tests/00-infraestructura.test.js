// Infraestructura: Mongo en memoria con réplica, transacciones, errores, CORS y encabezados.
const mongoose = require('mongoose');
const h = require('./helpers/app');
const { conTransaccion } = require('../helpers/transaccion');

// Modelo solo para estas pruebas
const Prueba = mongoose.models.PruebaInfra || mongoose.model('PruebaInfra', new mongoose.Schema({ nombre: String }));

beforeAll(h.resetDb);
afterAll(h.cerrar);

test('la guardia apunta al Mongo en memoria', () => {
  expect(process.env.MONGODB_URI).toMatch(/^mongodb:\/\/127\.0\.0\.1:\d+\/vetshop-pruebas\?/);
  expect(mongoose.connection.name).toBe('vetshop-pruebas');
});

test('GET /api/salud responde y lleva encabezados de seguridad', async () => {
  const res = await h.request(h.app).get('/api/salud');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['x-powered-by']).toBeUndefined();
});

test('ruta inexistente → 404 JSON', async () => {
  const res = await h.request(h.app).get('/api/no-existe');
  expect(res.status).toBe(404);
  expect(res.body).toMatchObject({ ok: false, codigo: 'RUTA_NO_ENCONTRADA' });
});

test('JSON mal formado → 400 JSON', async () => {
  const res = await h.request(h.app).post('/api/no-existe').set('Content-Type', 'application/json').send('{"a":');
  expect(res.status).toBe(400);
  expect(res.body.codigo).toBe('JSON_INVALIDO');
});

test('CORS: permite el origen configurado y no otros', async () => {
  const bueno = await h.request(h.app).get('/api/salud').set('Origin', 'http://localhost:5173');
  expect(bueno.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  const malo = await h.request(h.app).get('/api/salud').set('Origin', 'https://sitio-ajeno.com');
  expect(malo.headers['access-control-allow-origin']).toBeUndefined();
});

test('CORS: un «*» acepta las direcciones de cada despliegue de Vercel, y nada más', async () => {
  const { crearApp } = require('../app');
  const antes = process.env.CORS_ORIGINS;
  process.env.CORS_ORIGINS = 'https://vetshop-web.vercel.app, https://vetshop-*-noctra15.vercel.app';
  const app = crearApp();
  process.env.CORS_ORIGINS = antes;
  const origen = async o => (await h.request(app).get('/api/salud').set('Origin', o)).headers['access-control-allow-origin'];
  expect(await origen('https://vetshop-web.vercel.app')).toBe('https://vetshop-web.vercel.app');
  expect(await origen('https://vetshop-dqietwc28-noctra15.vercel.app')).toBe('https://vetshop-dqietwc28-noctra15.vercel.app');
  expect(await origen('https://vetshop-x-noctra15.vercel.app.malo.com')).toBeUndefined();
  expect(await origen('https://otro-dqietwc28-noctra15.vercel.app')).toBeUndefined();
  expect(await origen('https://vetshop-a.b-noctra15.vercel.app')).toBeUndefined();
});

test('CORS: la petición previa (preflight) del navegador permite los encabezados que manda el frontend', async () => {
  // Los encabezados que pone frontend/src/services/api.js
  const res = await h.request(h.app)
    .options('/api/auth/login')
    .set('Origin', 'http://localhost:5173')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'content-type,authorization,x-sucursal');
  expect(res.status).toBe(204);
  const permitidos = res.headers['access-control-allow-headers'].toLowerCase().split(',').map(s => s.trim());
  expect(permitidos).toEqual(expect.arrayContaining(['content-type', 'authorization', 'x-sucursal']));
});

test('las respuestas de la API no se guardan en caché', async () => {
  const res = await h.request(h.app).get('/api/no-existe');
  expect(res.headers['cache-control']).toBe('no-store');
});

describe('transacciones (réplica)', () => {
  test('confirma si todo sale bien', async () => {
    await conTransaccion(async session => {
      await Prueba.create([{ nombre: 'a' }, { nombre: 'b' }], { session, ordered: true });
    });
    expect(await Prueba.countDocuments({ nombre: { $in: ['a', 'b'] } })).toBe(2);
  });

  test('revierte todo si algo falla a la mitad', async () => {
    await expect(
      conTransaccion(async session => {
        await Prueba.create([{ nombre: 'c' }], { session });
        throw new Error('falla a la mitad');
      })
    ).rejects.toThrow('falla a la mitad');
    expect(await Prueba.countDocuments({ nombre: 'c' })).toBe(0);
  });
});

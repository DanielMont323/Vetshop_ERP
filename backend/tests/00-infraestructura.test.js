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

// La bitácora solo se inserta: no se puede modificar ni borrar desde la aplicación.
const mongoose = require('mongoose');
const h = require('./helpers/app');
const { Auditoria } = h.modelos;
const { registrar } = require('../services/auditoria');
const { conTransaccion } = require('../helpers/transaccion');

beforeAll(h.resetDb);
afterAll(h.cerrar);

const actor = new mongoose.Types.ObjectId();

test('registra dentro de una transacción y se revierte con ella', async () => {
  await expect(
    conTransaccion(async session => {
      await registrar({ usuario: actor, accion: 'prueba.revertida', entidad: 'Prueba' }, session);
      throw new Error('falla');
    })
  ).rejects.toThrow('falla');
  expect(await Auditoria.countDocuments({ accion: 'prueba.revertida' })).toBe(0);

  await conTransaccion(session => registrar({ usuario: actor, accion: 'prueba.ok', entidad: 'Prueba', antes: { a: 1 }, despues: { a: 2 } }, session));
  const r = await Auditoria.findOne({ accion: 'prueba.ok' });
  expect(r.antes).toEqual({ a: 1 });
  expect(r.fecha).toBeInstanceOf(Date);
});

test('no se puede editar ni borrar', async () => {
  const r = await registrar({ usuario: actor, accion: 'prueba.inmutable', entidad: 'Prueba' });
  await expect(Auditoria.updateOne({ _id: r._id }, { accion: 'otra' })).rejects.toThrow(/bitácora/);
  await expect(Auditoria.deleteMany({})).rejects.toThrow(/bitácora/);
  await expect(Auditoria.findOneAndDelete({ _id: r._id })).rejects.toThrow(/bitácora/);
  r.accion = 'otra';
  await expect(r.save()).rejects.toThrow(/bitácora/);
  expect((await Auditoria.findById(r._id)).accion).toBe('prueba.inmutable');
});

// Plugin alcanceSucursal: ninguna consulta a una colección operativa sin filtro de sucursal.
const mongoose = require('mongoose');
const h = require('./helpers/app');
const { alcanceSucursal, ErrorAlcance } = require('../models/plugins/alcanceSucursal');
const { conAlcance, conAlcanceMultiple, matchAlcance } = require('../helpers/alcance');

const { ObjectId } = mongoose.Types;

// Modelo con 'sucursal' (como Existencia, Venta, Turno…)
const esquemaLote = new mongoose.Schema({ sucursal: { type: ObjectId, required: true }, cantidad: Number });
esquemaLote.plugin(alcanceSucursal);
const LotePrueba = mongoose.model('LotePrueba', esquemaLote);

// Modelo con origen/destino (como Traspaso)
const esquemaTraspaso = new mongoose.Schema({ origen: { type: ObjectId, required: true }, destino: { type: ObjectId, required: true }, piezas: Number });
esquemaTraspaso.plugin(alcanceSucursal, { campos: ['origen', 'destino'] });
const TraspasoPrueba = mongoose.model('TraspasoPrueba', esquemaTraspaso);

const A = new ObjectId();
const B = new ObjectId();
const C = new ObjectId();

beforeAll(async () => {
  await h.resetDb();
  await LotePrueba.create([{ sucursal: A, cantidad: 5 }, { sucursal: B, cantidad: 7 }]);
  await TraspasoPrueba.create([{ origen: A, destino: B, piezas: 3 }, { origen: B, destino: C, piezas: 4 }]);
});
afterAll(h.cerrar);

const rechaza = promesa => expect(promesa).rejects.toBeInstanceOf(ErrorAlcance);

describe('consultas con campo sucursal', () => {
  test('find/findOne/findById sin sucursal → error', async () => {
    await rechaza(LotePrueba.find({}).exec());
    await rechaza(LotePrueba.find({ cantidad: 5 }).exec());
    await rechaza(LotePrueba.findOne({}).exec());
    await rechaza(LotePrueba.findById(new ObjectId()).exec());
  });

  test('count, distinct, update, replace y delete sin sucursal → error', async () => {
    await rechaza(LotePrueba.countDocuments({}).exec());
    await rechaza(LotePrueba.distinct('cantidad').exec());
    await rechaza(LotePrueba.updateOne({ cantidad: 5 }, { cantidad: 6 }).exec());
    await rechaza(LotePrueba.updateMany({}, { cantidad: 0 }).exec());
    await rechaza(LotePrueba.findOneAndUpdate({}, { cantidad: 0 }).exec());
    await rechaza(LotePrueba.replaceOne({}, { sucursal: A, cantidad: 1 }).exec());
    await rechaza(LotePrueba.deleteOne({}).exec());
    await rechaza(LotePrueba.deleteMany({}).exec());
    await rechaza(LotePrueba.findOneAndDelete({}).exec());
    await rechaza(LotePrueba.estimatedDocumentCount().exec());
    // nada cambió
    expect(await LotePrueba.countDocuments({ sucursal: { $in: [A, B] } })).toBe(2);
  });

  test('filtros que NO restringen la sucursal → error', async () => {
    await rechaza(LotePrueba.find({ sucursal: undefined }).exec());
    await rechaza(LotePrueba.find({ sucursal: null }).exec());
    await rechaza(LotePrueba.find({ sucursal: { $in: [] } }).exec());
    await rechaza(LotePrueba.find({ sucursal: { $ne: A } }).exec());
    await rechaza(LotePrueba.find({ sucursal: { $nin: [A] } }).exec());
    await rechaza(LotePrueba.find({ sucursal: { $exists: false } }).exec());
    await rechaza(LotePrueba.find({ $or: [{ sucursal: A }, { cantidad: 7 }] }).exec()); // una rama sin sucursal
  });

  test('filtros válidos: igualdad, $eq, $in, $and, $or con sucursal en todas las ramas', async () => {
    expect(await LotePrueba.find({ sucursal: A })).toHaveLength(1);
    expect(await LotePrueba.find({ sucursal: { $eq: B } })).toHaveLength(1);
    expect(await LotePrueba.find({ sucursal: { $in: [A, B] } })).toHaveLength(2);
    expect(await LotePrueba.find({ $and: [{ cantidad: { $gt: 0 } }, { sucursal: A }] })).toHaveLength(1);
    expect(await LotePrueba.find({ $or: [{ sucursal: A }, { sucursal: B, cantidad: 7 }] })).toHaveLength(2);
    expect(await LotePrueba.countDocuments({ sucursal: A })).toBe(1);
    await LotePrueba.updateOne({ sucursal: A }, { $inc: { cantidad: 1 } });
    expect((await LotePrueba.findOne({ sucursal: A })).cantidad).toBe(6);
  });

  test('conAlcance produce filtros válidos para cada tipo de alcance', async () => {
    expect(await LotePrueba.find(conAlcance({}, { sucursalActiva: A, permitidas: [A] }))).toHaveLength(1);
    expect(await LotePrueba.find(conAlcance({}, { sucursalActiva: null, permitidas: [A, B] }))).toHaveLength(2);
    expect(await LotePrueba.find(conAlcance({}, { sucursalActiva: null, permitidas: 'todas' }))).toHaveLength(2);
    // el alcance reemplaza la sucursal que viniera en el filtro
    expect(await LotePrueba.find(conAlcance({ sucursal: B }, { sucursalActiva: A, permitidas: [A] }))).toHaveLength(1);
    expect(() => conAlcance({}, undefined)).toThrow(/alcance/);
  });

  test('escape explícito para scripts: setOptions({ sinAlcance: true })', async () => {
    expect(await LotePrueba.find({}).setOptions({ sinAlcance: true })).toHaveLength(2);
    expect(await LotePrueba.estimatedDocumentCount().setOptions({ sinAlcance: true })).toBe(2);
  });

  test('crear documentos sigue exigiendo sucursal (validación del esquema)', async () => {
    await expect(LotePrueba.create({ cantidad: 1 })).rejects.toThrow(/sucursal/);
  });
});

describe('aggregate', () => {
  const total = [{ $group: { _id: null, total: { $sum: '$cantidad' } } }];

  test('sin $match inicial, o con $match sin sucursal → error', async () => {
    await rechaza(LotePrueba.aggregate(total).exec());
    await rechaza(LotePrueba.aggregate([{ $match: { cantidad: { $gt: 0 } } }, ...total]).exec());
    await rechaza(LotePrueba.aggregate([]).exec());
  });

  test('el $match con sucursal debe ser la PRIMERA etapa', async () => {
    await rechaza(LotePrueba.aggregate([{ $sort: { cantidad: 1 } }, { $match: { sucursal: A } }]).exec());
  });

  test('con matchAlcance al inicio funciona y respeta el alcance', async () => {
    const [r] = await LotePrueba.aggregate([matchAlcance({ sucursalActiva: B, permitidas: [B] }), ...total]);
    expect(r.total).toBe(7);
  });

  test('escape explícito: .option({ sinAlcance: true })', async () => {
    const [r] = await LotePrueba.aggregate(total).option({ sinAlcance: true });
    expect(r.total).toBeGreaterThan(0);
  });
});

describe('Traspaso: origen / destino', () => {
  test('sin origen ni destino → error', async () => {
    await rechaza(TraspasoPrueba.find({}).exec());
    await rechaza(TraspasoPrueba.find({ piezas: 3 }).exec());
    await rechaza(TraspasoPrueba.aggregate([{ $match: { piezas: { $gt: 0 } } }]).exec());
    await rechaza(TraspasoPrueba.updateMany({}, { piezas: 0 }).exec());
  });

  test('filtrar por origen, por destino o por cualquiera de los dos', async () => {
    expect(await TraspasoPrueba.find({ origen: A })).toHaveLength(1);
    expect(await TraspasoPrueba.find({ destino: C })).toHaveLength(1);
    expect(await TraspasoPrueba.find({ $or: [{ origen: B }, { destino: B }] })).toHaveLength(2);
    const [r] = await TraspasoPrueba.aggregate([{ $match: { destino: B } }, { $group: { _id: null, p: { $sum: '$piezas' } } }]);
    expect(r.p).toBe(3);
  });

  test('conAlcanceMultiple: la sucursal ve los traspasos donde es origen O destino', async () => {
    const deB = await TraspasoPrueba.find(conAlcanceMultiple({}, { sucursalActiva: B, permitidas: [B] }, ['origen', 'destino']));
    expect(deB).toHaveLength(2);
    const deA = await TraspasoPrueba.find(conAlcanceMultiple({ piezas: { $gt: 0 } }, { sucursalActiva: A, permitidas: [A] }, ['origen', 'destino']));
    expect(deA).toHaveLength(1);
  });
});

describe('actualizaciones no mudan documentos de sucursal', () => {
  test('$set, campo directo, $unset o $rename sobre sucursal → error', async () => {
    await rechaza(LotePrueba.updateOne({ sucursal: A }, { $set: { sucursal: B } }).exec());
    await rechaza(LotePrueba.updateMany({ sucursal: A }, { sucursal: B }).exec());
    await rechaza(LotePrueba.findOneAndUpdate({ sucursal: A }, { $unset: { sucursal: 1 } }).exec());
    await rechaza(LotePrueba.updateOne({ sucursal: A }, { $rename: { cantidad: 'sucursal' } }).exec());
    await rechaza(TraspasoPrueba.updateOne({ origen: A }, { $set: { destino: C } }).exec());
    expect(await LotePrueba.countDocuments({ sucursal: A })).toBe(1);
  });

  test('replace debe conservar la sucursal', async () => {
    await rechaza(LotePrueba.replaceOne({ sucursal: A }, { cantidad: 1 }).exec());
    const r = await LotePrueba.replaceOne({ sucursal: A }, { sucursal: A, cantidad: 6 });
    expect(r.modifiedCount + r.matchedCount).toBeGreaterThan(0);
  });
});

describe('insertMany', () => {
  test('cada documento debe traer la sucursal (también con lean, que se salta la validación)', async () => {
    const antes = await LotePrueba.countDocuments({ sucursal: { $in: [A, B] } }).setOptions({ sinAlcance: true });
    await rechaza(LotePrueba.insertMany([{ sucursal: A, cantidad: 1 }, { cantidad: 2 }]));
    await rechaza(LotePrueba.insertMany([{ sucursal: null, cantidad: 1 }], { lean: true }));
    await rechaza(LotePrueba.insertMany({ cantidad: 3 }));
    await rechaza(TraspasoPrueba.insertMany([{ origen: A, piezas: 1 }])); // falta destino
    // no se insertó NINGUNO (ni el primero, que sí era válido)
    expect(await LotePrueba.find({}).setOptions({ sinAlcance: true })).toHaveLength(antes);
  });

  test('documentos completos se insertan; el escape explícito existe para migraciones', async () => {
    const creados = await LotePrueba.insertMany([{ sucursal: A, cantidad: 10 }, { sucursal: B, cantidad: 20 }]);
    expect(creados).toHaveLength(2);
    await TraspasoPrueba.insertMany([{ origen: A, destino: C, piezas: 1 }]);
    await expect(LotePrueba.insertMany([{ sucursal: A, cantidad: 30 }], { sinAlcance: true })).resolves.toHaveLength(1);
    await LotePrueba.deleteMany({ sucursal: { $in: [A, B] }, cantidad: { $in: [10, 20, 30] } });
  });
});

describe('bulkWrite', () => {
  const bulkRechaza = ops => expect(LotePrueba.bulkWrite(ops)).rejects.toBeInstanceOf(ErrorAlcance);

  test('insertOne sin sucursal → error, y no se aplica ninguna operación del lote', async () => {
    const antes = await LotePrueba.countDocuments({ sucursal: A });
    await bulkRechaza([
      { insertOne: { document: { sucursal: A, cantidad: 1 } } },
      { insertOne: { document: { cantidad: 2 } } }
    ]);
    expect(await LotePrueba.countDocuments({ sucursal: A })).toBe(antes);
  });

  test('update/delete/replace sin filtro de sucursal → error', async () => {
    await bulkRechaza([{ updateOne: { filter: { cantidad: 6 }, update: { $inc: { cantidad: 1 } } } }]);
    await bulkRechaza([{ updateMany: { filter: {}, update: { $set: { cantidad: 0 } } } }]);
    await bulkRechaza([{ deleteOne: { filter: { cantidad: 6 } } }]);
    await bulkRechaza([{ deleteMany: { filter: { sucursal: { $ne: A } } } }]);
    await bulkRechaza([{ replaceOne: { filter: {}, replacement: { sucursal: A, cantidad: 1 } } }]);
  });

  test('update que muda la sucursal o replace sin sucursal → error', async () => {
    await bulkRechaza([{ updateOne: { filter: { sucursal: A }, update: { $set: { sucursal: B } } } }]);
    await bulkRechaza([{ replaceOne: { filter: { sucursal: A }, replacement: { cantidad: 1 } } }]);
  });

  test('operaciones con alcance se aplican', async () => {
    const r = await LotePrueba.bulkWrite([
      { insertOne: { document: { sucursal: B, cantidad: 40 } } },
      { updateOne: { filter: { sucursal: B, cantidad: 40 }, update: { $inc: { cantidad: 1 } } } },
      { deleteMany: { filter: { sucursal: B, cantidad: 41 } } }
    ]);
    expect(r.insertedCount).toBe(1);
    expect(r.modifiedCount).toBe(1);
    expect(r.deletedCount).toBe(1);
  });

  test('Traspaso: insertOne necesita origen Y destino; filtros por cualquiera', async () => {
    await expect(TraspasoPrueba.bulkWrite([{ insertOne: { document: { origen: A, piezas: 1 } } }])).rejects.toBeInstanceOf(ErrorAlcance);
    const r = await TraspasoPrueba.bulkWrite([{ updateMany: { filter: { destino: C }, update: { $inc: { piezas: 0 } } } }]);
    expect(r.matchedCount).toBeGreaterThan(0);
  });

  test('escape explícito: bulkWrite(ops, { sinAlcance: true })', async () => {
    const r = await LotePrueba.bulkWrite([{ updateMany: { filter: {}, update: { $inc: { cantidad: 0 } } } }], { sinAlcance: true });
    expect(r.matchedCount).toBeGreaterThan(0);
  });
});

test('registrar el plugin en un esquema sin el campo de sucursal falla al arrancar', () => {
  const sinCampo = new mongoose.Schema({ nombre: String });
  expect(() => sinCampo.plugin(alcanceSucursal)).toThrow(/sucursal/);
});

// Núcleo de inventario: entradas, consumo FEFO por sucursal, nunca caducados, nunca negativos, reversión exacta.
const mongoose = require('mongoose');
const h = require('./helpers/app');
const Producto = require('../models/Producto');
const InventoryLayer = require('../models/InventoryLayer');
const InventoryMovement = require('../models/InventoryMovement');
const inv = require('../services/inventario');
const { conTransaccion } = require('../helpers/transaccion');

let A, B, usuario, seq = 0;
beforeAll(async () => {
  await h.resetDb();
  A = (await h.crearSucursal({ nombre: 'A' }))._id;
  B = (await h.crearSucursal({ nombre: 'B' }))._id;
  usuario = (await h.crearUsuario({ rol: 'dueno' }))._id;
});
afterAll(h.cerrar);

const tx = fn => conTransaccion(fn);
const crearProducto = (extra = {}) => {
  seq += 1;
  return Producto.create({ sku: `INV-${seq}`, nombre: `Producto ${seq}`, categoria: 'accesorio', unidad: 'pieza', iva: 'tasa_16', ...extra });
};
const entrada = (datos) => tx(s => inv.registrarEntrada({ origen: 'compra', costoUnitario: 1000, usuario, ...datos }, s));
const consumir = (datos) => tx(s => inv.consumirFefo({ tipo: 'venta', usuario, ...datos }, s));
const capasDe = (producto, sucursal = A) =>
  InventoryLayer.find({ sucursal, producto: producto._id }).sort({ ordenFefo: 1, _id: 1 }).lean();
const restante = async (producto, sucursal = A) => (await capasDe(producto, sucursal)).reduce((s, c) => s + c.cantidadRestante, 0);

describe('registrarEntrada', () => {
  test('crea la capa y el movimiento de entrada con su costo', async () => {
    const p = await crearProducto();
    const { capa, movimiento } = await entrada({ sucursal: A, producto: p._id, cantidad: 10, costoUnitario: 4550, lote: 'L1', caducidad: '06/2027' });
    expect(capa).toMatchObject({ cantidadInicial: 10, cantidadRestante: 10, agotada: false, lote: 'L1' });
    expect(capa.caducidad.toISOString()).toBe('2027-07-01T06:59:59.999Z'); // fin de junio en Tepic
    expect(movimiento).toMatchObject({ tipo: 'entrada', cantidad: 10, costoTotal: 45500 });
  });

  test('producto por kg: cantidad en gramos y costo por kg (half-up)', async () => {
    const p = await crearProducto({ unidad: 'kg', categoria: 'alimento', iva: 'tasa_0' });
    const { movimiento } = await entrada({ sucursal: A, producto: p._id, cantidad: 2500, costoUnitario: 6333, caducidad: '12/2027' });
    expect(movimiento.costoTotal).toBe(15833); // 63.33 × 2.5 = 158.325 → 158.33
  });

  test('medicamento sin lote o sin caducidad → 400; alimento sin caducidad → 400', async () => {
    const med = await crearProducto({ categoria: 'medicamento', iva: 'tasa_0' });
    await expect(entrada({ sucursal: A, producto: med._id, cantidad: 1, caducidad: '06/2027' })).rejects.toMatchObject({ status: 400 });
    await expect(entrada({ sucursal: A, producto: med._id, cantidad: 1, lote: 'X' })).rejects.toMatchObject({ status: 400 });
    const ali = await crearProducto({ categoria: 'alimento', iva: 'tasa_0' });
    await expect(entrada({ sucursal: A, producto: ali._id, cantidad: 1 })).rejects.toMatchObject({ status: 400 });
  });

  test('no se recibe mercancía caducada, salvo en el inventario inicial (para darla de baja)', async () => {
    const p = await crearProducto();
    await expect(entrada({ sucursal: A, producto: p._id, cantidad: 1, caducidad: '01/2020' })).rejects.toMatchObject({ status: 400 });
    const { capa } = await entrada({ sucursal: A, producto: p._id, cantidad: 1, caducidad: '01/2020', origen: 'inventario_inicial', permitirCaducado: true });
    expect(capa.origen).toBe('inventario_inicial');
  });

  test('cantidades y costos deben ser enteros', async () => {
    const p = await crearProducto();
    await expect(entrada({ sucursal: A, producto: p._id, cantidad: 1.5 })).rejects.toMatchObject({ status: 400 });
    await expect(entrada({ sucursal: A, producto: p._id, cantidad: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(entrada({ sucursal: A, producto: p._id, cantidad: 1, costoUnitario: 10.5 })).rejects.toMatchObject({ status: 400 });
  });
});

describe('consumirFefo', () => {
  test('sale primero lo que CADUCA antes, no lo que entró primero; lo que no caduca, al final', async () => {
    const p = await crearProducto();
    await entrada({ sucursal: A, producto: p._id, cantidad: 5, lote: 'SIN-CAD' }); // entra primero, no caduca
    await entrada({ sucursal: A, producto: p._id, cantidad: 5, lote: 'JUN', caducidad: '06/2027' });
    await entrada({ sucursal: A, producto: p._id, cantidad: 5, lote: 'MAR', caducidad: '03/2027' }); // entra al final
    const [r] = await consumir({ sucursal: A, partidas: [{ producto: p._id, cantidad: 7 }] });
    expect(r.capas.map(c => [c.lote, c.cantidad])).toEqual([['MAR', 5], ['JUN', 2]]);
    const capas = await capasDe(p);
    expect(capas.map(c => [c.lote, c.cantidadRestante, c.agotada])).toEqual([['MAR', 0, true], ['JUN', 3, false], ['SIN-CAD', 5, false]]);
  });

  test('nunca consume lotes caducados; el error lo explica', async () => {
    const p = await crearProducto();
    await entrada({ sucursal: A, producto: p._id, cantidad: 4, lote: 'VIEJO', caducidad: '01/2020', origen: 'inventario_inicial', permitirCaducado: true });
    await entrada({ sucursal: A, producto: p._id, cantidad: 2, lote: 'NUEVO', caducidad: '06/2027' });
    const error = await consumir({ sucursal: A, partidas: [{ producto: p._id, cantidad: 3 }] }).catch(e => e);
    expect(error).toMatchObject({ status: 409, codigo: 'EXISTENCIA_INSUFICIENTE', detalles: { disponible: 2, solicitado: 3, caducado: 4 } });
    expect(error.message).toMatch(/hay 2 pzas, se pidieron 3 pzas.*4 pzas caducados/);
    const [r] = await consumir({ sucursal: A, partidas: [{ producto: p._id, cantidad: 2 }] });
    expect(r.capas.map(c => c.lote)).toEqual(['NUEVO']);
  });

  test('el último día de su caducidad todavía se vende (caducidad = fin del día en Tepic)', async () => {
    const p = await crearProducto();
    await entrada({ sucursal: A, producto: p._id, cantidad: 1, lote: 'MAR', caducidad: '03/2027' });
    const ultimoDia = new Date('2027-04-01T06:00:00Z'); // 31/03/2027 23:00 en Tepic
    const diaSiguiente = new Date('2027-04-01T07:00:00Z'); // 01/04/2027 00:00 en Tepic
    await expect(consumir({ sucursal: A, fecha: diaSiguiente, partidas: [{ producto: p._id, cantidad: 1 }] })).rejects.toMatchObject({ status: 409 });
    await expect(consumir({ sucursal: A, fecha: ultimoDia, partidas: [{ producto: p._id, cantidad: 1 }] })).resolves.toHaveLength(1);
  });

  test('sin existencia suficiente se rechaza TODO: no se descuenta ningún producto', async () => {
    const p1 = await crearProducto();
    const p2 = await crearProducto();
    await entrada({ sucursal: A, producto: p1._id, cantidad: 10 });
    await entrada({ sucursal: A, producto: p2._id, cantidad: 1 });
    await expect(consumir({ sucursal: A, partidas: [{ producto: p1._id, cantidad: 3 }, { producto: p2._id, cantidad: 2 }] }))
      .rejects.toMatchObject({ status: 409 });
    expect(await restante(p1)).toBe(10);
    expect(await restante(p2)).toBe(1);
    expect(await InventoryMovement.countDocuments({ sucursal: A, producto: p1._id, tipo: 'venta' })).toBe(0);
  });

  test('existencias negativas imposibles: dos ventas simultáneas de las últimas piezas', async () => {
    const p = await crearProducto();
    await entrada({ sucursal: A, producto: p._id, cantidad: 5 });
    const resultados = await Promise.allSettled([
      consumir({ sucursal: A, partidas: [{ producto: p._id, cantidad: 4 }] }),
      consumir({ sucursal: A, partidas: [{ producto: p._id, cantidad: 4 }] })
    ]);
    expect(resultados.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(resultados.find(r => r.status === 'rejected').reason.status).toBe(409);
    expect(await restante(p)).toBe(1);
  });

  test('cada sucursal consume solo sus capas', async () => {
    const p = await crearProducto();
    await entrada({ sucursal: A, producto: p._id, cantidad: 2 });
    await entrada({ sucursal: B, producto: p._id, cantidad: 10 });
    await expect(consumir({ sucursal: A, partidas: [{ producto: p._id, cantidad: 3 }] })).rejects.toMatchObject({ status: 409 });
    await consumir({ sucursal: B, partidas: [{ producto: p._id, cantidad: 3 }] });
    expect(await restante(p, A)).toBe(2);
    expect(await restante(p, B)).toBe(7);
  });

  test('dos partidas del mismo producto: capas asignadas en orden FEFO, sin prorratear', async () => {
    const p = await crearProducto();
    await entrada({ sucursal: A, producto: p._id, cantidad: 2, lote: 'L1', caducidad: '03/2027', costoUnitario: 1000 });
    await entrada({ sucursal: A, producto: p._id, cantidad: 5, lote: 'L2', caducidad: '06/2027', costoUnitario: 1300 });
    const r = await consumir({ sucursal: A, partidas: [{ producto: p._id, cantidad: 3, partida: 0 }, { producto: p._id, cantidad: 1, partida: 1 }] });
    expect(r[0].capas.map(c => [c.lote, c.cantidad])).toEqual([['L1', 2], ['L2', 1]]);
    expect(r[0].costoTotal).toBe(3300);
    expect(r[1].capas.map(c => [c.lote, c.cantidad])).toEqual([['L2', 1]]);
    expect(r[1].costoTotal).toBe(1300);
  });

  test('granel: costo por capa con half-up', async () => {
    const p = await crearProducto({ unidad: 'kg', categoria: 'alimento', iva: 'tasa_0' });
    await entrada({ sucursal: A, producto: p._id, cantidad: 1000, costoUnitario: 4999, caducidad: '03/2027' });
    const [r] = await consumir({ sucursal: A, partidas: [{ producto: p._id, cantidad: 500 }] });
    expect(r.costoTotal).toBe(2500); // 49.99 × 0.5 = 24.995 → 25.00
  });

  test('cantidades no enteras o cero → 400', async () => {
    const p = await crearProducto();
    await expect(consumir({ sucursal: A, partidas: [{ producto: p._id, cantidad: 0.5 }] })).rejects.toMatchObject({ status: 400 });
    await expect(consumir({ sucursal: A, partidas: [] })).rejects.toMatchObject({ status: 400 });
  });
});

describe('consumirDeCapa (merma de un lote concreto)', () => {
  test('puede dar de baja un lote caducado', async () => {
    const p = await crearProducto();
    const { capa } = await entrada({ sucursal: A, producto: p._id, cantidad: 3, lote: 'CAD', caducidad: '01/2020', origen: 'inventario_inicial', permitirCaducado: true });
    const r = await tx(s => inv.consumirDeCapa({ sucursal: A, capaId: capa._id, cantidad: 3, usuario, motivo: 'caducado' }, s));
    expect(r.costoTotal).toBe(3000);
    expect((await InventoryLayer.findOne({ _id: capa._id, sucursal: A })).agotada).toBe(true);
  });

  test('una capa de otra sucursal no se encuentra (404)', async () => {
    const p = await crearProducto();
    const { capa } = await entrada({ sucursal: B, producto: p._id, cantidad: 3 });
    await expect(tx(s => inv.consumirDeCapa({ sucursal: A, capaId: capa._id, cantidad: 1, usuario, motivo: 'merma' }, s)))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe('revertirSalidas', () => {
  test('devuelve a las capas EXACTAS, crea movimientos contrarios y no revierte dos veces', async () => {
    const p = await crearProducto();
    await entrada({ sucursal: A, producto: p._id, cantidad: 2, lote: 'L1', caducidad: '03/2027' });
    await entrada({ sucursal: A, producto: p._id, cantidad: 5, lote: 'L2', caducidad: '06/2027' });
    const venta = new mongoose.Types.ObjectId();
    await consumir({ sucursal: A, referencia: { modelo: 'Venta', id: venta }, partidas: [{ producto: p._id, cantidad: 4 }] });
    expect((await capasDe(p)).map(c => c.cantidadRestante)).toEqual([0, 3]);

    const rev = await tx(s => inv.revertirSalidas({ sucursal: A, referenciaId: venta, usuario, nota: 'cancelación' }, s));
    expect(rev).toHaveLength(1);
    expect(rev[0]).toMatchObject({ tipo: 'cancelacion', cantidad: 4 });
    expect((await capasDe(p)).map(c => [c.cantidadRestante, c.agotada])).toEqual([[2, false], [5, false]]);

    // segunda vez: nada que revertir
    expect(await tx(s => inv.revertirSalidas({ sucursal: A, referenciaId: venta, usuario }, s))).toHaveLength(0);
    expect(await restante(p)).toBe(7);
  });

  test('el índice único impide registrar dos reversiones del mismo movimiento', async () => {
    const p = await crearProducto();
    await entrada({ sucursal: A, producto: p._id, cantidad: 2 });
    const venta = new mongoose.Types.ObjectId();
    const [r] = await consumir({ sucursal: A, referencia: { modelo: 'Venta', id: venta }, partidas: [{ producto: p._id, cantidad: 1 }] });
    await tx(s => inv.revertirSalidas({ sucursal: A, referenciaId: venta, usuario }, s));
    const original = await InventoryMovement.findOne({ _id: r.movimiento, sucursal: A }).lean();
    await expect(InventoryMovement.create({
      producto: p._id, sucursal: A, tipo: 'cancelacion', cantidad: 1, capas: original.capas, costoTotal: original.costoTotal,
      movimientoOriginal: original._id, usuario
    })).rejects.toMatchObject({ code: 11000 });
  });
});

test('los movimientos no se pueden editar ni borrar', async () => {
  const p = await crearProducto();
  const { movimiento } = await entrada({ sucursal: A, producto: p._id, cantidad: 1 });
  await expect(InventoryMovement.updateOne({ _id: movimiento._id, sucursal: A }, { cantidad: 99 })).rejects.toThrow(/no se puede/);
  await expect(InventoryMovement.deleteMany({ sucursal: A })).rejects.toThrow(/no se puede/);
  movimiento.cantidad = 99;
  await expect(movimiento.save()).rejects.toThrow(/no se puede/);
});

test('tieneInventario busca en todas las sucursales', async () => {
  const p = await crearProducto();
  expect(await inv.tieneInventario(p._id)).toBe(false);
  await entrada({ sucursal: B, producto: p._id, cantidad: 1 });
  expect(await inv.tieneInventario(p._id)).toBe(true);
});

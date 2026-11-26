// Cadena de frío: equipos por sucursal, lecturas (en rango / fuera de rango con acción correctiva),
// inmutabilidad, permisos, alcance por sucursal, bitácora mensual (HTML y Excel), alertas y ajuste «cadena_frio».
const h = require('./helpers/app');
const Producto = require('../models/Producto');
const LecturaTemperatura = require('../models/LecturaTemperatura');
const inv = require('../services/inventario');
const { conTransaccion } = require('../helpers/transaccion');
const { diaLocal } = require('../helpers/fechas');
const { Auditoria } = h.modelos;

let A, B, dueno, cajero, cajeroB, refri;
const PIN = '4821';

beforeAll(async () => {
  await h.resetDb();
  A = await h.crearSucursal({ nombre: 'A' });
  B = await h.crearSucursal({ nombre: 'B' });
  dueno = await h.sesion({ rol: 'dueno', pin: PIN });
  cajero = await h.sesion({ rol: 'cajero', sucursales: [A._id] });
  cajeroB = await h.sesion({ rol: 'cajero', sucursales: [B._id] });
});
afterAll(h.cerrar);

const api = (s, metodo, ruta, sucursal = A) => h.request(h.app)[metodo](ruta).set(h.auth(s.token, sucursal));
const mes = () => diaLocal().slice(0, 7);

describe('equipos', () => {
  test('solo el dueño da de alta y modifica; nombre único por sucursal; rango válido', async () => {
    expect((await api(cajero, 'post', '/api/cadena-frio/equipos').send({ nombre: 'Refri 1' })).status).toBe(403);
    const res = await api(dueno, 'post', '/api/cadena-frio/equipos').send({ nombre: 'Refri vacunas' });
    expect(res.status).toBe(201);
    refri = res.body.datos;
    expect(refri).toMatchObject({ minimo: 2, maximo: 8, lecturasPorDia: 2, tipo: 'refrigerador', activo: true });
    expect((await api(dueno, 'post', '/api/cadena-frio/equipos').send({ nombre: 'REFRI VACUNAS' })).body.codigo).toBe('EQUIPO_DUPLICADO');
    expect((await api(dueno, 'post', '/api/cadena-frio/equipos').send({ nombre: 'Malo', minimo: 8, maximo: 2 })).status).toBe(400);
    expect((await api(dueno, 'post', '/api/cadena-frio/equipos').send({ nombre: 'Decimales', minimo: 2.55 })).status).toBe(400);
    const patch = await api(dueno, 'patch', `/api/cadena-frio/equipos/${refri.id}`).send({ lecturasPorDia: 3 });
    expect(patch.body.datos.lecturasPorDia).toBe(3);
    expect(await Auditoria.exists({ accion: 'cadena_frio.equipo_actualizar', entidadId: refri.id })).toBeTruthy();
  });

  test('cada sucursal ve solo sus equipos', async () => {
    await api(dueno, 'post', '/api/cadena-frio/equipos', B).send({ nombre: 'Congelador B', tipo: 'congelador', minimo: -25, maximo: -15 });
    expect((await api(cajero, 'get', '/api/cadena-frio/equipos')).body.datos.map(e => e.nombre)).toEqual(['Refri vacunas']);
    expect((await api(cajeroB, 'get', '/api/cadena-frio/equipos', B)).body.datos.map(e => e.nombre)).toEqual(['Congelador B']);
    expect((await api(cajeroB, 'post', '/api/cadena-frio/lecturas', B).send({ equipo: refri.id, temperatura: 5 })).status).toBe(404);
  });
});

describe('lecturas', () => {
  test('en rango: la registra el cajero; el estado del día cuenta lo pendiente', async () => {
    const res = await api(cajero, 'post', '/api/cadena-frio/lecturas').send({ equipo: refri.id, temperatura: 4.5, observacion: 'Apertura' });
    expect(res.status).toBe(201);
    expect(res.body.datos).toMatchObject({ temperatura: 4.5, fueraDeRango: false, rango: { minimo: 2, maximo: 8 } });
    const equipo = (await api(cajero, 'get', '/api/cadena-frio/equipos')).body.datos[0];
    expect(equipo.hoy).toMatchObject({ lecturas: 1, pendientes: 2, fueraDeRango: 0 });
    expect(equipo.hoy.ultima.temperatura).toBe(4.5);
  });

  test('fuera de rango exige acción correctiva y queda en bitácora', async () => {
    const sin = await api(cajero, 'post', '/api/cadena-frio/lecturas').send({ equipo: refri.id, temperatura: 9.2 });
    expect(sin.status).toBe(400);
    expect(sin.body).toMatchObject({ codigo: 'ACCION_CORRECTIVA_REQUERIDA', detalles: { minimo: 2, maximo: 8 } });
    const con = await api(cajero, 'post', '/api/cadena-frio/lecturas').send({
      equipo: refri.id, temperatura: 9.2, accionCorrectiva: 'Se cerró bien la puerta y se revisó a los 30 min', productosAfectados: 'Ninguno'
    });
    expect(con.status).toBe(201);
    expect(con.body.datos.fueraDeRango).toBe(true);
    expect(await Auditoria.exists({ accion: 'cadena_frio.fuera_de_rango', entidadId: con.body.datos.id })).toBeTruthy();
    expect((await api(cajero, 'post', '/api/cadena-frio/lecturas').send({ equipo: refri.id, temperatura: 4.55 })).status).toBe(400);
  });

  test('una lectura no se edita ni se borra', async () => {
    await expect(LecturaTemperatura.updateOne({ sucursal: A._id }, { $set: { temperatura: 5 } })).rejects.toThrow('no se puede modificar');
    await expect(LecturaTemperatura.deleteMany({ sucursal: A._id })).rejects.toThrow('no se puede modificar');
  });

  test('equipo desactivado no recibe lecturas', async () => {
    const otro = (await api(dueno, 'post', '/api/cadena-frio/equipos').send({ nombre: 'Viejo' })).body.datos;
    await api(dueno, 'patch', `/api/cadena-frio/equipos/${otro.id}`).send({ activo: false });
    expect((await api(cajero, 'post', '/api/cadena-frio/lecturas').send({ equipo: otro.id, temperatura: 5 })).body.codigo).toBe('EQUIPO_INACTIVO');
    expect((await api(cajero, 'get', '/api/cadena-frio/equipos')).body.datos).toHaveLength(1);
  });

  test('historial de lecturas con filtro de fuera de rango', async () => {
    const todas = (await api(cajero, 'get', '/api/cadena-frio/lecturas')).body.datos;
    expect(todas).toHaveLength(2);
    const fuera = (await api(cajero, 'get', '/api/cadena-frio/lecturas?fueraDeRango=true')).body.datos;
    expect(fuera.map(l => l.temperatura)).toEqual([9.2]);
  });
});

describe('bitácora, alertas y baja por cadena de frío', () => {
  test('bitácora mensual en HTML y Excel, con recepciones de refrigerados', async () => {
    const vacuna = await Producto.create({ sku: 'VAC', nombre: 'Vacuna', categoria: 'biologico', unidad: 'pieza', iva: 'tasa_0', requiereRefrigeracion: true });
    const almacen = await h.sesion({ rol: 'almacen', sucursales: [A._id] });
    const prov = (await api(almacen, 'post', '/api/proveedores', null).send({ nombre: 'Lab (prueba)' })).body.datos;
    const c = await api(almacen, 'post', '/api/compras').send({
      proveedor: String(prov.id), folioFactura: 'V-1', fechaFactura: diaLocal(), condicionPago: 'contado',
      partidas: [{ producto: String(vacuna._id), cantidad: 5, costoUnitario: 10000, lote: 'L1', caducidad: '12/2030', temperaturaLlegada: 5 }]
    });
    await api(almacen, 'post', `/api/compras/${c.body.datos.id}/confirmar`);

    const html = await api(cajero, 'get', `/api/cadena-frio/bitacora?equipo=${refri.id}&mes=${mes()}`);
    expect(html.status).toBe(200);
    expect(html.text).toContain('Refri vacunas');
    expect(html.text).toContain('FUERA DE RANGO');
    expect(html.text).toContain('Se cerró bien la puerta');
    expect(html.text).toContain('Vacuna');
    expect((await api(cajero, 'get', `/api/cadena-frio/bitacora?equipo=${refri.id}&mes=2026-13`)).status).toBe(400);

    const xls = await api(cajero, 'get', `/api/cadena-frio/bitacora.xlsx?equipo=${refri.id}&mes=${mes()}`).buffer(true).parse((r, cb) => {
      const partes = [];
      r.on('data', d => partes.push(d));
      r.on('end', () => cb(null, Buffer.concat(partes)));
    });
    expect(xls.status).toBe(200);
    expect(xls.body.subarray(0, 2).toString()).toBe('PK');
  });

  test('tablero: lecturas fuera de rango (7 días) y equipos sin lectura hoy', async () => {
    const alertas = (await h.request(h.app).get('/api/reportes/dashboard').set(h.auth(dueno.token))).body.datos.alertas;
    // A: refri con lecturas; B: congelador sin lectura
    expect(alertas).toMatchObject({ lecturasFueraDeRango: 1, equiposSinLectura: 1 });
  });

  test('dar de baja producto dañado con motivo «cadena_frio»', async () => {
    const insulina = await Producto.create({ sku: 'INS', nombre: 'Insulina', categoria: 'medicamento', unidad: 'pieza', iva: 'tasa_0' });
    await conTransaccion(s => inv.registrarEntrada({ sucursal: A._id, producto: insulina._id, cantidad: 3, costoUnitario: 1000, lote: 'I1', caducidad: '01/2031', origen: 'compra', usuario: dueno.usuario._id }, s));
    const res = await api(dueno, 'post', '/api/inventario/ajustes').send({ tipo: 'salida', producto: String(insulina._id), cantidad: 1, motivo: 'cadena_frio', nota: 'Refri a 12 °C', autorizacion: { usuario: dueno.usuario.usuario, pin: PIN } });
    expect(res.status).toBe(201);
  });
});

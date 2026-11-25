// Recetas: captura, validación con PIN del médico responsable, archivo, surtido desde la caja
// (entregado ≤ prescrito, con lotes), cancelación de venta que lo revierte, historial.
const os = require('os');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

// Archivos de prueba en una carpeta temporal propia (se borra al final)
const CARPETA = fs.mkdtempSync(path.join(os.tmpdir(), 'vetshop-recetas-'));
process.env.ALMACENAMIENTO = 'local';
process.env.ALMACENAMIENTO_CARPETA = CARPETA;

const h = require('./helpers/app');
const Producto = require('../models/Producto');
const Receta = require('../models/Receta');
const InventoryLayer = require('../models/InventoryLayer');
const inv = require('../services/inventario');
const precios = require('../services/precios');
const { conTransaccion } = require('../helpers/transaccion');
const { diaLocal } = require('../helpers/fechas');
const { Auditoria } = h.modelos;

let A, B, dueno, cajero, medico, medicoB, almacen, antibiotico, tramadol, collar;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 7)]);

beforeAll(async () => {
  await h.resetDb();
  A = await h.crearSucursal({ nombre: 'A' });
  B = await h.crearSucursal({ nombre: 'B' });
  dueno = await h.sesion({ rol: 'dueno', pin: '4821' });
  cajero = await h.sesion({ rol: 'cajero', sucursales: [A._id] });
  medico = await h.sesion({ rol: 'medico_responsable', sucursales: [A._id], pin: '7373' });
  medicoB = await h.sesion({ rol: 'medico_responsable', sucursales: [B._id], pin: '1111' });
  almacen = await h.sesion({ rol: 'almacen', sucursales: [A._id] });
  antibiotico = await Producto.create({ sku: 'ANT', nombre: 'Antibiótico', categoria: 'medicamento', unidad: 'pieza', iva: 'tasa_0', requiereReceta: true });
  tramadol = await Producto.create({ sku: 'TRA', nombre: 'Analgésico controlado', categoria: 'medicamento', unidad: 'pieza', iva: 'tasa_0', esControlado: true });
  collar = await Producto.create({ sku: 'COL', nombre: 'Collar', categoria: 'accesorio', unidad: 'pieza', iva: 'tasa_16' });
  for (const [p, precio] of [[antibiotico, 34900], [tramadol, 50000], [collar, 14900]]) {
    await precios.fijarPrecio({ clave: 'publico', productoId: p._id, precio }, dueno.usuario);
  }
  await h.abrirTurno(cajero, A);
  await conTransaccion(async s => {
    const u = dueno.usuario._id;
    await inv.registrarEntrada({ sucursal: A._id, producto: antibiotico._id, cantidad: 5, costoUnitario: 20000, lote: 'L1', caducidad: '03/2027', origen: 'compra', usuario: u }, s);
    await inv.registrarEntrada({ sucursal: A._id, producto: antibiotico._id, cantidad: 15, costoUnitario: 21000, lote: 'L2', caducidad: '06/2027', origen: 'compra', usuario: u }, s);
    await inv.registrarEntrada({ sucursal: A._id, producto: tramadol._id, cantidad: 10, costoUnitario: 30000, lote: 'T1', caducidad: '06/2027', origen: 'compra', usuario: u }, s);
    await inv.registrarEntrada({ sucursal: A._id, producto: collar._id, cantidad: 10, costoUnitario: 7000, origen: 'compra', usuario: u }, s);
  });
});
afterAll(async () => {
  await h.cerrar();
  fs.rmSync(CARPETA, { recursive: true, force: true });
});

const api = (s, metodo, ruta, sucursal = A) => h.request(h.app)[metodo](ruta).set(h.auth(s.token, sucursal));
const recetaBase = (extra = {}) => ({
  fechaReceta: diaLocal(),
  medico: { nombre: 'MVZ Laura Pérez (prueba)', cedula: '1234567' },
  propietario: { nombre: 'Juan Ramírez (prueba)', telefono: '3110000000' },
  paciente: { nombre: 'Firulais', especie: 'Perro' },
  partidas: [{ producto: String(antibiotico._id), cantidadPrescrita: 6, indicaciones: '1 cada 12 h por 3 días' }],
  ...extra
});
const vender = (cuerpo, sucursal = A) => api(cajero, 'post', '/api/ventas', sucursal).send({ claveOperacion: randomUUID(), ...cuerpo });
const venderAntibiotico = (receta, cantidad) =>
  vender({ partidas: [{ producto: String(antibiotico._id), cantidad, receta }], pagos: [{ metodo: 'efectivo', monto: cantidad * 34900 }] });
const pinMedico = () => ({ usuario: medico.usuario.usuario, pin: '7373' });
const restante = async p => (await InventoryLayer.find({ sucursal: A._id, producto: p._id }).lean()).reduce((s, c) => s + c.cantidadRestante, 0);

let receta;

describe('captura y validación', () => {
  test('el cajero captura una receta: queda pendiente con folio', async () => {
    const res = await api(cajero, 'post', '/api/recetas').send(recetaBase());
    expect(res.status).toBe(201);
    receta = res.body.datos;
    expect(receta).toMatchObject({ folio: 1, estado: 'pendiente', paciente: { nombre: 'Firulais' } });
    expect(receta.partidas[0]).toMatchObject({ sku: 'ANT', cantidadPrescrita: 6, cantidadEntregada: 0, pendiente: 6 });
  });

  test('validaciones → 400', async () => {
    const casos = {
      'fecha futura': recetaBase({ fechaReceta: '2099-01-01' }),
      'sin cédula': recetaBase({ medico: { nombre: 'X' } }),
      'producto sin receta': recetaBase({ partidas: [{ producto: String(collar._id), cantidadPrescrita: 1 }] }),
      'medicamento repetido': recetaBase({ partidas: [{ producto: String(antibiotico._id), cantidadPrescrita: 1 }, { producto: String(antibiotico._id), cantidadPrescrita: 2 }] }),
      'cantidad decimal': recetaBase({ partidas: [{ producto: String(antibiotico._id), cantidadPrescrita: 1.5 }] }),
      'sin medicamentos': recetaBase({ partidas: [] })
    };
    for (const [caso, cuerpo] of Object.entries(casos)) {
      const res = await api(cajero, 'post', '/api/recetas').send(cuerpo);
      expect({ caso, status: res.status }).toEqual({ caso, status: 400 });
    }
  });

  test('una receta pendiente NO surte: 409 RECETA_NO_VALIDA', async () => {
    const res = await venderAntibiotico(receta.id, 1);
    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe('RECETA_NO_VALIDA');
    expect(await restante(antibiotico)).toBe(20);
  });

  test('valida SOLO el médico responsable de la sucursal, con su PIN', async () => {
    const validar = autorizacion => api(cajero, 'post', `/api/recetas/${receta.id}/validar`).send({ autorizacion });
    expect((await validar({ usuario: dueno.usuario.usuario, pin: '4821' })).status).toBe(403); // el dueño no
    expect((await validar({ usuario: medicoB.usuario.usuario, pin: '1111' })).status).toBe(403); // médico de otra sucursal
    expect((await validar({ usuario: medico.usuario.usuario, pin: '0000' })).status).toBe(401);
    const ok = await validar(pinMedico());
    expect(ok.status).toBe(200);
    expect(ok.body.datos).toMatchObject({ estado: 'validada', validadaPor: medico.usuario.nombre });
    expect((await Auditoria.findOne({ accion: 'receta.validar', entidadId: receta.id })).autorizadoPor).toEqual(medico.usuario._id);
    expect((await validar(pinMedico())).status).toBe(409);
  });

  test('una receta validada ya no se edita', async () => {
    expect((await api(cajero, 'put', `/api/recetas/${receta.id}`).send(recetaBase())).status).toBe(409);
  });
});

describe('surtir desde la caja', () => {
  test('sin receta → 409 RECETA_REQUERIDA', async () => {
    const res = await vender({ partidas: [{ producto: String(antibiotico._id), cantidad: 1 }], pagos: [{ metodo: 'efectivo', monto: 34900 }] });
    expect(res.body.codigo).toBe('RECETA_REQUERIDA');
  });

  test('recetas disponibles para un producto (la caja las ofrece)', async () => {
    const res = await api(cajero, 'get', `/api/recetas/disponibles?producto=${antibiotico._id}`);
    expect(res.body.datos.map(r => [r.folio, r.partida.pendiente])).toEqual([[1, 6]]);
  });

  let ventaParcial;
  test('surte 4 de 6: guarda lo entregado con lotes FEFO; la venta queda ligada a la receta', async () => {
    const res = await venderAntibiotico(receta.id, 4);
    expect(res.status).toBe(201);
    ventaParcial = res.body.datos;
    expect(ventaParcial.partidas[0].receta).toBe(receta.id);
    const r = (await api(cajero, 'get', `/api/recetas/${receta.id}`)).body.datos;
    expect(r.estado).toBe('validada');
    expect(r.partidas[0]).toMatchObject({ cantidadEntregada: 4, pendiente: 2 });
    expect(r.partidas[0].entregas[0]).toMatchObject({ folio: `V-${ventaParcial.folio}`, cantidad: 4, lotes: [{ lote: 'L1', cantidad: 4 }] });
  });

  test('pedir más de lo pendiente → 409 RECETA_EXCEDIDA y no se descuenta inventario', async () => {
    const antes = await restante(antibiotico);
    const res = await venderAntibiotico(receta.id, 3);
    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe('RECETA_EXCEDIDA');
    expect(res.body.mensaje).toMatch(/solo permite surtir 2 más/);
    expect(await restante(antibiotico)).toBe(antes);
  });

  let ventaFinal;
  test('surtir lo que falta la deja SURTIDA; ya no aparece como disponible', async () => {
    const res = await venderAntibiotico(receta.id, 2);
    expect(res.status).toBe(201);
    ventaFinal = res.body.datos;
    expect((await api(cajero, 'get', `/api/recetas/${receta.id}`)).body.datos.estado).toBe('surtida');
    expect((await api(cajero, 'get', `/api/recetas/disponibles?producto=${antibiotico._id}`)).body.datos).toEqual([]);
    expect((await venderAntibiotico(receta.id, 1)).body.codigo).toBe('RECETA_NO_VALIDA');
  });

  test('cancelar la venta devuelve lo surtido a la receta (vuelve a validada)', async () => {
    const res = await api(cajero, 'post', `/api/ventas/${ventaFinal.id}/cancelar`).send({ motivo: 'Error de captura', autorizacion: { usuario: dueno.usuario.usuario, pin: '4821' } });
    expect(res.status).toBe(200);
    const r = (await api(cajero, 'get', `/api/recetas/${receta.id}`)).body.datos;
    expect(r.estado).toBe('validada');
    expect(r.partidas[0]).toMatchObject({ cantidadEntregada: 4, pendiente: 2 });
    expect(r.partidas[0].entregas.map(e => e.folio)).toEqual([`V-${ventaParcial.folio}`]);
  });

  test('una receta de otra sucursal no se puede surtir aquí', async () => {
    const recetaB = await Receta.create({ ...recetaBase(), fechaReceta: new Date(), sucursal: B._id, folio: 99, usuario: dueno.usuario._id, estado: 'validada', partidas: [{ producto: antibiotico._id, sku: 'ANT', nombre: 'Antibiótico', unidad: 'pieza', cantidadPrescrita: 5 }] });
    const res = await venderAntibiotico(String(recetaB._id), 1);
    expect(res.status).toBe(404);
    expect((await api(cajero, 'get', `/api/recetas/${recetaB._id}`)).status).toBe(404);
  });
});

describe('archivo y controlados', () => {
  let controlada;
  test('un controlado no se valida sin archivo', async () => {
    controlada = (await api(cajero, 'post', '/api/recetas').send(recetaBase({ partidas: [{ producto: String(tramadol._id), cantidadPrescrita: 2 }] }))).body.datos;
    const res = await api(cajero, 'post', `/api/recetas/${controlada.id}/validar`).send({ autorizacion: pinMedico() });
    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe('ARCHIVO_REQUERIDO');
  });

  test('subir archivo: valida tipo, contenido y tamaño', async () => {
    const subir = (cuerpo, tipo) => api(cajero, 'put', `/api/recetas/${controlada.id}/archivo`).set('Content-Type', tipo).set('X-Nombre-Archivo', encodeURIComponent('receta tramadol.png')).send(cuerpo);
    expect((await subir('hola', 'text/plain')).status).toBe(400);
    expect((await subir(PNG, 'image/jpeg')).status).toBe(400); // dice JPG pero es PNG
    expect((await subir(Buffer.alloc(6 * 1024 * 1024, 0xff), 'image/jpeg')).status).toBe(413);
    const ok = await subir(PNG, 'image/png');
    expect(ok.status).toBe(200);
    expect(ok.body.datos).toMatchObject({ nombre: 'receta tramadol.png', tipo: 'image/png', tamano: PNG.length });
  });

  test('el archivo se guarda fuera de Mongo y se descarga igual', async () => {
    const doc = await Receta.findOne({ _id: controlada.id, sucursal: A._id }).lean();
    expect(doc.archivo.clave).toMatch(/^recetas\/.+\.png$/);
    expect(fs.existsSync(path.join(CARPETA, doc.archivo.clave))).toBe(true);
    const res = await api(cajero, 'get', `/api/recetas/${controlada.id}/archivo`).buffer(true).parse((r, cb) => {
      const partes = [];
      r.on('data', c => partes.push(c));
      r.on('end', () => cb(null, Buffer.concat(partes)));
    });
    expect(res.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(res.body, PNG)).toBe(0);
  });

  test('con archivo, el médico la valida y se surte', async () => {
    expect((await api(cajero, 'post', `/api/recetas/${controlada.id}/validar`).send({ autorizacion: pinMedico() })).status).toBe(200);
    const v = await vender({ partidas: [{ producto: String(tramadol._id), cantidad: 2, receta: controlada.id }], pagos: [{ metodo: 'efectivo', monto: 100000 }] });
    expect(v.status).toBe(201);
  });
});

describe('historial y cancelación de receta', () => {
  test('filtra por estado, producto y texto (paciente, propietario, médico)', async () => {
    const surtidas = await api(medico, 'get', '/api/recetas?estado=surtida');
    expect(surtidas.body.datos.map(r => r.partidas[0].sku)).toEqual(['TRA']);
    const porProducto = await api(medico, 'get', `/api/recetas?producto=${antibiotico._id}`);
    expect(porProducto.body.total).toBe(1);
    const porTexto = await api(medico, 'get', '/api/recetas?q=firu');
    expect(porTexto.body.total).toBe(2);
    expect((await api(medico, 'get', '/api/recetas?q=nadie')).body.total).toBe(0);
  });

  test('no se cancela una receta con entregas; una pendiente sí', async () => {
    expect((await api(cajero, 'post', `/api/recetas/${receta.id}/cancelar`).send({ motivo: 'Prueba' })).status).toBe(409);
    const nueva = (await api(cajero, 'post', '/api/recetas').send(recetaBase())).body.datos;
    const res = await api(cajero, 'post', `/api/recetas/${nueva.id}/cancelar`).send({ motivo: 'Capturada dos veces' });
    expect(res.body.datos.estado).toBe('cancelada');
  });

  test('el almacén no tiene acceso a recetas', async () => {
    expect((await api(almacen, 'get', '/api/recetas')).status).toBe(403);
  });
});

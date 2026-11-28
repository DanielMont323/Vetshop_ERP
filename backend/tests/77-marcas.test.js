// Marcas en notas y tickets: «Vet Shop» para clientes con negocio y «Huellitas Vetshop» para mostrador, con sus datos
// y logos (Administración), y el formato de la nota del PDF de Carlos (precios sin IVA, IVA por renglón, pagaré).
const { randomUUID } = require('crypto');
const h = require('./helpers/app');
const Producto = require('../models/Producto');
const inv = require('../services/inventario');
const precios = require('../services/precios');
const { conTransaccion } = require('../helpers/transaccion');

let A, dueno, cajero, collar, croqueta, clinica, ana;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

beforeAll(async () => {
  await h.resetDb();
  A = await h.crearSucursal({ nombre: 'Centro' });
  dueno = await h.sesion({ rol: 'dueno', pin: '4821' });
  cajero = await h.sesion({ rol: 'cajero', sucursales: [A._id] });
  collar = await Producto.create({ sku: 'COL', nombre: 'Collar', categoria: 'accesorio', unidad: 'pieza', iva: 'tasa_16' });
  croqueta = await Producto.create({ sku: 'CRQ', nombre: 'Croqueta', categoria: 'alimento', unidad: 'pieza', iva: 'tasa_0' });
  await precios.fijarPrecio({ clave: 'publico', productoId: collar._id, precio: 11600 }, dueno.usuario);
  await precios.fijarPrecio({ clave: 'publico', productoId: croqueta._id, precio: 50000 }, dueno.usuario);
  await conTransaccion(async s => {
    for (const p of [collar, croqueta]) await inv.registrarEntrada({ sucursal: A._id, producto: p._id, cantidad: 100, costoUnitario: 100, caducidad: '12/2028', origen: 'compra', usuario: dueno.usuario._id }, s);
  });
  await h.abrirTurno(cajero, A);
  clinica = (await h.request(h.app).post('/api/clientes').set(h.auth(dueno.token)).send({
    nombre: 'Montserrat (prueba)', tipo: 'clinica', listaPrecios: 'publico', rfc: 'NALE870119HFA', direccion: 'Río Suchiate 53', telefono: '311-100-8951',
    fiscal: { codigoPostal: '63190' }
  })).body.datos;
  ana = (await h.request(h.app).post('/api/clientes/rapido').set(h.auth(cajero.token)).send({ nombre: 'Ana (prueba)' })).body.datos;
});
afterAll(h.cerrar);

const api = (s, metodo, ruta) => h.request(h.app)[metodo](ruta).set(h.auth(s.token, A));
const vender = (cliente, partidas) => api(cajero, 'post', '/api/ventas').send({
  claveOperacion: randomUUID(), cliente, partidas, pagos: [{ metodo: 'efectivo', monto: 10000000 }], autorizacion: { usuario: dueno.usuario.usuario, pin: '4821' }
}).then(r => r.body.datos);

describe('marcas', () => {
  test('valores por defecto; solo el dueño las cambia; logos validados', async () => {
    const m = (await api(cajero, 'get', '/api/configuracion/marcas')).body.datos;
    expect(m.negocio).toMatchObject({ nombre: 'Vet Shop', lema: 'Impulsando el cuidado que ellos merecen', logo: null });
    expect(m.mostrador.nombre).toBe('Huellitas Vetshop');
    expect((await api(cajero, 'put', '/api/configuracion/marcas').send({ negocio: { rfc: 'LOPE930902KG2' } })).status).toBe(403);
    const r = await api(dueno, 'put', '/api/configuracion/marcas').send({ negocio: { rfc: 'lope930902kg2', direccion: 'Praxedis Guerrero 1198\nPuerta de Belén' }, mostrador: { lema: 'Tu tienda de mascotas' } });
    expect(r.body.datos.negocio).toMatchObject({ rfc: 'LOPE930902KG2', direccion: 'Praxedis Guerrero 1198\nPuerta de Belén' });
    expect((await api(dueno, 'put', '/api/configuracion/marcas').send({ negocio: { rfc: 'XX' } })).status).toBe(400);
    expect((await api(dueno, 'put', '/api/configuracion/logos/negocio').send({ imagen: 'data:text/html;base64,PHNjcmlwdD4=' })).status).toBe(400);
    expect((await api(dueno, 'put', '/api/configuracion/logos/otro').send({ imagen: PNG })).status).toBe(400);
    expect((await api(dueno, 'put', '/api/configuracion/logos/negocio').send({ imagen: PNG })).body.datos.negocio.logo).toBe(PNG);
    expect((await api(dueno, 'put', '/api/configuracion/logos/pie-0').send({ imagen: PNG })).body.datos.pie).toHaveLength(1);
    // La configuración general (la que lee la caja) no carga los logos
    expect(JSON.stringify((await api(cajero, 'get', '/api/configuracion')).body)).not.toContain('base64');
  });

  test('nota de cliente con negocio: Vet Shop, formato del PDF, logos y pagaré', async () => {
    const v = await vender(clinica.id, [{ producto: collar._id, cantidad: 3 }, { producto: croqueta._id, cantidad: 1, descuentoPorcentaje: 1000 }]);
    const r = await api(cajero, 'get', `/api/ventas/${v.id}/nota`);
    expect(r.headers['content-security-policy']).toContain('img-src data:');
    expect(r.text).toContain('<h1>Vet Shop</h1>');
    expect(r.text).toContain('RFC: LOPE930902KG2');
    expect(r.text).toContain('<div>Puerta de Belén</div>');
    expect(r.text).toContain(`src="${PNG}"`);
    expect(r.text).toContain('RFC: NALE870119HFA');
    expect(r.text).toContain('C.P: 63190');
    // Collar: $116 con IVA → 100.00 sin IVA, total 300.00, IVA 48.00, tasa 16 %
    expect(r.text).toMatch(/<td class="n">100\.00<\/td><td class="n">300\.00<\/td>\s*<td class="n">48\.00<\/td><td class="n">16%<\/td>/);
    // Subtotal sin descuento 300 + 500; descuento 10 % de la croqueta (50.00 de 800.00 = 6.3 %)
    expect(r.text).toContain('<td>Subt. Sin descuento</td><td>800.00</td>');
    expect(r.text).toContain('<td>Descuento</td><td>6.3% (50.00)</td>');
    expect(r.text).toContain('<td>TOTAL</td><td>798.00</td>');
    expect(r.text).toContain('Por el presente pagaré');
    expect(r.text).toContain(`${'V'}-${String(v.folio).padStart(4, '0')}`);
  });

  test('ticket de mostrador: Huellitas Vetshop; ticket de cliente con negocio: Vet Shop', async () => {
    const pg = await vender(undefined, [{ producto: collar._id, cantidad: 1 }]);
    const t1 = await api(cajero, 'get', `/api/ventas/${pg.id}/ticket`);
    expect(t1.text).toContain('<h1>Huellitas Vetshop</h1>');
    expect(t1.text).toContain('Tu tienda de mascotas');
    expect(t1.text).not.toContain(PNG); // el mostrador no tiene logo
    const va = await vender(ana.id, [{ producto: collar._id, cantidad: 1 }]);
    expect((await api(cajero, 'get', `/api/ventas/${va.id}/ticket`)).text).toContain('<h1>Huellitas Vetshop</h1>');
    const vc = await vender(clinica.id, [{ producto: collar._id, cantidad: 1 }]);
    const t3 = await api(cajero, 'get', `/api/ventas/${vc.id}/ticket`);
    expect(t3.text).toContain('<h1>Vet Shop</h1>');
    expect(t3.text).toContain(PNG);
    expect((await api(dueno, 'delete', '/api/configuracion/logos/negocio')).body.datos.negocio.logo).toBeNull();
  });
});

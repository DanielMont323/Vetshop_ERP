// Catálogo de productos: CRUD, búsqueda por nombre/SKU/código de barras, permisos y bitácora.
const h = require('./helpers/app');
const Producto = require('../models/Producto');
const { Auditoria } = h.modelos;

let centro, norte, dueno, cajero;
beforeAll(async () => {
  await h.resetDb();
  centro = await h.crearSucursal({ nombre: 'Centro' });
  norte = await h.crearSucursal({ nombre: 'Norte' });
  dueno = await h.sesion({ rol: 'dueno' });
  cajero = await h.sesion({ rol: 'cajero', sucursales: [centro._id] });
});
afterAll(h.cerrar);

const api = (metodo, ruta, token = dueno.token) => h.request(h.app)[metodo](ruta).set(h.auth(token));

let n = 0;
const base = (extra = {}) => {
  n += 1;
  return { sku: `PRD-${n}`, nombre: `Producto ${n}`, categoria: 'accesorio', unidad: 'pieza', iva: 'tasa_16', ...extra };
};

describe('POST /api/productos', () => {
  test('el dueño crea un producto con precios y mínimos; queda en bitácora', async () => {
    const res = await api('post', '/api/productos').send(base({
      sku: 'crq-ad-20',
      codigoBarras: '7501234567890',
      nombre: 'Croquetas Perro Adulto 20 kg',
      categoria: 'alimento',
      presentacion: 'Costal 20 kg',
      iva: 'tasa_0',
      minimos: [{ sucursal: String(centro._id), cantidad: 5 }],
      precios: { publico: 129900, mayoreo: 115000 }
    }));
    expect(res.status).toBe(201);
    expect(res.body.datos).toMatchObject({
      sku: 'CRQ-AD-20', // en mayúsculas
      codigoBarras: '7501234567890',
      unidad: 'pieza',
      iva: 'tasa_0',
      activo: true,
      precios: { publico: 129900, mayoreo: 115000 },
      minimos: [{ sucursal: String(centro._id), cantidad: 5 }]
    });
    expect(res.body.datos.nombreBusqueda).toBeUndefined();

    const id = res.body.datos.id;
    expect(await Auditoria.countDocuments({ accion: 'producto.crear', entidadId: id })).toBe(1);
    expect(await Auditoria.countDocuments({ accion: 'precio.cambiar', entidadId: id })).toBe(2);
  });

  test('alimento a granel por kg con mínimo en gramos', async () => {
    const res = await api('post', '/api/productos').send(base({
      nombre: 'Croqueta a granel gato', categoria: 'alimento', unidad: 'kg', iva: 'tasa_0',
      minimos: [{ sucursal: String(norte._id), cantidad: 15000 }], // 15 kg
      precios: { publico: 8990 } // $89.90 por kg
    }));
    expect(res.status).toBe(201);
    expect(res.body.datos).toMatchObject({ unidad: 'kg', precios: { publico: 8990 } });
  });

  test('un medicamento controlado siempre requiere receta', async () => {
    const res = await api('post', '/api/productos').send(base({ categoria: 'medicamento', esControlado: true, requiereReceta: false, iva: 'tasa_0' }));
    expect(res.status).toBe(201);
    expect(res.body.datos).toMatchObject({ esControlado: true, requiereReceta: true });
  });

  test('SKU o código de barras repetidos → 409 (y no queda nada a medias)', async () => {
    await api('post', '/api/productos').send(base({ sku: 'UNICO-1', codigoBarras: '1111222233334' }));
    const sku = await api('post', '/api/productos').send(base({ sku: 'unico-1' }));
    expect(sku.status).toBe(409);
    const codigo = await api('post', '/api/productos').send(base({ codigoBarras: '1111222233334', precios: { publico: 100 } }));
    expect(codigo.status).toBe(409);
    expect(await Producto.countDocuments({ codigoBarras: '1111222233334' })).toBe(1);
  });

  test('varios productos SIN código de barras no chocan', async () => {
    expect((await api('post', '/api/productos').send(base())).status).toBe(201);
    expect((await api('post', '/api/productos').send(base({ codigoBarras: '' }))).status).toBe(201);
  });

  test('validaciones → 400', async () => {
    const casos = {
      'falta nombre': base({ nombre: undefined }),
      'categoría inválida': base({ categoria: 'juguetes' }),
      'unidad inválida': base({ unidad: 'litro' }),
      'iva inválido': base({ iva: '16' }),
      'sku con espacios': base({ sku: 'CON ESPACIO' }),
      'código raro': base({ codigoBarras: 'ab' }),
      'precio con decimales': base({ precios: { publico: 129.9 } }),
      'precio como texto': base({ precios: { publico: '12990' } }),
      'precio negativo': base({ precios: { publico: -1 } }),
      'lista desconocida': base({ precios: { vip: 100 } }),
      'mínimo con decimales': base({ minimos: [{ sucursal: String(centro._id), cantidad: 1.5 }] }),
      'mínimo de sucursal inexistente': base({ minimos: [{ sucursal: '64b7f0c2a1b2c3d4e5f60718', cantidad: 1 }] }),
      'mínimo repetido': base({ minimos: [{ sucursal: String(centro._id), cantidad: 1 }, { sucursal: String(centro._id), cantidad: 2 }] }),
      'booleano como texto': base({ requiereReceta: 'true' })
    };
    for (const [caso, cuerpo] of Object.entries(casos)) {
      const res = await api('post', '/api/productos').send(cuerpo);
      expect({ caso, status: res.status }).toEqual({ caso, status: 400 });
    }
  });

  test('cajero, almacén y médico NO pueden crear (403)', async () => {
    for (const rol of ['cajero', 'almacen', 'medico_responsable']) {
      const s = await h.sesion({ rol, sucursales: [centro._id] });
      expect((await api('post', '/api/productos', s.token).send(base())).status).toBe(403);
    }
  });
});

describe('búsqueda', () => {
  beforeAll(async () => {
    await api('post', '/api/productos').send(base({ sku: 'VAC-RAB', codigoBarras: '7509990001112', nombre: 'Vacuna Antirrábica Canina', categoria: 'biologico', requiereRefrigeracion: true, iva: 'tasa_0', precios: { publico: 25000 } }));
    await api('post', '/api/productos').send(base({ sku: 'COLLAR-M', nombre: 'Collar Nylon Mediano', precios: { publico: 14900 } }));
    await api('post', '/api/productos').send(base({ sku: 'SHAMP-1', nombre: 'Shampoo Pulgas (1+1)', categoria: 'higiene', activo: false }));
  });

  const buscar = (qs, token = cajero.token) => api('get', `/api/productos?${qs}`, token);
  const nombres = res => res.body.datos.map(p => p.nombre);

  test('por nombre sin acentos ni mayúsculas, palabras sueltas en cualquier orden', async () => {
    expect(nombres(await buscar('q=antirrabica'))).toEqual(['Vacuna Antirrábica Canina']);
    expect(nombres(await buscar('q=CANINA%20vac'))).toEqual(['Vacuna Antirrábica Canina']);
    expect(nombres(await buscar('q=croq%20adul'))).toEqual(['Croquetas Perro Adulto 20 kg']);
  });

  test('por código de barras exacto y por SKU (sin distinguir mayúsculas)', async () => {
    expect(nombres(await buscar('q=7509990001112'))).toEqual(['Vacuna Antirrábica Canina']);
    expect(nombres(await buscar('q=collar-m'))).toEqual(['Collar Nylon Mediano']);
  });

  test('los caracteres especiales se buscan literal (sin inyección de regex)', async () => {
    expect(nombres(await buscar(`q=${encodeURIComponent('(1+1)')}`))).toEqual(['Shampoo Pulgas (1+1)']);
    expect((await buscar(`q=${encodeURIComponent('.*')}`)).body.datos).toEqual([]);
  });

  test('filtros por categoría y activo; incluye los precios', async () => {
    const bio = await buscar('categoria=biologico');
    expect(nombres(bio)).toEqual(['Vacuna Antirrábica Canina']);
    expect(bio.body.datos[0].precios).toEqual({ publico: 25000 });
    expect(nombres(await buscar('activo=false'))).toEqual(['Shampoo Pulgas (1+1)']);
  });

  test('paginación con total; límite máximo 100', async () => {
    const res = await buscar('limite=2&pagina=1');
    expect(res.body.datos).toHaveLength(2);
    expect(res.body.total).toBeGreaterThan(2);
    const p2 = await buscar('limite=2&pagina=2');
    expect(p2.body.datos[0].id).not.toBe(res.body.datos[0].id);
    expect((await buscar('limite=500')).status).toBe(400);
  });

  test('lector de código de barras: GET /api/productos/codigo/:codigo', async () => {
    const res = await api('get', '/api/productos/codigo/7509990001112', cajero.token);
    expect(res.status).toBe(200);
    expect(res.body.datos).toMatchObject({ sku: 'VAC-RAB', requiereRefrigeracion: true, precios: { publico: 25000 } });
    expect((await api('get', '/api/productos/codigo/vac-rab', cajero.token)).body.datos.sku).toBe('VAC-RAB');
    expect((await api('get', '/api/productos/codigo/0000000000000', cajero.token)).status).toBe(404);
    // un código parcial NO encuentra nada (el lector siempre manda el código completo)
    expect((await api('get', '/api/productos/codigo/750999', cajero.token)).status).toBe(404);
  });

  test('los 4 roles pueden consultar (catalogo:ver); sin sesión → 401', async () => {
    for (const rol of ['almacen', 'medico_responsable']) {
      const s = await h.sesion({ rol, sucursales: [centro._id] });
      expect((await buscar('q=collar', s.token)).status).toBe(200);
    }
    expect((await h.request(h.app).get('/api/productos')).status).toBe(401);
  });
});

describe('PATCH /api/productos/:id', () => {
  test('modifica campos y precios en una sola operación; bitácora con antes y después', async () => {
    const creado = (await api('post', '/api/productos').send(base({ nombre: 'Pecho Tal', precios: { publico: 10000, empleado: 8000 } }))).body.datos;
    const res = await api('patch', `/api/productos/${creado.id}`).send({ nombre: 'Pechera Talla M', precios: { publico: 11000, empleado: null, clinica: 9500 } });
    expect(res.status).toBe(200);
    expect(res.body.datos).toMatchObject({ nombre: 'Pechera Talla M', precios: { publico: 11000, clinica: 9500 } });
    expect(res.body.datos.precios.empleado).toBeUndefined();

    const cambio = await Auditoria.findOne({ accion: 'producto.actualizar', entidadId: creado.id });
    expect(cambio.antes.nombre).toBe('Pecho Tal');
    expect(cambio.despues.nombre).toBe('Pechera Talla M');
    const publico = await Auditoria.findOne({ accion: 'precio.cambiar', entidadId: creado.id, 'despues.precio': 11000 });
    expect(publico.antes).toEqual({ lista: 'publico', precio: 10000 });
    expect(await Auditoria.countDocuments({ accion: 'precio.quitar', entidadId: creado.id })).toBe(1);

    // la búsqueda usa el nombre nuevo
    expect((await api('get', '/api/productos?q=pechera')).body.datos.map(p => p.id)).toEqual([creado.id]);
  });

  test('desactivar en lugar de borrar; quitar el código de barras con ""', async () => {
    const creado = (await api('post', '/api/productos').send(base({ codigoBarras: '5550001112223' }))).body.datos;
    const res = await api('patch', `/api/productos/${creado.id}`).send({ activo: false, codigoBarras: '' });
    expect(res.body.datos).toMatchObject({ activo: false, codigoBarras: null });
    expect((await api('delete', `/api/productos/${creado.id}`)).status).toBe(404); // no existe la ruta
  });

  test('sin cambios reales no escribe en la bitácora', async () => {
    const creado = (await api('post', '/api/productos').send(base({ precios: { publico: 500 } }))).body.datos;
    await api('patch', `/api/productos/${creado.id}`).send({ nombre: creado.nombre, precios: { publico: 500 } });
    expect(await Auditoria.countDocuments({ entidadId: creado.id, accion: { $in: ['producto.actualizar', 'precio.cambiar'] } })).toBe(1);
  });

  test('si un precio falla, el cambio del producto también se revierte (transacción)', async () => {
    const creado = (await api('post', '/api/productos').send(base({ nombre: 'Original' }))).body.datos;
    const svc = require('../services/productos');
    await expect(svc.actualizar(creado.id, { nombre: 'Cambiado', precios: { publico: 1.5 } }, dueno.usuario)).rejects.toMatchObject({ status: 400 });
    expect((await Producto.findById(creado.id)).nombre).toBe('Original');
  });

  test('cajero no modifica (403); id inválido 400; inexistente 404', async () => {
    const creado = (await api('post', '/api/productos').send(base())).body.datos;
    expect((await api('patch', `/api/productos/${creado.id}`, cajero.token).send({ nombre: 'x' })).status).toBe(403);
    expect((await api('patch', '/api/productos/xyz').send({ nombre: 'x' })).status).toBe(400);
    expect((await api('patch', '/api/productos/64b7f0c2a1b2c3d4e5f60718').send({ nombre: 'x' })).status).toBe(404);
  });
});

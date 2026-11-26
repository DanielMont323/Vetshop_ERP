// Driver de Vercel Blob (simulado: no toca la red): guarda con acceso PRIVADO, lee por la clave y exige el token.
const mockGuardados = new Map();
jest.mock('@vercel/blob', () => ({
  put: jest.fn(async (clave, buffer, opciones) => {
    mockGuardados.set(clave, { buffer: Buffer.from(buffer), opciones });
    return { pathname: clave, url: `https://blob.ejemplo/${clave}` };
  }),
  get: jest.fn(async clave => {
    const g = mockGuardados.get(clave);
    return g ? { stream: new Response(g.buffer).body } : null;
  })
}));

const almacenamiento = require('../services/almacenamiento');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

beforeEach(() => {
  process.env.ALMACENAMIENTO = 'vercel_blob';
  process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_prueba';
});
afterAll(() => {
  process.env.ALMACENAMIENTO = 'local';
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

test('guarda en privado con una clave del servidor y la lee igual', async () => {
  const r = await almacenamiento.guardar(PNG, { tipo: 'image/png', nombre: 'receta.png' });
  expect(r.clave).toMatch(/^recetas\/[0-9a-f-]{36}\.png$/);
  expect(mockGuardados.get(r.clave).opciones).toMatchObject({ access: 'private', addRandomSuffix: false, contentType: 'image/png' });
  expect(await almacenamiento.leer(r.clave)).toEqual(PNG);
});

test('el XML de una factura también va a Blob', async () => {
  const clave = await almacenamiento.guardarGenerado('<cfdi/>', { extension: 'xml', prefijo: 'facturas' });
  expect(clave).toMatch(/^facturas\/.+\.xml$/);
  expect((await almacenamiento.leer(clave)).toString()).toBe('<cfdi/>');
});

test('sin token responde 503 claro; un archivo que no existe, 404', async () => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  await expect(almacenamiento.guardar(PNG, { tipo: 'image/png' })).rejects.toMatchObject({ status: 503, codigo: 'ALMACENAMIENTO_NO_CONFIGURADO' });
  process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_prueba';
  await expect(almacenamiento.leer('recetas/no-existe.png')).rejects.toMatchObject({ status: 404 });
});

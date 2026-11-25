// Entorno de pruebas. ABORTA si la base no es el Mongo en memoria local:
// las pruebas borran la base completa y nunca deben tocar Atlas.
const uri = process.env.MONGO_URI_PRUEBAS || '';
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/vetshop-pruebas\?/.test(uri)) {
  throw new Error(`[GUARDIA] URI de pruebas inválida (${uri || 'vacía'}). Solo se permite el Mongo en memoria.`);
}

process.env.MONGODB_URI = uri;
process.env.JWT_SECRET = 'secreto-solo-para-pruebas';
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = 'http://localhost:5173';

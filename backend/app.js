// Construye la app de Express (sin escuchar en un puerto): la usan server.js, Vercel y las pruebas.
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { conectar } = require('./config/database');
const { rutaNoEncontrada, manejarErrores } = require('./middleware/errores');

// CORS: solo los orígenes de CORS_ORIGINS (separados por comas) pueden llamar desde un navegador.
// Las peticiones sin Origin (curl, scripts, pruebas) no pasan por CORS: las protege el token.
function opcionesCors() {
  const permitidos = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      callback(null, permitidos.includes(origin));
    },
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Sucursal'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    maxAge: 600
  };
}

function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Vercel pone la IP real en X-Forwarded-For

  app.use(helmet());
  app.use(cors(opcionesCors()));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/salud', (req, res) => {
    res.json({ ok: true, estado: 'OK', fecha: new Date().toISOString() });
  });

  // A partir de aquí todas las rutas necesitan la BD (conexión cacheada en serverless).
  app.use(async (req, res, next) => {
    try {
      await conectar();
      next();
    } catch (error) {
      next(error);
    }
  });

  app.use(rutaNoEncontrada);
  app.use(manejarErrores);
  return app;
}

module.exports = { crearApp };

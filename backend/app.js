// Construye la app de Express (sin escuchar en un puerto): la usan server.js, Vercel y las pruebas.
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { conectar } = require('./config/database');
const { rutaNoEncontrada, manejarErrores } = require('./middleware/errores');
const { autenticar } = require('./middleware/auth');
const { scopeSucursal } = require('./middleware/scopeSucursal');

// CORS: solo los orígenes de CORS_ORIGINS (separados por comas) pueden llamar desde un navegador.
// Un origen puede llevar UN «*» en el nombre del subdominio para aceptar las direcciones de cada despliegue
// y vista previa de Vercel, p. ej. https://vetshop-*-noctra15.vercel.app («*» = letras, números y guiones).
// Las peticiones sin Origin (curl, scripts, pruebas) no pasan por CORS: las protege el token.
function patronOrigen(texto) {
  const escapado = texto.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '[a-z0-9-]+');
  return new RegExp(`^${escapado}$`, 'i');
}

function opcionesCors() {
  const permitidos = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean).map(patronOrigen);
  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      callback(null, permitidos.some(p => p.test(origin)));
    },
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Sucursal', 'X-Nombre-Archivo'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    maxAge: 600
  };
}

// Rutas OPERATIVAS (datos por sucursal): se montan con autenticar + scopeSucursal.
// Se irán agregando en los pasos siguientes (existencias, ventas, cortes, traspasos…).
const RUTAS_OPERATIVAS = [
  ['/api/existencias', require('./routes/existencias')],
  ['/api/inventario', require('./routes/inventario')],
  ['/api/compras', require('./routes/compras')],
  ['/api/ventas', require('./routes/ventas')],
  ['/api/recetas', require('./routes/recetas')],
  ['/api/turnos', require('./routes/turnos')],
  ['/api/traspasos', require('./routes/traspasos')],
  ['/api/reportes', require('./routes/reportes')],
  ['/api/cobranza', require('./routes/cobranza')],
  ['/api/conteos', require('./routes/conteos')],
  ['/api/cadena-frio', require('./routes/cadenaFrio')],
  ['/api/metas', require('./routes/metas')],
  ['/api/facturas', require('./routes/facturas')],
  ['/api/recordatorios', require('./routes/recordatorios')],
  ['/api/pedidos', require('./routes/pedidos')]
];

// opciones.rutasOperativas: rutas extra montadas igual que las operativas (las usan las pruebas)
function crearApp({ rutasOperativas = [] } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Vercel pone la IP real en X-Forwarded-For

  app.use(helmet());
  app.use(cors(opcionesCors()));
  app.use(express.json({ limit: '1mb' }));
  // Datos de negocio: que ni el navegador ni un proxy guarden copias
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

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

  // Rutas globales (sin alcance de sucursal)
  app.use('/api/auth', require('./routes/auth'));
  // Pública: autofactura de clientes (con límite de intentos por IP)
  app.use('/api/autofactura', require('./routes/autofactura'));
  app.use('/api/usuarios', autenticar, require('./routes/usuarios'));
  app.use('/api/sucursales', autenticar, require('./routes/sucursales'));
  app.use('/api/productos', autenticar, require('./routes/productos'));
  app.use('/api/listas-precios', autenticar, require('./routes/listasPrecios'));
  app.use('/api/proveedores', autenticar, require('./routes/proveedores'));
  app.use('/api/clientes', autenticar, require('./routes/clientes'));
  app.use('/api/configuracion', autenticar, require('./routes/configuracion'));
  app.use('/api/promociones', autenticar, require('./routes/promociones'));
  app.use('/api/mascotas', autenticar, require('./routes/mascotas'));
  app.use('/api/cuentas-por-pagar', autenticar, require('./routes/cuentasPorPagar'));

  // Rutas operativas: siempre autenticar → scopeSucursal → router
  for (const [ruta, router] of [...RUTAS_OPERATIVAS, ...rutasOperativas]) {
    app.use(ruta, autenticar, scopeSucursal, router);
  }

  app.use(rutaNoEncontrada);
  app.use(manejarErrores);
  return app;
}

module.exports = { crearApp };

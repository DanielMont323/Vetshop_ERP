// Ventas (ruta operativa: autenticar + scopeSucursal).
// No hay PUT ni DELETE de ventas: una venta cobrada es inmutable; solo se cancela con autorización.
const express = require('express');
const { body, param, query } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const { tienePermiso } = require('../config/permisos');
const ventas = require('../services/ventas');
const Sucursal = require('../models/Sucursal');
const { METODOS_PAGO } = require('../models/Venta');
const { htmlTicket } = require('../helpers/ticket');

const router = express.Router();
const id = param('id').isMongoId().withMessage('Id de venta inválido');
const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;
const entero = (min, max) => v => v === undefined || (Number.isSafeInteger(v) && v >= min && (max === undefined || v <= max));
const cobrar = requirePermiso('ventas:cobrar');

// Qué puede ver quien consulta
const vision = req => ({
  verTodas: tienePermiso(req.user.rol, 'ventas:ver_todas'),
  verCostos: tienePermiso(req.user.rol, 'reportes:ver')
});
function puedeConsultar(req, res, next) {
  const { verTodas } = vision(req);
  if (verTodas || tienePermiso(req.user.rol, 'ventas:ver_propias_del_dia')) return next();
  return requirePermiso('ventas:ver_todas')(req, res, next);
}

const reglasPartidas = [
  body('partidas').isArray({ min: 1, max: 100 }).withMessage('La venta debe tener entre 1 y 100 partidas'),
  body('partidas.*.producto').isMongoId().withMessage('Producto inválido'),
  body('partidas.*.cantidad').custom(entero(1)).withMessage('Cantidad: entero > 0 (piezas o gramos)'),
  body('partidas.*.descuentoPorcentaje').optional().custom(entero(0, 10000)).withMessage('Descuento %: puntos base de 0 a 10000'),
  body('partidas.*.descuentoMonto').optional().custom(entero(0)).withMessage('Descuento: centavos enteros ≥ 0'),
  body('partidas.*.descuentoMotivo').optional().isString().trim().isLength({ min: 1, max: 40 }).withMessage('Motivo de descuento: hasta 40 caracteres'),
  body('partidas.*.receta').optional().isMongoId().withMessage('Receta inválida')
];
const reglasAutorizacion = [
  body('autorizacion').optional().isObject(),
  body('autorizacion.usuario').if(body('autorizacion').exists()).isString().trim().notEmpty().withMessage('Falta el usuario que autoriza'),
  body('autorizacion.pin').if(body('autorizacion').exists()).isString().notEmpty().withMessage('Falta el PIN')
];

// POST /api/ventas/cotizar — precios que aplicaría el servidor (lista, mayoreo por cantidad o promoción)
router.post(
  '/cotizar',
  cobrar,
  validar([
    body('cliente').optional().isMongoId().withMessage('Cliente inválido'),
    body('partidas').isArray({ min: 1, max: 100 }).withMessage('De 1 a 100 partidas'),
    body('partidas.*.producto').isMongoId().withMessage('Producto inválido'),
    body('partidas.*.cantidad').custom(entero(1)).withMessage('Cantidad: entero > 0 (piezas o gramos)')
  ]),
  async (req, res) => {
    res.json({ ok: true, datos: await ventas.cotizar(req.alcance, req.datos) });
  }
);

// POST /api/ventas — cobrar
router.post(
  '/',
  cobrar,
  validar([
    body('claveOperacion').isString().trim().isLength({ min: 8, max: 64 }).withMessage('Falta la clave de operación (evita cobrar dos veces)'),
    body('cliente').optional().isMongoId().withMessage('Cliente inválido'),
    body('caja').optional().custom(entero(1, 20)).withMessage('Caja inválida'),
    body('esperaId').optional().isMongoId(),
    body('vendedor').optional().isMongoId().withMessage('Vendedor inválido'),
    ...reglasPartidas,
    body('pagos').isArray({ min: 1, max: 5 }).withMessage('Indica de 1 a 5 pagos'),
    body('pagos.*.metodo').isIn(METODOS_PAGO).withMessage(`Método de pago inválido (${METODOS_PAGO.join(', ')})`),
    body('pagos.*.monto').custom(entero(1)).withMessage('Monto: centavos enteros > 0'),
    body('pagos.*.referencia').optional().isString().trim().isLength({ max: 40 }),
    ...reglasAutorizacion,
    body('autorizacionCredito').optional().isObject(),
    body('autorizacionCredito.usuario').if(body('autorizacionCredito').exists()).isString().trim().notEmpty().withMessage('Falta el usuario que autoriza el crédito'),
    body('autorizacionCredito.pin').if(body('autorizacionCredito').exists()).isString().notEmpty().withMessage('Falta el PIN')
  ]),
  async (req, res) => {
    const { venta, repetida } = await ventas.cobrar(req.alcance, req.user, req.datos, vision(req));
    res.status(repetida ? 200 : 201).json({ ok: true, repetida, datos: venta });
  }
);

// GET /api/ventas — el cajero ve sus ventas de hoy; el dueño, todas en el rango
router.get(
  '/',
  puedeConsultar,
  validar([
    query('desde').optional().matches(RE_YMD),
    query('hasta').optional().matches(RE_YMD),
    query('estado').optional().isIn(['cobrada', 'cancelada']),
    query('folio').optional().isInt({ min: 1 }).toInt(),
    query('pagina').optional().isInt({ min: 1 }).toInt(),
    query('limite').optional().isInt({ min: 1, max: 200 }).toInt()
  ]),
  async (req, res) => {
    res.json({ ok: true, ...(await ventas.listar(req.alcance, req.user, req.datos, vision(req))) });
  }
);

// ---- En espera (antes de /:id para que "espera" no se tome como id) ----
router.get('/espera', cobrar, async (req, res) => {
  res.json({ ok: true, datos: await ventas.listarEspera(req.alcance) });
});

router.post(
  '/espera',
  cobrar,
  validar([body('cliente').optional().isMongoId(), body('nota').optional().isString().trim().isLength({ max: 120 }), ...reglasPartidas]),
  async (req, res) => {
    res.status(201).json({ ok: true, datos: await ventas.guardarEspera(req.alcance, req.user, req.datos) });
  }
);

router.delete('/espera/:id', cobrar, validar([id]), async (req, res) => {
  await ventas.eliminarEspera(req.alcance, req.datos.id);
  res.json({ ok: true });
});

router.get('/:id', puedeConsultar, validar([id]), async (req, res) => {
  res.json({ ok: true, datos: await ventas.obtener(req.alcance, req.user, req.datos.id, vision(req)) });
});

// GET /api/ventas/:id/ticket?ancho=58|80 → HTML para imprimir
router.get('/:id/ticket', puedeConsultar, validar([id, query('ancho').optional().isIn(['58', '80']).toInt()]), async (req, res) => {
  const venta = await ventas.obtener(req.alcance, req.user, req.datos.id, { ...vision(req), verCostos: false });
  const sucursal = await Sucursal.findById(venta.sucursal).lean();
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  // Dirección pública de la autofactura (FRONTEND_URL o el primer origen permitido)
  const frontend = process.env.FRONTEND_URL || (process.env.CORS_ORIGINS || '').split(',')[0].trim();
  res.type('html').send(htmlTicket(venta, { sucursal: sucursal?.nombre || '', ancho: req.datos.ancho || 80, urlAutofactura: frontend ? `${frontend.replace(/\/$/, '')}/autofactura` : null }));
});

// POST /api/ventas/:id/forma-pago { pagos, motivo, autorizacion } — PIN del dueño; turno de la venta abierto
router.post(
  '/:id/forma-pago',
  cobrar,
  validar([
    id,
    body('pagos').isArray({ min: 1, max: 5 }).withMessage('Indica de 1 a 5 pagos'),
    body('pagos.*.metodo').isIn(METODOS_PAGO).withMessage(`Método de pago inválido (${METODOS_PAGO.join(', ')})`),
    body('pagos.*.monto').custom(entero(1)).withMessage('Monto: centavos enteros > 0'),
    body('pagos.*.referencia').optional().isString().trim().isLength({ max: 40 }),
    body('motivo').isString().trim().isLength({ min: 3, max: 300 }).withMessage('Indica el motivo de la corrección'),
    body('autorizacion').isObject().withMessage('Falta la autorización del dueño'),
    ...reglasAutorizacion
  ]),
  async (req, res) => {
    res.json({ ok: true, datos: await ventas.cambiarFormaPago(req.alcance, req.user, req.datos.id, req.datos) });
  }
);

// POST /api/ventas/:id/cancelar { motivo, autorizacion: { usuario, pin } } — PIN del dueño
router.post(
  '/:id/cancelar',
  cobrar,
  validar([
    id,
    body('motivo').isString().trim().isLength({ min: 3, max: 300 }).withMessage('Indica el motivo de la cancelación'),
    body('autorizacion').isObject().withMessage('Falta la autorización del dueño'),
    ...reglasAutorizacion
  ]),
  async (req, res) => {
    res.json({ ok: true, datos: await ventas.cancelar(req.alcance, req.user, req.datos.id, req.datos) });
  }
);

module.exports = router;

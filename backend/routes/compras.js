// Recepción de mercancía (ruta operativa: autenticar + scopeSucursal). Permiso recepcion:registrar.
// No hay DELETE: un borrador se cancela; una compra recibida ya no cambia.
const express = require('express');
const { body, param, query } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const compras = require('../services/compras');
const { ESTADOS } = require('../models/Compra');
const { CATEGORIAS } = require('../models/Producto');
const sugeridos = require('../services/sugeridos');

const router = express.Router();
router.use(requirePermiso('recepcion:registrar'));

const id = param('id').isMongoId().withMessage('Id de compra inválido');
const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;
const entero = (min, max) => v => Number.isSafeInteger(v) && v >= min && (max === undefined || v <= max);

const reglasCompra = [
  body('proveedor').isMongoId().withMessage('Proveedor inválido'),
  body('folioFactura').isString().trim().isLength({ min: 1, max: 40 }).withMessage('Folio de factura obligatorio (máx. 40)'),
  body('fechaFactura').matches(RE_YMD).withMessage('Fecha de factura: AAAA-MM-DD'),
  body('condicionPago').isIn(['contado', 'credito']).withMessage('Condición de pago: contado o credito'),
  body('diasCredito').optional().custom(entero(0, 365)).withMessage('Días de crédito: entero de 0 a 365'),
  body('observaciones').optional().isString().trim().isLength({ max: 500 }),
  body('pedido').optional({ values: 'falsy' }).isMongoId().withMessage('Pedido inválido'),
  body('partidas').isArray({ min: 1, max: 200 }).withMessage('La compra debe tener entre 1 y 200 partidas'),
  body('partidas.*.producto').isMongoId().withMessage('Producto inválido en una partida'),
  body('partidas.*.cantidad').custom(entero(1)).withMessage('Cantidad: entero > 0 (piezas o gramos)'),
  body('partidas.*.costoUnitario').custom(entero(0)).withMessage('Costo unitario: centavos enteros (≥ 0), sin IVA'),
  body('partidas.*.lote').optional().isString().trim().isLength({ max: 40 }),
  body('partidas.*.caducidad').optional({ values: 'falsy' }).isString().trim(),
  body('partidas.*.temperaturaLlegada').optional({ values: 'null' })
    .custom(v => typeof v === 'number' && Number.isFinite(v) && v >= -40 && v <= 60).withMessage('Temperatura: número entre -40 y 60 °C')
];

router.get(
  '/',
  validar([
    query('estado').optional().isIn(ESTADOS).withMessage('Estado inválido'),
    query('proveedor').optional().isMongoId(),
    query('desde').optional().matches(RE_YMD),
    query('hasta').optional().matches(RE_YMD),
    query('pagina').optional().isInt({ min: 1 }).toInt(),
    query('limite').optional().isInt({ min: 1, max: 100 }).toInt()
  ]),
  async (req, res) => {
    res.json({ ok: true, ...(await compras.listar(req.alcance, req.datos)) });
  }
);

// GET /api/compras/sugeridas?dias=30&cobertura=15&categoria=…&todos=true — compras sugeridas de la sucursal
router.get(
  '/sugeridas',
  validar([
    query('dias').optional().isIn(sugeridos.PERIODOS.map(String)).toInt(),
    query('cobertura').optional().isInt({ min: 1, max: 120 }).toInt(),
    query('categoria').optional().isIn(CATEGORIAS),
    query('todos').optional().isBoolean().toBoolean()
  ]),
  async (req, res) => {
    res.json({ ok: true, ...(await sugeridos.calcular(req.alcance, req.datos)) });
  }
);

router.get('/:id', validar([id]), async (req, res) => {
  res.json({ ok: true, datos: await compras.obtener(req.alcance, req.datos.id) });
});

// Crear borrador
router.post('/', validar(reglasCompra), async (req, res) => {
  res.status(201).json({ ok: true, datos: await compras.crear(req.alcance, req.user, req.datos) });
});

// Reemplazar el borrador completo
router.put('/:id', validar([id, ...reglasCompra]), async (req, res) => {
  const { id: compraId, ...datos } = req.datos;
  res.json({ ok: true, datos: await compras.actualizar(req.alcance, req.user, compraId, datos) });
});

// Confirmar recepción: crea las capas de inventario
router.post('/:id/confirmar', validar([id]), async (req, res) => {
  res.json({ ok: true, datos: await compras.confirmar(req.alcance, req.user, req.datos.id) });
});

router.post('/:id/cancelar', validar([id, body('motivo').optional().isString().trim().isLength({ max: 300 })]), async (req, res) => {
  res.json({ ok: true, datos: await compras.cancelar(req.alcance, req.user, req.datos.id, req.datos.motivo) });
});

module.exports = router;

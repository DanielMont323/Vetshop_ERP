// Configuración general: la leen todos los usuarios con sesión (la caja necesita los conceptos de gasto);
// solo el dueño la cambia (configuracion:gestionar).
const express = require('express');
const { body } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const configuracion = require('../services/configuracion');

const router = express.Router();

router.get('/', async (req, res) => {
  res.json({ ok: true, datos: await configuracion.obtener() });
});

router.put(
  '/',
  requirePermiso('configuracion:gestionar'),
  validar([
    body('caja').optional().isObject(),
    body('caja.conceptosGasto').optional().isArray({ min: 1, max: 20 }).withMessage('De 1 a 20 conceptos de gasto'),
    body('caja.conceptosGasto.*').isString().trim().isLength({ min: 1, max: 40 }).withMessage('Concepto: de 1 a 40 caracteres'),
    body('lealtad').optional().isObject(),
    body('lealtad.activa').optional().isBoolean(),
    body('lealtad.valorPunto').optional().custom(v => Number.isSafeInteger(v) && v >= 1 && v <= 10000).withMessage('Valor del punto: centavos de 1 a 10000'),
    body('lealtad.escalones').optional().isArray({ min: 1, max: 6 }),
    body('lealtad.escalones.*.hasta').custom(v => v === null || (Number.isSafeInteger(v) && v > 0)).withMessage('Escalón: tope en centavos o null'),
    body('lealtad.escalones.*.porcentaje').custom(v => Number.isSafeInteger(v) && v >= 0 && v <= 10000).withMessage('Escalón: puntos base de 0 a 10000'),
    body('lealtad.premiosCostal').optional().isArray({ min: 1, max: 10 }),
    body('lealtad.premiosCostal.*.numero').custom(v => Number.isSafeInteger(v) && v >= 1 && v <= 100).withMessage('Premio: número de costal de 1 a 100'),
    body('lealtad.premiosCostal.*.porcentaje').custom(v => Number.isSafeInteger(v) && v >= 0 && v <= 10000).withMessage('Premio: puntos base de 0 a 10000'),
    body('descuentos').optional().isObject(),
    body('descuentos.motivos').optional().isArray({ min: 1, max: 20 }).withMessage('De 1 a 20 motivos de descuento'),
    body('descuentos.motivos.*.nombre').isString().trim().isLength({ min: 1, max: 40 }).withMessage('Motivo: de 1 a 40 caracteres'),
    body('descuentos.motivos.*.maximo').custom(v => Number.isSafeInteger(v) && v >= 1 && v <= 10000).withMessage('Máximo: puntos base de 1 a 10000'),
    body('descuentos.motivos.*.requierePin').optional().isBoolean(),
    body('caja.topeGastoSinPin').optional().custom(v => Number.isSafeInteger(v) && v >= 0 && v <= 10000000).withMessage('Tope: centavos enteros ≥ 0')
  ]),
  async (req, res) => {
    res.json({ ok: true, datos: await configuracion.actualizar(req.user, req.datos) });
  }
);

module.exports = router;

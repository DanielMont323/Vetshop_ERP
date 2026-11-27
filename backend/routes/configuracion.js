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
    body('caja.topeGastoSinPin').optional().custom(v => Number.isSafeInteger(v) && v >= 0 && v <= 10000000).withMessage('Tope: centavos enteros ≥ 0')
  ]),
  async (req, res) => {
    res.json({ ok: true, datos: await configuracion.actualizar(req.user, req.datos) });
  }
);

module.exports = router;

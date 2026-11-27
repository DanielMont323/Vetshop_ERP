// Promociones: las ve cualquiera con catálogo; las crea y edita el dueño (catalogo:gestionar).
const express = require('express');
const { body, param, query } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const promociones = require('../services/promociones');
const { TIPOS, ALCANCES } = require('../models/Promocion');
const { CATEGORIAS } = require('../models/Producto');

const router = express.Router();
const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;
const id = param('id').isMongoId().withMessage('Id de promoción inválido');
const valor = v => Number.isSafeInteger(v) && v >= 1 && v <= 100000000;

router.get(
  '/',
  requirePermiso('catalogo:ver'),
  validar([query('estado').optional().isIn(['vigentes', 'proximas', 'terminadas'])]),
  async (req, res) => {
    res.json({ ok: true, datos: await promociones.listar(req.datos) });
  }
);

const comunes = [
  body('nombre').optional().isString().trim().isLength({ min: 1, max: 80 }).withMessage('Nombre: de 1 a 80 caracteres'),
  body('valor').optional().custom(valor).withMessage('Valor: centavos (precio) o puntos base (porcentaje), entero > 0'),
  body('sucursales').optional().isArray({ max: 20 }),
  body('sucursales.*').isMongoId().withMessage('Sucursal inválida'),
  body('desde').optional().matches(RE_YMD).withMessage('desde: AAAA-MM-DD'),
  body('hasta').optional().matches(RE_YMD).withMessage('hasta: AAAA-MM-DD')
];

router.post(
  '/',
  requirePermiso('catalogo:gestionar'),
  validar([
    ...comunes,
    body('nombre').exists().withMessage('Falta el nombre'),
    body('valor').exists().withMessage('Falta el valor'),
    body('desde').exists().withMessage('Falta la fecha inicial'),
    body('hasta').exists().withMessage('Falta la fecha final'),
    body('tipo').isIn(TIPOS).withMessage('Tipo: precio o porcentaje'),
    body('alcance').isIn(ALCANCES).withMessage('Alcance: producto, categoria o lote'),
    body('producto').optional().isMongoId().withMessage('Producto inválido'),
    body('categoria').optional().isIn(CATEGORIAS).withMessage('Categoría inválida'),
    body('lote').optional().isString().trim().isLength({ min: 1, max: 40 }).withMessage('Lote: hasta 40 caracteres')
  ]),
  async (req, res) => {
    res.status(201).json({ ok: true, datos: await promociones.crear(req.datos, req.user) });
  }
);

router.patch(
  '/:id',
  requirePermiso('catalogo:gestionar'),
  validar([id, ...comunes, body('activa').optional().isBoolean()]),
  async (req, res) => {
    const { id: promoId, ...cambios } = req.datos;
    res.json({ ok: true, datos: await promociones.actualizar(promoId, cambios, req.user) });
  }
);

module.exports = router;

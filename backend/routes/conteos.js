// Conteo físico (ruta operativa: autenticar + scopeSucursal).
//   Iniciar, capturar, pasar a revisión y cancelar: conteo_fisico:capturar (almacén y dueño).
//   Ver diferencias y aplicar (con PIN del dueño): conteo_fisico:aplicar (dueño).
const express = require('express');
const { body, param, query } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const conteos = require('../services/conteos');
const { CATEGORIAS } = require('../models/Producto');

const router = express.Router();
const id = param('id').isMongoId().withMessage('Id de conteo inválido');
const capturar = requirePermiso('conteo_fisico:capturar');

router.get('/', capturar, validar([query('pagina').optional().isInt({ min: 1 }).toInt(), query('limite').optional().isInt({ min: 1, max: 100 }).toInt()]), async (req, res) => {
  res.json({ ok: true, ...(await conteos.listar(req.alcance, req.datos)) });
});

router.post(
  '/',
  capturar,
  validar([
    body('categorias').optional().isArray({ max: CATEGORIAS.length }),
    body('categorias.*').isIn(CATEGORIAS).withMessage(`Categoría inválida (${CATEGORIAS.join(', ')})`),
    body('nota').optional().isString().trim().isLength({ max: 300 })
  ]),
  async (req, res) => {
    res.status(201).json({ ok: true, datos: await conteos.iniciar(req.alcance, req.user, req.datos) });
  }
);

router.get('/:id', capturar, validar([id]), async (req, res) => {
  res.json({ ok: true, datos: await conteos.obtener(req.alcance, req.user, req.datos.id) });
});

router.post(
  '/:id/capturas',
  capturar,
  validar([
    id,
    body('renglon').isMongoId().withMessage('Renglón inválido'),
    body('cantidad').custom(v => Number.isSafeInteger(v) && v >= 0).withMessage('Cantidad: entero ≥ 0 (piezas o gramos)'),
    body('modo').optional().isIn(['sumar', 'reemplazar'])
  ]),
  async (req, res) => {
    res.json({ ok: true, datos: await conteos.capturar(req.alcance, req.user, req.datos.id, req.datos) });
  }
);

router.post('/:id/revision', capturar, validar([id]), async (req, res) => {
  res.json({ ok: true, datos: await conteos.aRevision(req.alcance, req.user, req.datos.id) });
});

router.post('/:id/recaptura', capturar, validar([id]), async (req, res) => {
  res.json({ ok: true, datos: await conteos.aCaptura(req.alcance, req.user, req.datos.id) });
});

router.post(
  '/:id/aplicar',
  requirePermiso('conteo_fisico:aplicar'),
  validar([
    id,
    body('noContadosEnCero').optional().isBoolean({ strict: true }),
    body('autorizacion').isObject().withMessage('Falta la autorización del dueño'),
    body('autorizacion.usuario').isString().trim().notEmpty().withMessage('Falta el usuario que autoriza'),
    body('autorizacion.pin').isString().notEmpty().withMessage('Falta el PIN')
  ]),
  async (req, res) => {
    res.json({ ok: true, datos: await conteos.aplicar(req.alcance, req.user, req.datos.id, req.datos) });
  }
);

router.post(
  '/:id/cancelar',
  capturar,
  validar([id, body('motivo').isString().trim().isLength({ min: 3, max: 300 }).withMessage('Indica el motivo de la cancelación')]),
  async (req, res) => {
    res.json({ ok: true, datos: await conteos.cancelar(req.alcance, req.user, req.datos.id, req.datos) });
  }
);

module.exports = router;

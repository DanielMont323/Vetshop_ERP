// Traspasos (ruta operativa: autenticar + scopeSucursal). Permiso traspasos:gestionar (almacén y dueño).
// Enviar y cancelar: desde el origen (X-Sucursal = origen). Recibir: desde el destino.
const express = require('express');
const { body, param, query } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const traspasos = require('../services/traspasos');
const { ESTADOS } = require('../models/Traspaso');

const router = express.Router();
router.use(requirePermiso('traspasos:gestionar'));

const id = param('id').isMongoId().withMessage('Id de traspaso inválido');
const entero = min => v => Number.isSafeInteger(v) && v >= min;

router.get('/destinos', async (req, res) => {
  res.json({ ok: true, datos: await traspasos.destinos(req.alcance) });
});

router.get(
  '/',
  validar([
    query('estado').optional().isIn(ESTADOS),
    query('direccion').optional().isIn(['enviados', 'recibidos']),
    query('pagina').optional().isInt({ min: 1 }).toInt(),
    query('limite').optional().isInt({ min: 1, max: 100 }).toInt()
  ]),
  async (req, res) => {
    res.json({ ok: true, ...(await traspasos.listar(req.alcance, req.datos)) });
  }
);

router.get('/:id', validar([id]), async (req, res) => {
  res.json({ ok: true, datos: await traspasos.obtener(req.alcance, req.datos.id) });
});

// POST /api/traspasos { destino, partidas: [{ producto, cantidad }], observaciones? } — enviar
router.post(
  '/',
  validar([
    body('destino').isMongoId().withMessage('Indica la sucursal destino'),
    body('partidas').isArray({ min: 1, max: 200 }).withMessage('El traspaso debe tener entre 1 y 200 partidas'),
    body('partidas.*.producto').isMongoId().withMessage('Producto inválido'),
    body('partidas.*.cantidad').custom(entero(1)).withMessage('Cantidad: entero > 0 (piezas o gramos)'),
    body('observaciones').optional().isString().trim().isLength({ max: 500 })
  ]),
  async (req, res) => {
    res.status(201).json({ ok: true, datos: await traspasos.enviar(req.alcance, req.user, req.datos) });
  }
);

// POST /api/traspasos/:id/recibir { recibidos: [[cantidad por lote] por partida], observaciones? }
router.post(
  '/:id/recibir',
  validar([
    id,
    body('recibidos').isArray({ min: 1, max: 200 }).withMessage('Captura lo recibido'),
    body('recibidos.*').isArray({ min: 1 }).withMessage('Captura lo recibido de cada lote'),
    body('recibidos.*.*').custom(entero(0)).withMessage('Cantidad recibida: entero ≥ 0'),
    body('observaciones').optional().isString().trim().isLength({ max: 500 })
  ]),
  async (req, res) => {
    res.json({ ok: true, datos: await traspasos.recibir(req.alcance, req.user, req.datos.id, req.datos) });
  }
);

// POST /api/traspasos/:id/autorizar-diferencia { nota, autorizacion } — PIN del dueño
router.post(
  '/:id/autorizar-diferencia',
  validar([
    id,
    body('nota').isString().trim().isLength({ min: 3, max: 500 }).withMessage('Explica la diferencia'),
    body('autorizacion.usuario').isString().trim().notEmpty().withMessage('Falta el usuario del dueño'),
    body('autorizacion.pin').isString().notEmpty().withMessage('Falta el PIN')
  ]),
  async (req, res) => {
    res.json({ ok: true, datos: await traspasos.autorizarDiferencia(req.alcance, req.user, req.datos.id, req.datos) });
  }
);

router.post('/:id/cancelar', validar([id, body('motivo').isString().trim().isLength({ min: 3, max: 300 }).withMessage('Indica el motivo')]), async (req, res) => {
  res.json({ ok: true, datos: await traspasos.cancelar(req.alcance, req.user, req.datos.id, req.datos.motivo) });
});

module.exports = router;

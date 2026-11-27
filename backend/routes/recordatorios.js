// Recordatorios (ruta operativa: autenticar + scopeSucursal). Los ve y maneja la caja (clientes:registrar).
const express = require('express');
const { body, param, query } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const recordatorios = require('../services/recordatorios');
const { TIPOS } = require('../models/Recordatorio');

const router = express.Router();
router.use(requirePermiso('clientes:registrar'));

const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;
const id = param('id').isMongoId().withMessage('Id de recordatorio inválido');
const comunes = [
  body('descripcion').optional().isString().trim().isLength({ min: 1, max: 150 }).withMessage('Descripción: de 1 a 150 caracteres'),
  body('mascota').optional({ values: 'falsy' }).isMongoId().withMessage('Mascota inválida'),
  body('producto').optional({ values: 'falsy' }).isMongoId().withMessage('Producto inválido'),
  body('fecha').optional().matches(RE_YMD).withMessage('Fecha: AAAA-MM-DD'),
  body('diasAntes').optional().isInt({ min: 0, max: 30 }).toInt().withMessage('Días antes: 0 a 30'),
  body('repetirCadaDias').optional({ values: 'null' }).isInt({ min: 1, max: 730 }).toInt().withMessage('Repetir: cada 1 a 730 días')
];

router.get(
  '/',
  validar([query('vista').optional().isIn(['hoy', 'proximos', 'avisados', 'abiertos']), query('cliente').optional().isMongoId()]),
  async (req, res) => {
    res.json({ ok: true, datos: await recordatorios.listar(req.alcance, req.datos) });
  }
);

router.post(
  '/',
  validar([
    body('cliente').isMongoId().withMessage('Cliente inválido'),
    body('tipo').isIn(TIPOS).withMessage(`Tipo: ${TIPOS.join(', ')}`),
    body('descripcion').exists().withMessage('Describe el recordatorio'),
    body('fecha').exists().withMessage('Indica la fecha'),
    ...comunes
  ]),
  async (req, res) => {
    res.status(201).json({ ok: true, datos: await recordatorios.crear(req.alcance, req.user, req.datos) });
  }
);

router.patch('/:id', validar([id, ...comunes]), async (req, res) => {
  const { id: rid, ...cambios } = req.datos;
  res.json({ ok: true, datos: await recordatorios.actualizar(req.alcance, req.user, rid, cambios) });
});

router.post('/:id/avisado', validar([id]), async (req, res) => {
  res.json({ ok: true, datos: await recordatorios.marcarAvisado(req.alcance, req.user, req.datos.id) });
});

router.post('/:id/hecho', validar([id]), async (req, res) => {
  res.json({ ok: true, datos: await recordatorios.terminar(req.alcance, req.user, req.datos.id) });
});

router.post('/:id/cancelar', validar([id]), async (req, res) => {
  res.json({ ok: true, datos: await recordatorios.terminar(req.alcance, req.user, req.datos.id, { cancelar: true }) });
});

module.exports = router;

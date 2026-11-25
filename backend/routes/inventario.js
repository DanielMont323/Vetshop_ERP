// Movimientos y ajustes de inventario (ruta operativa: autenticar + scopeSucursal).
const express = require('express');
const { body, query } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const { tienePermiso } = require('../config/permisos');
const { sinPermiso } = require('../helpers/errores');
const existencias = require('../services/existencias');
const ajustes = require('../services/ajustes');

const router = express.Router();
const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/inventario/movimientos?producto=&desde=AAAA-MM-DD&hasta=AAAA-MM-DD&pagina=&limite=
router.get(
  '/movimientos',
  requirePermiso('existencias:ver'),
  validar([
    query('producto').optional().isMongoId().withMessage('Id de producto inválido'),
    query('desde').optional().matches(RE_YMD).withMessage('desde: AAAA-MM-DD'),
    query('hasta').optional().matches(RE_YMD).withMessage('hasta: AAAA-MM-DD'),
    query('pagina').optional().isInt({ min: 1 }).toInt(),
    query('limite').optional().isInt({ min: 1, max: 200 }).toInt()
  ]),
  async (req, res) => {
    const verCostos = tienePermiso(req.user.rol, 'inventario:entradas');
    res.json({ ok: true, ...(await existencias.movimientos(req.alcance, { ...req.datos, verCostos })) });
  }
);

// Entradas piden inventario:entradas; salidas, inventario:salidas
function permisoSegunTipo(req, res, next) {
  const permiso = req.body?.tipo === 'entrada' ? 'inventario:entradas' : 'inventario:salidas';
  if (!tienePermiso(req.user.rol, permiso)) return next(sinPermiso(`No tienes permiso para esta acción (${permiso})`));
  next();
}

// POST /api/inventario/ajustes — requiere usuario y PIN del dueño en `autorizacion`
router.post(
  '/ajustes',
  validar([
    body('tipo').isIn(['entrada', 'salida']).withMessage('tipo: entrada o salida'),
    body('producto').isMongoId().withMessage('Producto inválido'),
    body('cantidad').custom(v => Number.isSafeInteger(v) && v > 0).withMessage('La cantidad debe ser un entero > 0 (piezas o gramos)'),
    body('motivo').isString().notEmpty().withMessage('Indica el motivo'),
    body('nota').optional().isString().trim().isLength({ max: 300 }),
    body('lote').optional().isString().trim().isLength({ max: 40 }),
    body('caducidad').optional({ values: 'falsy' }).isString().trim(),
    body('costoUnitario').if(body('tipo').equals('entrada'))
      .custom(v => Number.isSafeInteger(v) && v >= 0).withMessage('El costo unitario debe estar en centavos enteros (≥ 0)'),
    body('capa').optional().isMongoId().withMessage('Lote inválido'),
    body('autorizacion.usuario').isString().trim().notEmpty().withMessage('Falta el usuario que autoriza'),
    body('autorizacion.pin').isString().notEmpty().withMessage('Falta el PIN de autorización')
  ]),
  permisoSegunTipo,
  async (req, res) => {
    res.status(201).json({ ok: true, datos: await ajustes.registrar(req.alcance, req.user, req.datos) });
  }
);

module.exports = router;

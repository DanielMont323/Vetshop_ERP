// Existencias (ruta operativa: autenticar + scopeSucursal). Permiso existencias:ver.
// El costo de los lotes solo lo ven quienes registran entradas (almacén y dueño).
const express = require('express');
const { param, query } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const { tienePermiso } = require('../config/permisos');
const { CATEGORIAS } = require('../models/Producto');
const existencias = require('../services/existencias');

const router = express.Router();
router.use(requirePermiso('existencias:ver'));

const ESTADOS = ['caducado', 'por_caducar', 'bajo_minimo', 'sin_existencia'];

// GET /api/existencias?q=&categoria=&estado=
router.get(
  '/',
  validar([
    query('q').optional().isString().trim().isLength({ max: 100 }),
    query('categoria').optional().isIn(CATEGORIAS).withMessage('Categoría inválida'),
    query('estado').optional().isIn(ESTADOS).withMessage(`Estado inválido (${ESTADOS.join(', ')})`)
  ]),
  async (req, res) => {
    res.json({ ok: true, datos: await existencias.listar(req.alcance, req.datos) });
  }
);

// GET /api/existencias/:productoId/lotes
router.get('/:productoId/lotes', validar([param('productoId').isMongoId().withMessage('Id de producto inválido')]), async (req, res) => {
  const verCostos = tienePermiso(req.user.rol, 'inventario:entradas');
  res.json({ ok: true, datos: await existencias.lotes(req.alcance, req.datos.productoId, { verCostos }) });
});

module.exports = router;

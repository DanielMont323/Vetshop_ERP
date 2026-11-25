// Sucursales: catálogo global. Todos ven las suyas; solo el dueño crea y modifica.
const express = require('express');
const { body, param, query } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const sucursales = require('../services/sucursales');

const router = express.Router();

const id = param('id').isMongoId().withMessage('Id de sucursal inválido');
const nombre = body('nombre').isString().trim().isLength({ min: 1, max: 80 }).withMessage('El nombre es obligatorio (máx. 80)');
const tipo = body('tipo').isIn(['tienda', 'almacen']).withMessage('Tipo inválido (tienda o almacen)');

router.get('/', validar([query('incluirInactivas').optional().isBoolean().toBoolean()]), async (req, res) => {
  res.json({ ok: true, datos: await sucursales.listar(req.user, req.datos) });
});

router.get('/:id', validar([id]), async (req, res) => {
  res.json({ ok: true, datos: await sucursales.obtener(req.user, req.datos.id) });
});

router.post('/', requirePermiso('sucursales:gestionar'), validar([nombre, tipo]), async (req, res) => {
  res.status(201).json({ ok: true, datos: await sucursales.crear(req.datos, req.user) });
});

router.patch(
  '/:id',
  requirePermiso('sucursales:gestionar'),
  validar([id, nombre.optional(), tipo.optional(), body('activa').optional().isBoolean({ strict: true }).withMessage('activa debe ser true o false')]),
  async (req, res) => {
    const { id: sucursalId, ...cambios } = req.datos;
    res.json({ ok: true, datos: await sucursales.actualizar(sucursalId, cambios, req.user) });
  }
);

module.exports = router;

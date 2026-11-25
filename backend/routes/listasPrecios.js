// Listas de precios. Consultar: catalogo:ver. Cambiar un precio: catalogo:gestionar (dueño).
const express = require('express');
const { body, param } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const precios = require('../services/precios');
const { esCentavos } = require('./validaciones');

const router = express.Router();
const clave = param('clave').isIn(precios.CLAVES_LISTA).withMessage(`Lista inválida (${precios.CLAVES_LISTA.join(', ')})`);
const producto = param('productoId').isMongoId().withMessage('Id de producto inválido');

// GET /api/listas-precios → las 4 listas con cuántos productos tienen precio
router.get('/', requirePermiso('catalogo:ver'), async (req, res) => {
  res.json({ ok: true, datos: await precios.listar() });
});

// PUT /api/listas-precios/:clave/precios/:productoId { precio } → fija el precio (centavos, con IVA)
router.put(
  '/:clave/precios/:productoId',
  requirePermiso('catalogo:gestionar'),
  validar([clave, producto, body('precio').custom(esCentavos).withMessage('El precio debe estar en centavos enteros (≥ 0)')]),
  async (req, res) => {
    const { clave: c, productoId, precio } = req.datos;
    res.json({ ok: true, datos: await precios.fijarPrecio({ clave: c, productoId, precio }, req.user) });
  }
);

// DELETE /api/listas-precios/:clave/precios/:productoId → quita el precio de esa lista
router.delete('/:clave/precios/:productoId', requirePermiso('catalogo:gestionar'), validar([clave, producto]), async (req, res) => {
  const { clave: c, productoId } = req.datos;
  res.json({ ok: true, datos: await precios.fijarPrecio({ clave: c, productoId, precio: null }, req.user) });
});

module.exports = router;

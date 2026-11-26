// Catálogo de productos. Consultar: catalogo:ver (los 4 roles). Crear/modificar: catalogo:gestionar (dueño).
// No hay DELETE: un producto se desactiva (activo: false) para conservar su historial.
const express = require('express');
const { body, param, query } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const productos = require('../services/productos');
const { CATEGORIAS, UNIDADES, TIPOS_IVA, RE_SKU, RE_CODIGO_BARRAS } = require('../models/Producto');
const { validarMapaPrecios } = require('./validaciones');

const router = express.Router();
const ver = requirePermiso('catalogo:ver');
const gestionar = requirePermiso('catalogo:gestionar');

const id = param('id').isMongoId().withMessage('Id de producto inválido');
const booleano = campo => body(campo).isBoolean({ strict: true }).withMessage(`${campo} debe ser true o false`);

// Reglas de los campos; `opcional` = true para PATCH
function reglasProducto(opcional) {
  const o = regla => (opcional ? regla.optional() : regla);
  return [
    o(body('sku').isString().trim().toUpperCase().matches(RE_SKU).withMessage('SKU inválido (letras, números, . _ -; máx. 30)')),
    // '' (texto vacío) quita el código de barras
    body('codigoBarras').optional().isString().withMessage('codigoBarras debe ser texto').bail().trim()
      .custom(v => v === '' || RE_CODIGO_BARRAS.test(v)).withMessage('Código de barras inválido (4 a 40 letras o números)'),
    o(body('nombre').isString().trim().isLength({ min: 1, max: 120 }).withMessage('El nombre es obligatorio (máx. 120)')),
    o(body('categoria').isIn(CATEGORIAS).withMessage(`Categoría inválida (${CATEGORIAS.join(', ')})`)),
    o(body('unidad').isIn(UNIDADES).withMessage('Unidad inválida (pieza o kg)')),
    o(body('iva').isIn(TIPOS_IVA).withMessage(`IVA inválido (${TIPOS_IVA.join(', ')})`)),
    body('presentacion').optional().isString().trim().isLength({ max: 80 }).withMessage('Presentación: máx. 80 caracteres'),
    booleano('requiereReceta').optional(),
    booleano('esControlado').optional(),
    booleano('requiereRefrigeracion').optional(),
    booleano('activo').optional(),
    body('minimos').optional().isArray({ max: 50 }).withMessage('minimos debe ser una lista'),
    body('minimos.*.sucursal').isMongoId().withMessage('Sucursal inválida en mínimos'),
    body('minimos.*.cantidad').custom(v => Number.isSafeInteger(v) && v >= 0)
      .withMessage('El mínimo debe ser un entero ≥ 0 (piezas o gramos)'),
    body('minimos.*.maximo').optional({ values: 'null' }).custom(v => Number.isSafeInteger(v) && v >= 0)
      .withMessage('El máximo debe ser un entero ≥ 0 (piezas o gramos)'),
    body('precios').optional().custom(validarMapaPrecios)
  ];
}

// GET /api/productos?q=&categoria=&activo=&pagina=&limite=
router.get(
  '/',
  ver,
  validar([
    query('q').optional().isString().trim().isLength({ max: 100 }),
    query('categoria').optional().isIn(CATEGORIAS).withMessage('Categoría inválida'),
    query('activo').optional().isBoolean().toBoolean(),
    query('pagina').optional().isInt({ min: 1 }).toInt(),
    query('limite').optional().isInt({ min: 1, max: productos.LIMITE_MAXIMO }).toInt()
  ]),
  async (req, res) => {
    res.json({ ok: true, ...(await productos.buscar(req.datos)) });
  }
);

// GET /api/productos/codigo/:codigo — para el lector de código de barras (coincidencia exacta)
router.get(
  '/codigo/:codigo',
  ver,
  validar([param('codigo').isString().trim().isLength({ min: 1, max: 40 })]),
  async (req, res) => {
    res.json({ ok: true, datos: await productos.porCodigo(req.datos.codigo) });
  }
);

router.get('/:id', ver, validar([id]), async (req, res) => {
  res.json({ ok: true, datos: await productos.obtener(req.datos.id) });
});

router.post('/', gestionar, validar(reglasProducto(false)), async (req, res) => {
  res.status(201).json({ ok: true, datos: await productos.crear(req.datos, req.user) });
});

router.patch('/:id', gestionar, validar([id, ...reglasProducto(true)]), async (req, res) => {
  const { id: productoId, ...cambios } = req.datos;
  res.json({ ok: true, datos: await productos.actualizar(productoId, cambios, req.user) });
});


module.exports = router;

// Proveedores (catálogo global). Los consulta y gestiona quien registra recepciones (almacén y dueño).
const express = require('express');
const { body, param, query } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const proveedores = require('../services/proveedores');
const { RE_RFC } = require('../models/Proveedor');

const router = express.Router();
router.use(requirePermiso('recepcion:registrar'));

const id = param('id').isMongoId().withMessage('Id de proveedor inválido');

function reglas(opcional) {
  const o = regla => (opcional ? regla.optional() : regla);
  return [
    o(body('nombre').isString().trim().isLength({ min: 1, max: 120 }).withMessage('El nombre es obligatorio (máx. 120)')),
    body('rfc').optional().isString().trim().toUpperCase().custom(v => v === '' || RE_RFC.test(v)).withMessage('RFC inválido'),
    body('contacto').optional().isString().trim().isLength({ max: 80 }),
    body('telefono').optional().isString().trim().isLength({ max: 20 }),
    body('email').optional({ values: 'falsy' }).isEmail().withMessage('Correo inválido').normalizeEmail({ gmail_remove_dots: false }),
    body('diasCredito').optional().custom(v => Number.isSafeInteger(v) && v >= 0 && v <= 365).withMessage('Días de crédito: entero de 0 a 365'),
    body('activo').optional().isBoolean({ strict: true }).withMessage('activo debe ser true o false')
  ];
}

router.get('/', validar([query('q').optional().isString().trim().isLength({ max: 100 }), query('activo').optional().isBoolean().toBoolean()]), async (req, res) => {
  res.json({ ok: true, datos: await proveedores.listar(req.datos) });
});

router.get('/:id', validar([id]), async (req, res) => {
  res.json({ ok: true, datos: await proveedores.obtener(req.datos.id) });
});

router.post('/', validar(reglas(false)), async (req, res) => {
  res.status(201).json({ ok: true, datos: await proveedores.crear(req.datos, req.user) });
});

router.patch('/:id', validar([id, ...reglas(true)]), async (req, res) => {
  const { id: proveedorId, ...cambios } = req.datos;
  res.json({ ok: true, datos: await proveedores.actualizar(proveedorId, cambios, req.user) });
});

module.exports = router;

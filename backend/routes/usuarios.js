// Gestión de usuarios: solo el dueño (permiso usuarios:gestionar). Se monta con autenticar.
const express = require('express');
const { body, param, query } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const usuarios = require('../services/usuarios');
const { ROLES } = require('../config/permisos');
const { MIN_LONGITUD_PASSWORD } = require('../models/Usuario');

const router = express.Router();
router.use(requirePermiso('usuarios:gestionar'));

const id = param('id').isMongoId().withMessage('Id de usuario inválido');
const nombre = body('nombre').isString().trim().isLength({ min: 1, max: 80 }).withMessage('El nombre es obligatorio (máx. 80)');
const rol = body('rol').isIn(ROLES).withMessage(`Rol inválido (${ROLES.join(', ')})`);
const sucursales = body('sucursales').isArray({ max: 20 }).withMessage('sucursales debe ser una lista');
const sucursalId = body('sucursales.*').isMongoId().withMessage('Id de sucursal inválido');
const password = campo => body(campo).isString().isLength({ min: MIN_LONGITUD_PASSWORD, max: 128 })
  .withMessage(`La contraseña debe tener entre ${MIN_LONGITUD_PASSWORD} y 128 caracteres`);

router.get('/', validar([query('incluirInactivos').optional().isBoolean().toBoolean()]), async (req, res) => {
  res.json({ ok: true, datos: await usuarios.listar(req.datos) });
});

router.post(
  '/',
  validar([
    nombre,
    body('usuario').isString().trim().toLowerCase().matches(/^[a-z0-9._-]{3,30}$/)
      .withMessage('El usuario solo admite letras, números, punto, guion y guion bajo (3 a 30)'),
    password('password'),
    rol,
    sucursales.optional(),
    sucursalId,
    body('pin').optional().isString().matches(/^\d{4,6}$/).withMessage('El PIN debe tener de 4 a 6 dígitos')
  ]),
  async (req, res) => {
    res.status(201).json({ ok: true, datos: await usuarios.crear(req.datos, req.user) });
  }
);

router.patch(
  '/:id',
  validar([id, nombre.optional(), rol.optional(), sucursales.optional(), sucursalId, body('activo').optional().isBoolean({ strict: true }).withMessage('activo debe ser true o false')]),
  async (req, res) => {
    const { id: usuarioId, ...cambios } = req.datos;
    res.json({ ok: true, datos: await usuarios.actualizar(usuarioId, cambios, req.user) });
  }
);

router.put('/:id/password', validar([id, password('nueva')]), async (req, res) => {
  await usuarios.restablecerPassword(req.datos.id, req.datos.nueva, req.user);
  res.json({ ok: true, mensaje: 'Contraseña restablecida' });
});

module.exports = router;

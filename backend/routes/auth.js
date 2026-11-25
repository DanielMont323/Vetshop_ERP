const express = require('express');
const { body } = require('express-validator');
const { validar } = require('../middleware/validar');
const { autenticar } = require('../middleware/auth');
const auth = require('../services/auth');
const { MIN_LONGITUD_PASSWORD } = require('../models/Usuario');

const router = express.Router();

const textoObligatorio = (campo, mensaje) => body(campo).isString().withMessage(mensaje).bail().trim().notEmpty().withMessage(mensaje);
const passwordNueva = campo =>
  body(campo).isString().isLength({ min: MIN_LONGITUD_PASSWORD, max: 128 })
    .withMessage(`La contraseña debe tener entre ${MIN_LONGITUD_PASSWORD} y 128 caracteres`);

// POST /api/auth/login { usuario, password }
router.post(
  '/login',
  validar([
    textoObligatorio('usuario', 'Escribe tu usuario').isLength({ max: 30 }),
    body('password').isString().withMessage('Escribe tu contraseña').bail().notEmpty().withMessage('Escribe tu contraseña').isLength({ max: 128 })
  ]),
  async (req, res) => {
    const resultado = await auth.login(req.datos);
    res.json({ ok: true, datos: resultado });
  }
);

// GET /api/auth/me → perfil, sucursales disponibles y permisos
router.get('/me', autenticar, async (req, res) => {
  res.json({ ok: true, datos: await auth.perfil(req.user._id) });
});

// PUT /api/auth/password { actual, nueva } → token nuevo; las demás sesiones quedan cerradas
router.put(
  '/password',
  autenticar,
  validar([body('actual').isString().notEmpty().withMessage('Escribe tu contraseña actual'), passwordNueva('nueva')]),
  async (req, res) => {
    const resultado = await auth.cambiarPassword(req.user._id, req.datos);
    res.json({ ok: true, mensaje: 'Contraseña actualizada', datos: resultado });
  }
);

// PUT /api/auth/pin { password, pin } (solo dueño y médico responsable)
router.put(
  '/pin',
  autenticar,
  validar([
    body('password').isString().notEmpty().withMessage('Confirma con tu contraseña'),
    body('pin').isString().matches(/^\d{4,6}$/).withMessage('El PIN debe tener de 4 a 6 dígitos')
  ]),
  async (req, res) => {
    await auth.establecerPinPropio(req.user._id, req.datos);
    res.json({ ok: true, mensaje: 'PIN actualizado' });
  }
);

module.exports = router;

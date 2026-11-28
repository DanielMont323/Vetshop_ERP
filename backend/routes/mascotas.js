// Mascotas de los clientes: las consulta quien ve el catálogo; las registra la caja o el dueño (clientes:registrar).
const express = require('express');
const { body, param, query } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const mascotas = require('../services/mascotas');
const { ESPECIES } = require('../models/Mascota');

const router = express.Router();
const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;

const reglas = parcial => {
  const o = regla => (parcial ? regla.optional() : regla);
  return [
    o(body('nombre').isString().trim().isLength({ min: 1, max: 60 }).withMessage('Nombre: de 1 a 60 caracteres')),
    o(body('especie').isIn(ESPECIES).withMessage(`Especie: ${ESPECIES.join(', ')}`)),
    body('raza').optional().isString().trim().isLength({ max: 60 }),
    body('sexo').optional().isIn(['macho', 'hembra', '']),
    body('nacimiento').optional().custom(v => v === '' || RE_YMD.test(v)).withMessage('Nacimiento: AAAA-MM-DD'),
    body('peso').optional({ values: 'null' }).custom(v => Number.isSafeInteger(v) && v >= 0 && v <= 200000).withMessage('Peso: gramos enteros'),
    body('notas').optional().isString().trim().isLength({ max: 300 }),
    body('activa').optional().isBoolean()
  ];
};

router.get(
  '/',
  requirePermiso('catalogo:ver'),
  validar([query('cliente').isMongoId().withMessage('Indica el cliente'), query('todas').optional().isBoolean().toBoolean()]),
  async (req, res) => {
    res.json({ ok: true, datos: await mascotas.listar(req.datos) });
  }
);

router.post(
  '/',
  requirePermiso('clientes:registrar'),
  validar([body('cliente').isMongoId().withMessage('Cliente inválido'), ...reglas(false)]),
  async (req, res) => {
    res.status(201).json({ ok: true, datos: await mascotas.crear(req.datos, req.user) });
  }
);

router.patch(
  '/:id',
  requirePermiso('clientes:registrar'),
  validar([param('id').isMongoId(), ...reglas(true)]),
  async (req, res) => {
    const { id, ...cambios } = req.datos;
    res.json({ ok: true, datos: await mascotas.actualizar(id, cambios, req.user) });
  }
);

module.exports = router;

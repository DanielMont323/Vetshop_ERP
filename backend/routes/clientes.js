// Clientes (catálogo global). Consultar: catalogo:ver (la caja necesita elegirlos).
// Crear/modificar, incluida la lista de precios: clientes:gestionar (dueño).
const express = require('express');
const { body, param, query } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const clientes = require('../services/clientes');
const { TIPOS } = require('../models/Cliente');
const { CLAVES_LISTA } = require('../models/ListaPrecios');
const { RE_RFC } = require('../models/Proveedor');
const { REGIMENES, USOS_CFDI, RE_CP } = require('../config/sat');

const router = express.Router();
const id = param('id').isMongoId().withMessage('Id de cliente inválido');
const entero = (min, max) => v => Number.isSafeInteger(v) && v >= min && v <= max;
const reglasContacto = [
  body('whatsapp').optional().isString().trim().custom(v => v === '' || /^\d{10}$/.test(v)).withMessage('WhatsApp: 10 dígitos'),
  body('direccion').optional().isString().trim().isLength({ max: 300 }),
  body('notas').optional().isString().trim().isLength({ max: 500 })
];

function reglas(opcional) {
  const o = regla => (opcional ? regla.optional() : regla);
  return [
    o(body('nombre').isString().trim().isLength({ min: 1, max: 120 }).withMessage('El nombre es obligatorio (máx. 120)')),
    o(body('tipo').isIn(TIPOS).withMessage(`Tipo inválido (${TIPOS.join(', ')})`)),
    o(body('listaPrecios').isIn(CLAVES_LISTA).withMessage(`Lista inválida (${CLAVES_LISTA.join(', ')})`)),
    body('rfc').optional().isString().trim().toUpperCase().custom(v => v === '' || RE_RFC.test(v)).withMessage('RFC inválido'),
    body('telefono').optional().isString().trim().isLength({ max: 20 }),
    ...reglasContacto,
    body('email').optional({ values: 'falsy' }).isEmail().withMessage('Correo inválido').normalizeEmail({ gmail_remove_dots: false }),
    body('activo').optional().isBoolean({ strict: true }).withMessage('activo debe ser true o false'),
    body('credito').optional().isObject(),
    body('credito.activo').optional().isBoolean({ strict: true }).withMessage('credito.activo debe ser true o false'),
    body('credito.limite').optional().custom(entero(0, 100000000)).withMessage('Límite de crédito: centavos enteros ≥ 0'),
    body('credito.dias').optional().custom(entero(1, 180)).withMessage('Plazo: de 1 a 180 días'),
    body('credito.bonificacionProntoPago').optional().custom(entero(0, 2000)).withMessage('Bonificación: puntos base de 0 a 2000 (20 %)'),
    body('credito.diasProntoPago').optional().custom(entero(0, 60)).withMessage('Días de pronto pago: de 0 a 60'),
    body('fiscal').optional().isObject(),
    body('fiscal.razonSocial').optional().isString().trim().isLength({ max: 254 }),
    body('fiscal.regimen').optional().custom(v => v === '' || Object.hasOwn(REGIMENES, v)).withMessage('Régimen fiscal inválido'),
    body('fiscal.codigoPostal').optional().custom(v => v === '' || RE_CP.test(v)).withMessage('Código postal: 5 dígitos'),
    body('fiscal.usoCfdi').optional().isIn(Object.keys(USOS_CFDI)).withMessage('Uso de CFDI inválido')
  ];
}

router.get('/', requirePermiso('catalogo:ver'), validar([query('q').optional().isString().trim().isLength({ max: 100 }), query('activo').optional().isBoolean().toBoolean()]), async (req, res) => {
  res.json({ ok: true, datos: await clientes.listar(req.datos) });
});

// Alta rápida desde la caja (clientes:registrar): nombre y contacto; queda como público con lista de público
router.post(
  '/rapido',
  requirePermiso('clientes:registrar'),
  validar([
    body('nombre').isString().trim().isLength({ min: 1, max: 120 }).withMessage('El nombre es obligatorio (máx. 120)'),
    body('telefono').optional().isString().trim().isLength({ max: 20 }),
    body('email').optional({ values: 'falsy' }).isEmail().withMessage('Correo inválido').normalizeEmail({ gmail_remove_dots: false }),
    ...reglasContacto
  ]),
  async (req, res) => {
    res.status(201).json({ ok: true, datos: await clientes.registrarRapido(req.datos, req.user) });
  }
);

// Datos de contacto (clientes:registrar)
router.patch(
  '/:id/contacto',
  requirePermiso('clientes:registrar'),
  validar([
    id,
    body('telefono').optional().isString().trim().isLength({ max: 20 }),
    body('email').optional().isString().trim().custom(v => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)).withMessage('Correo inválido'),
    ...reglasContacto
  ]),
  async (req, res) => {
    const { id: clienteId, ...cambios } = req.datos;
    res.json({ ok: true, datos: await clientes.actualizarContacto(clienteId, cambios, req.user) });
  }
);

router.get('/:id', requirePermiso('catalogo:ver'), validar([id]), async (req, res) => {
  res.json({ ok: true, datos: await clientes.obtener(req.datos.id) });
});

router.post('/', requirePermiso('clientes:gestionar'), validar(reglas(false)), async (req, res) => {
  res.status(201).json({ ok: true, datos: await clientes.crear(req.datos, req.user) });
});

router.patch('/:id', requirePermiso('clientes:gestionar'), validar([id, ...reglas(true)]), async (req, res) => {
  const { id: clienteId, ...cambios } = req.datos;
  res.json({ ok: true, datos: await clientes.actualizar(clienteId, cambios, req.user) });
});

module.exports = router;

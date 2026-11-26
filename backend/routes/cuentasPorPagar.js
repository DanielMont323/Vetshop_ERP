// Cuentas por pagar a proveedores (global, solo dueño: cuentas_pagar:gestionar).
const express = require('express');
const { body, param, query } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const cuentas = require('../services/cuentasPorPagar');
const { METODOS_PAGO_PROVEEDOR } = require('../models/PagoProveedor');
const { libroCuentasPorPagar } = require('../helpers/excelReportes');
const { diaLocal } = require('../helpers/fechas');

const router = express.Router();
const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;
router.use(requirePermiso('cuentas_pagar:gestionar'));

const filtros = [
  query('proveedor').optional().isMongoId().withMessage('Proveedor inválido'),
  query('desde').optional().matches(RE_YMD).withMessage('desde: AAAA-MM-DD'),
  query('hasta').optional().matches(RE_YMD).withMessage('hasta: AAAA-MM-DD')
];

router.get(
  '/',
  validar([...filtros, query('estado').optional().isIn(['pendiente', 'pagada', 'todas']), query('q').optional().isString().trim().isLength({ max: 100 })]),
  async (req, res) => {
    res.json({ ok: true, ...(await cuentas.listar(req.datos)) });
  }
);

router.get('/excel', async (req, res) => {
  const buffer = await libroCuentasPorPagar(await cuentas.listar({ estado: 'pendiente' }));
  res.set('Content-Disposition', `attachment; filename="cuentas-por-pagar-${diaLocal()}.xlsx"`);
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buffer));
});

router.get('/pagos', validar(filtros), async (req, res) => {
  res.json({ ok: true, datos: await cuentas.listarPagos(req.datos) });
});

router.post(
  '/pagos',
  validar([
    body('claveOperacion').isString().trim().isLength({ min: 8, max: 64 }).withMessage('Falta la clave de operación (evita registrar dos veces)'),
    body('proveedor').isMongoId().withMessage('Proveedor inválido'),
    body('monto').custom(v => Number.isSafeInteger(v) && v > 0).withMessage('Monto: centavos enteros > 0'),
    body('metodo').isIn(METODOS_PAGO_PROVEEDOR).withMessage(`Forma de pago inválida (${METODOS_PAGO_PROVEEDOR.join(', ')})`),
    body('referencia').optional().isString().trim().isLength({ max: 60 }),
    body('nota').optional().isString().trim().isLength({ max: 300 }),
    body('fecha').optional().matches(RE_YMD).withMessage('Fecha del pago: AAAA-MM-DD'),
    body('cuentas').optional().isArray({ max: 200 }),
    body('cuentas.*').isMongoId().withMessage('Factura inválida')
  ]),
  async (req, res) => {
    const { pago, repetido } = await cuentas.registrarPago(req.user, req.datos);
    res.status(repetido ? 200 : 201).json({ ok: true, repetido, datos: pago });
  }
);

router.post(
  '/pagos/:id/cancelar',
  validar([param('id').isMongoId(), body('motivo').isString().trim().isLength({ min: 3, max: 300 }).withMessage('Indica el motivo de la cancelación')]),
  async (req, res) => {
    res.json({ ok: true, datos: await cuentas.cancelarPago(req.user, req.datos.id, req.datos) });
  }
);

module.exports = router;

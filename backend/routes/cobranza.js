// Crédito y cobranza (ruta operativa: autenticar + scopeSucursal).
//   - Cartera por antigüedad: cobranza:ver (dueño).
//   - Estado de cuenta de un cliente, abonos y su comprobante: cobranza:ver o cobranza:registrar_abono (cajero).
//   - Cancelar un abono: PIN del dueño.
const express = require('express');
const { body, param, query } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const { tienePermiso } = require('../config/permisos');
const { sinPermiso } = require('../helpers/errores');
const credito = require('../services/credito');
const { METODOS_ABONO } = require('../models/AbonoCliente');
const Sucursal = require('../models/Sucursal');
const { htmlAbono } = require('../helpers/ticket');
const { htmlEstadoCuenta } = require('../helpers/estadoCuenta');
const { libroCartera } = require('../helpers/excelReportes');
const { diaLocal } = require('../helpers/fechas');

const router = express.Router();
const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;
const entero = min => v => Number.isSafeInteger(v) && v >= min;

// Ver cuentas: quien cobra abonos (cajero) o quien lleva la cobranza (dueño)
function puedeVerCuentas(req, res, next) {
  if (['cobranza:ver', 'cobranza:registrar_abono'].some(p => tienePermiso(req.user.rol, p))) return next();
  return next(sinPermiso('No tienes permiso para ver cuentas de clientes'));
}
const CSP_IMPRESION = "default-src 'none'; style-src 'unsafe-inline'";

router.get('/cartera', requirePermiso('cobranza:ver'), validar([query('q').optional().isString().trim().isLength({ max: 100 })]), async (req, res) => {
  res.json({ ok: true, ...(await credito.cartera(req.datos)) });
});

router.get('/cartera/excel', requirePermiso('cobranza:ver'), async (req, res) => {
  const buffer = await libroCartera(await credito.cartera({}));
  res.set('Content-Disposition', `attachment; filename="cartera-${diaLocal()}.xlsx"`);
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buffer));
});

const reglasPeriodo = [
  param('id').isMongoId().withMessage('Id de cliente inválido'),
  query('desde').optional().matches(RE_YMD).withMessage('desde: AAAA-MM-DD'),
  query('hasta').optional().matches(RE_YMD).withMessage('hasta: AAAA-MM-DD')
];

router.get('/clientes/:id', puedeVerCuentas, validar(reglasPeriodo), async (req, res) => {
  res.json({ ok: true, datos: await credito.estadoCuenta(req.datos.id, req.datos) });
});

router.get('/clientes/:id/impresion', puedeVerCuentas, validar(reglasPeriodo), async (req, res) => {
  const ec = await credito.estadoCuenta(req.datos.id, req.datos);
  res.set('Content-Security-Policy', CSP_IMPRESION);
  res.type('html').send(htmlEstadoCuenta(ec, req.datos));
});

router.post(
  '/abonos',
  requirePermiso('cobranza:registrar_abono'),
  validar([
    body('claveOperacion').isString().trim().isLength({ min: 8, max: 64 }).withMessage('Falta la clave de operación (evita registrar dos veces)'),
    body('cliente').isMongoId().withMessage('Cliente inválido'),
    body('monto').custom(entero(1)).withMessage('Monto: centavos enteros > 0'),
    body('metodo').isIn(METODOS_ABONO).withMessage(`Forma de pago inválida (${METODOS_ABONO.join(', ')})`),
    body('referencia').optional().isString().trim().isLength({ max: 40 }),
    body('cargos').optional().isArray({ max: 200 }),
    body('cargos.*').isMongoId().withMessage('Cargo inválido')
  ]),
  async (req, res) => {
    const { abono, repetido } = await credito.registrarAbono(req.alcance, req.user, req.datos);
    res.status(repetido ? 200 : 201).json({ ok: true, repetido, datos: abono });
  }
);

router.get(
  '/abonos/:id/comprobante',
  puedeVerCuentas,
  validar([param('id').isMongoId(), query('ancho').optional().isIn(['58', '80']).toInt()]),
  async (req, res) => {
    const abono = await credito.obtenerAbono(req.datos.id);
    const [sucursal, ec] = await Promise.all([Sucursal.findById(abono.sucursal).lean(), credito.estadoCuenta(abono.cliente.id)]);
    res.set('Content-Security-Policy', CSP_IMPRESION);
    res.type('html').send(htmlAbono(abono, { sucursal: sucursal?.nombre || '', saldo: ec.resumen.saldo, ancho: req.datos.ancho || 80 }));
  }
);

router.post(
  '/abonos/:id/cancelar',
  requirePermiso('cobranza:registrar_abono'),
  validar([
    param('id').isMongoId(),
    body('motivo').isString().trim().isLength({ min: 3, max: 300 }).withMessage('Indica el motivo de la cancelación'),
    body('autorizacion').isObject().withMessage('Falta la autorización del dueño'),
    body('autorizacion.usuario').isString().trim().notEmpty().withMessage('Falta el usuario que autoriza'),
    body('autorizacion.pin').isString().notEmpty().withMessage('Falta el PIN')
  ]),
  async (req, res) => {
    res.json({ ok: true, datos: await credito.cancelarAbono(req.alcance, req.user, req.datos.id, req.datos) });
  }
);

module.exports = router;

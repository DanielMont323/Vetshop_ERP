// Autofactura: página PÚBLICA (sin sesión) donde el cliente factura su ticket del mes.
// Se protege con un límite de intentos por IP (services/facturacion.autofacturar) y la descarga exige el UUID.
const express = require('express');
const { body, param, query } = require('express-validator');
const { validar } = require('../middleware/validar');
const facturacion = require('../services/facturacion');
const { REGIMENES, USOS_CFDI, RE_CP } = require('../config/sat');
const { RE_RFC } = require('../models/Proveedor');

const router = express.Router();

router.get('/sucursales', async (req, res) => {
  res.json({ ok: true, datos: await facturacion.sucursalesAutofactura() });
});

router.post(
  '/',
  validar([
    body('sucursal').isMongoId().withMessage('Elige la sucursal'),
    body('folio').isString().trim().isLength({ min: 1, max: 15 }).withMessage('Escribe el folio del ticket'),
    body('total').custom(v => Number.isSafeInteger(v) && v > 0).withMessage('Escribe el total del ticket'),
    body('rfc').isString().trim().toUpperCase().matches(RE_RFC).withMessage('RFC inválido'),
    body('razonSocial').isString().trim().isLength({ min: 2, max: 254 }).withMessage('Escribe tu nombre o razón social como en tu constancia'),
    body('regimen').isIn(Object.keys(REGIMENES)).withMessage('Elige tu régimen fiscal'),
    body('codigoPostal').matches(RE_CP).withMessage('Código postal: 5 dígitos'),
    body('usoCfdi').isIn(Object.keys(USOS_CFDI)).withMessage('Elige el uso del CFDI'),
    body('email').optional({ values: 'falsy' }).isEmail().withMessage('Correo inválido')
  ]),
  async (req, res) => {
    const { factura } = await facturacion.autofacturar(req.ip, req.datos);
    res.status(201).json({ ok: true, datos: { id: factura.id, folio: factura.folioCompleto, uuid: factura.uuid, total: factura.total, receptor: factura.receptor.razonSocial } });
  }
);

router.get('/:id/:tipo', validar([param('id').isMongoId(), param('tipo').isIn(['xml', 'representacion']), query('uuid').isUUID()]), async (req, res) => {
  const doc = await facturacion.documentoPublico(req.datos.id, req.datos.uuid, req.datos.tipo);
  if (req.datos.tipo === 'xml') {
    res.set('Content-Disposition', `attachment; filename="${doc.nombre}"`);
    return res.type('application/xml').send(doc.contenido);
  }
  if (doc.tipo === 'text/html') res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  return res.type(doc.tipo).send(doc.contenido);
});

module.exports = router;

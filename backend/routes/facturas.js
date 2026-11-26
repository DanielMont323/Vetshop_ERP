// Facturación CFDI (ruta operativa: autenticar + scopeSucursal).
//   Emitir (a cliente, global, nota de crédito, complemento) y consultar: facturacion:emitir (cajero y dueño).
//   Cancelar: facturacion:cancelar con PIN del dueño.
const express = require('express');
const { body, param, query } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const facturacion = require('../services/facturacion');
const { USOS_CFDI, FORMAS_PAGO, MOTIVOS_CANCELACION, PERIODICIDADES } = require('../config/sat');

const router = express.Router();
const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;
const id = param('id').isMongoId().withMessage('Id de factura inválido');
const clave = body('claveOperacion').isString().trim().isLength({ min: 8, max: 64 }).withMessage('Falta la clave de operación');
const centavos = v => Number.isSafeInteger(v) && v > 0;
router.use(requirePermiso('facturacion:emitir'));

const responder = (res, { factura, repetida }) => res.status(repetida ? 200 : 201).json({ ok: true, repetida, datos: factura });

router.get(
  '/',
  validar([
    query('desde').optional().matches(RE_YMD), query('hasta').optional().matches(RE_YMD),
    query('tipo').optional().isIn(['I', 'E', 'P']), query('estado').optional().isIn(['pendiente', 'timbrada', 'error', 'cancelada']),
    query('q').optional().isString().trim().isLength({ max: 60 }),
    query('pagina').optional().isInt({ min: 1 }).toInt(), query('limite').optional().isInt({ min: 1, max: 200 }).toInt()
  ]),
  async (req, res) => {
    res.json({ ok: true, ...(await facturacion.listar(req.alcance, req.datos)) });
  }
);

router.get(
  '/ventas-facturables',
  validar([query('desde').optional().matches(RE_YMD), query('hasta').optional().matches(RE_YMD), query('folio').optional().isInt({ min: 1 }).toInt()]),
  async (req, res) => {
    res.json({ ok: true, datos: await facturacion.ventasFacturables(req.alcance, req.datos) });
  }
);

router.post(
  '/',
  validar([
    clave,
    body('cliente').isMongoId().withMessage('Cliente inválido'),
    body('ventas').isArray({ min: 1, max: 100 }).withMessage('Elige de 1 a 100 ventas'),
    body('ventas.*').isMongoId(),
    body('usoCfdi').optional().isIn(Object.keys(USOS_CFDI)).withMessage('Uso de CFDI inválido'),
    body('email').optional({ values: 'falsy' }).isEmail().withMessage('Correo inválido')
  ]),
  async (req, res) => responder(res, await facturacion.facturarCliente(req.alcance, req.user, req.datos))
);

router.post(
  '/global',
  validar([
    clave,
    body('periodicidad').isIn(Object.keys(PERIODICIDADES)).withMessage(`Periodicidad: ${Object.keys(PERIODICIDADES).join(', ')}`),
    body('desde').matches(RE_YMD).withMessage('desde: AAAA-MM-DD'),
    body('hasta').matches(RE_YMD).withMessage('hasta: AAAA-MM-DD')
  ]),
  async (req, res) => responder(res, await facturacion.facturarGlobal(req.alcance, req.user, req.datos))
);

router.get('/:id', validar([id]), async (req, res) => {
  res.json({ ok: true, datos: await facturacion.obtener(req.alcance, req.datos.id) });
});

router.get('/:id/xml', validar([id]), async (req, res) => {
  const { nombre, contenido } = await facturacion.xml(req.alcance, req.datos.id);
  res.set('Content-Disposition', `attachment; filename="${nombre}"`);
  res.type('application/xml').send(contenido);
});

router.get('/:id/representacion', validar([id]), async (req, res) => {
  const { tipo, contenido } = await facturacion.representacion(req.alcance, req.datos.id);
  if (tipo === 'text/html') res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.type(tipo).send(contenido);
});

router.post(
  '/:id/nota-credito',
  validar([id, clave, body('monto').custom(centavos).withMessage('Monto: centavos enteros > 0'), body('descripcion').optional().isString().trim().isLength({ max: 200 })]),
  async (req, res) => responder(res, await facturacion.notaCredito(req.alcance, req.user, req.datos.id, req.datos))
);

router.post(
  '/:id/complemento-pago',
  validar([
    id, clave,
    body('monto').custom(centavos).withMessage('Monto: centavos enteros > 0'),
    body('formaPago').isIn(Object.keys(FORMAS_PAGO)).withMessage('Forma de pago inválida'),
    body('fecha').optional().matches(RE_YMD)
  ]),
  async (req, res) => responder(res, await facturacion.complementoPago(req.alcance, req.user, req.datos.id, req.datos))
);

router.post(
  '/:id/cancelar',
  requirePermiso('facturacion:cancelar'),
  validar([
    id,
    body('motivo').isIn(Object.keys(MOTIVOS_CANCELACION)).withMessage('Motivo de cancelación del SAT inválido'),
    body('sustitucion').optional({ values: 'falsy' }).isUUID().withMessage('UUID de sustitución inválido'),
    body('autorizacion').isObject().withMessage('Falta la autorización del dueño'),
    body('autorizacion.usuario').isString().trim().notEmpty(),
    body('autorizacion.pin').isString().notEmpty()
  ]),
  async (req, res) => {
    res.json({ ok: true, datos: await facturacion.cancelar(req.alcance, req.user, req.datos.id, req.datos) });
  }
);

module.exports = router;

// Metas de venta (ruta operativa: autenticar + scopeSucursal).
//   Avance de las sucursales del alcance: reportes:ver. Definir metas: metas:gestionar (dueño).
//   Mi avance y lista de vendedores (para la caja): ventas:cobrar.
const express = require('express');
const { body, query } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const metas = require('../services/metas');
const { RE_PERIODO } = require('../models/Meta');

const router = express.Router();

router.get('/', requirePermiso('reportes:ver'), validar([query('periodo').optional().matches(RE_PERIODO).withMessage('Periodo: AAAA-MM')]), async (req, res) => {
  res.json({ ok: true, datos: await metas.avance(req.alcance, req.datos) });
});

router.put(
  '/',
  requirePermiso('metas:gestionar'),
  validar([
    body('periodo').matches(RE_PERIODO).withMessage('Periodo: AAAA-MM'),
    body('vendedor').optional({ values: 'null' }).isMongoId().withMessage('Vendedor inválido'),
    body('monto').custom(v => Number.isSafeInteger(v) && v >= 0).withMessage('Meta: centavos enteros ≥ 0 (0 la quita)'),
    body('tickets').optional({ values: 'null' }).custom(v => Number.isSafeInteger(v) && v >= 0).withMessage('Tickets: entero ≥ 0')
  ]),
  async (req, res) => {
    res.json({ ok: true, datos: await metas.fijar(req.alcance, req.user, req.datos) });
  }
);

router.get('/mi-avance', requirePermiso('ventas:cobrar'), async (req, res) => {
  res.json({ ok: true, datos: await metas.miAvance(req.alcance, req.user) });
});

router.get('/vendedores', requirePermiso('ventas:cobrar'), async (req, res) => {
  res.json({ ok: true, datos: await metas.vendedores(req.alcance) });
});

module.exports = router;

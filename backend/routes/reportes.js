// Dashboard y reportes (ruta operativa: autenticar + scopeSucursal). Permiso reportes:ver (dueño).
// Sin X-Sucursal el dueño ve todas las sucursales; con X-Sucursal, solo esa.
const express = require('express');
const { query } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const reportes = require('../services/reportes');
const { libroVentas } = require('../helpers/excelReportes');
const { solicitudInvalida } = require('../helpers/errores');

const router = express.Router();
router.use(requirePermiso('reportes:ver'));

const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS = 366 * 3;
const reglasRango = [
  query('desde').optional().matches(RE_YMD).withMessage('desde: AAAA-MM-DD'),
  query('hasta').optional().matches(RE_YMD).withMessage('hasta: AAAA-MM-DD'),
  query('agrupar').optional().isIn(['dia', 'semana', 'mes', 'anio']).withMessage('agrupar: dia, semana, mes o anio')
];

function exigirRango(datos) {
  const { inicio, fin } = reportes.rango(datos);
  if ((fin - inicio) / 86400000 > MAX_DIAS) throw solicitudInvalida('El rango máximo es de 3 años');
}

router.get('/dashboard', async (req, res) => {
  res.json({ ok: true, datos: await reportes.dashboard(req.alcance) });
});

// GET /api/reportes/ventas?desde=&hasta=&agrupar=dia|semana|mes|anio
router.get('/ventas', validar(reglasRango), async (req, res) => {
  exigirRango(req.datos);
  res.json({ ok: true, datos: await reportes.resumen(req.alcance, req.datos) });
});

// GET /api/reportes/ventas.xlsx?desde=&hasta=&agrupar= — descarga para el contador
router.get('/ventas.xlsx', validar(reglasRango), async (req, res) => {
  exigirRango(req.datos);
  const [resumen, ventas] = await Promise.all([reportes.resumen(req.alcance, req.datos), reportes.detalleVentas(req.alcance, req.datos)]);
  const buffer = await libroVentas(resumen, ventas, { titulo: 'Reporte de ventas · Huellitas Vetshop' });
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="ventas_${resumen.desde}_${resumen.hasta}.xlsx"`);
  res.send(Buffer.from(buffer));
});

module.exports = router;

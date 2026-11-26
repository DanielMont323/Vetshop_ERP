// Cadena de frío (ruta operativa: autenticar + scopeSucursal).
//   Ver equipos, registrar y ver lecturas, bitácora: cadena_frio:capturar.
//   Alta y cambios de equipos: cadena_frio:gestionar_equipos (dueño).
const express = require('express');
const { body, param, query } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const frio = require('../services/cadenaFrio');
const { TIPOS_EQUIPO } = require('../models/EquipoFrio');
const { htmlBitacoraFrio } = require('../helpers/bitacoraFrio');
const { libroBitacoraFrio } = require('../helpers/excelReportes');

const router = express.Router();
const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;
const capturar = requirePermiso('cadena_frio:capturar');
const gestionar = requirePermiso('cadena_frio:gestionar_equipos');
const grados = v => typeof v === 'number' && v >= -40 && v <= 60 && Math.round(v * 10) === v * 10;

function reglasEquipo(opcional) {
  const o = r => (opcional ? r.optional() : r);
  return [
    o(body('nombre').isString().trim().isLength({ min: 1, max: 60 }).withMessage('El nombre es obligatorio (máx. 60)')),
    body('tipo').optional().isIn(TIPOS_EQUIPO).withMessage(`Tipo inválido (${TIPOS_EQUIPO.join(', ')})`),
    body('minimo').optional().custom(grados).withMessage('Mínimo: °C de −40 a 60, un decimal'),
    body('maximo').optional().custom(grados).withMessage('Máximo: °C de −40 a 60, un decimal'),
    body('lecturasPorDia').optional().custom(v => Number.isSafeInteger(v) && v >= 1 && v <= 12).withMessage('Lecturas por día: de 1 a 12'),
    body('activo').optional().isBoolean({ strict: true })
  ];
}

router.get('/equipos', capturar, validar([query('incluirInactivos').optional().isBoolean().toBoolean()]), async (req, res) => {
  res.json({ ok: true, datos: await frio.listarEquipos(req.alcance, req.datos) });
});

router.post('/equipos', gestionar, validar(reglasEquipo(false)), async (req, res) => {
  res.status(201).json({ ok: true, datos: await frio.crearEquipo(req.alcance, req.user, req.datos) });
});

router.patch('/equipos/:id', gestionar, validar([param('id').isMongoId(), ...reglasEquipo(true)]), async (req, res) => {
  const { id, ...cambios } = req.datos;
  res.json({ ok: true, datos: await frio.actualizarEquipo(req.alcance, req.user, id, cambios) });
});

router.get(
  '/lecturas',
  capturar,
  validar([
    query('equipo').optional().isMongoId(),
    query('desde').optional().matches(RE_YMD),
    query('hasta').optional().matches(RE_YMD),
    query('fueraDeRango').optional().isBoolean().toBoolean()
  ]),
  async (req, res) => {
    res.json({ ok: true, datos: await frio.listarLecturas(req.alcance, req.datos) });
  }
);

router.post(
  '/lecturas',
  capturar,
  validar([
    body('equipo').isMongoId().withMessage('Equipo inválido'),
    body('temperatura').custom(grados).withMessage('Temperatura en °C, de −40 a 60, con máximo un decimal'),
    body('observacion').optional().isString().trim().isLength({ max: 300 }),
    body('accionCorrectiva').optional().isString().trim().isLength({ max: 500 }),
    body('productosAfectados').optional().isString().trim().isLength({ max: 500 })
  ]),
  async (req, res) => {
    res.status(201).json({ ok: true, datos: await frio.registrarLectura(req.alcance, req.user, req.datos) });
  }
);

const reglasBitacora = [query('equipo').isMongoId().withMessage('Indica el equipo'), query('mes').matches(/^\d{4}-\d{2}$/).withMessage('Mes: AAAA-MM')];

router.get('/bitacora', capturar, validar(reglasBitacora), async (req, res) => {
  const b = await frio.bitacora(req.alcance, req.datos);
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.type('html').send(htmlBitacoraFrio(b));
});

router.get('/bitacora.xlsx', capturar, validar(reglasBitacora), async (req, res) => {
  const b = await frio.bitacora(req.alcance, req.datos);
  const buffer = await libroBitacoraFrio(b);
  const nombre = `bitacora-${b.equipo.nombre.normalize('NFD').replace(/[^\w-]+/g, '-')}-${b.mes}.xlsx`;
  res.set('Content-Disposition', `attachment; filename="${nombre}"`);
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buffer));
});

module.exports = router;

// Turnos de caja y corte (ruta operativa: autenticar + scopeSucursal).
// Abrir, retirar, contar y cerrar: corte:capturar_conteo (cajero y dueño). Ver todos: turnos:ver_todos (dueño).
const express = require('express');
const { body, param, query } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const { tienePermiso } = require('../config/permisos');
const turnos = require('../services/turnos');
const Sucursal = require('../models/Sucursal');
const { DENOMINACIONES, ESTADOS } = require('../models/Turno');
const { htmlCorte } = require('../helpers/corte');
const { conflicto } = require('../helpers/errores');

const router = express.Router();
router.use(requirePermiso('corte:capturar_conteo'));

const id = param('id').isMongoId().withMessage('Id de turno inválido');
const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;
const centavos = (min = 0) => v => Number.isSafeInteger(v) && v >= min;
const verTodos = req => tienePermiso(req.user.rol, 'turnos:ver_todos');
const reglasDenominaciones = campo => [
  body(campo).isArray({ max: DENOMINACIONES.length }).withMessage('Captura los billetes y monedas'),
  body(`${campo}.*.denominacion`).isIn(DENOMINACIONES).withMessage('Denominación inválida'),
  body(`${campo}.*.cantidad`).custom(centavos(0)).withMessage('Cantidad de billetes o monedas: entero ≥ 0')
];
const reglasAutorizacion = [
  body('autorizacion.usuario').isString().trim().notEmpty().withMessage('Falta el usuario del dueño'),
  body('autorizacion.pin').isString().notEmpty().withMessage('Falta el PIN')
];

// GET /api/turnos/actual — mi turno vigente en la sucursal activa (o null). Sin importes esperados.
router.get('/actual', async (req, res) => {
  res.json({ ok: true, datos: await turnos.actual(req.alcance, req.user) });
});

// POST /api/turnos { caja?, denominaciones? | fondo } — abrir turno con el fondo inicial
router.post(
  '/',
  validar([
    body('caja').optional().custom(v => Number.isSafeInteger(v) && v >= 1 && v <= 20).withMessage('Caja inválida'),
    body('fondo').optional().custom(centavos(0)).withMessage('Fondo: centavos enteros ≥ 0'),
    ...reglasDenominaciones('denominaciones').map(r => r.optional())
  ]),
  async (req, res) => {
    res.status(201).json({ ok: true, datos: await turnos.abrir(req.alcance, req.user, req.datos) });
  }
);

router.get(
  '/',
  validar([
    query('desde').optional().matches(RE_YMD),
    query('hasta').optional().matches(RE_YMD),
    query('estado').optional().isIn(ESTADOS),
    query('pagina').optional().isInt({ min: 1 }).toInt(),
    query('limite').optional().isInt({ min: 1, max: 100 }).toInt()
  ]),
  async (req, res) => {
    res.json({ ok: true, ...(await turnos.listar(req.alcance, req.user, req.datos, { verTodos: verTodos(req) })) });
  }
);

router.get('/:id', validar([id]), async (req, res) => {
  res.json({ ok: true, datos: await turnos.obtener(req.alcance, req.user, req.datos.id, { verTodos: verTodos(req) }) });
});

// POST /api/turnos/:id/retiros { monto, motivo, autorizacion } — PIN del dueño
router.post(
  '/:id/retiros',
  validar([
    id,
    body('monto').custom(centavos(1)).withMessage('Monto: centavos enteros > 0'),
    body('motivo').isString().trim().isLength({ min: 3, max: 200 }).withMessage('Indica el motivo del retiro'),
    ...reglasAutorizacion
  ]),
  async (req, res) => {
    res.status(201).json({ ok: true, datos: await turnos.retirar(req.alcance, req.user, req.datos.id, req.datos) });
  }
);

// POST /api/turnos/:id/conteo { denominaciones, tarjeta, transferencia } — corte ciego (una sola vez)
router.post(
  '/:id/conteo',
  validar([
    id,
    ...reglasDenominaciones('denominaciones'),
    body('tarjeta').custom(centavos(0)).withMessage('Total de la terminal: centavos enteros ≥ 0'),
    body('transferencia').custom(centavos(0)).withMessage('Total de transferencias: centavos enteros ≥ 0')
  ]),
  async (req, res) => {
    res.json({ ok: true, datos: await turnos.registrarConteo(req.alcance, req.user, req.datos.id, req.datos) });
  }
);

// POST /api/turnos/:id/cerrar { justificacion, autorizacion } — solo si hubo diferencia; PIN del dueño
router.post(
  '/:id/cerrar',
  validar([id, body('justificacion').isString().trim().isLength({ min: 5, max: 500 }).withMessage('Explica la diferencia (mínimo 5 caracteres)'), ...reglasAutorizacion]),
  async (req, res) => {
    res.json({ ok: true, datos: await turnos.cerrar(req.alcance, req.user, req.datos.id, req.datos) });
  }
);

// GET /api/turnos/:id/corte?ancho=58|80 — HTML para imprimir (con el conteo ya registrado)
router.get('/:id/corte', validar([id, query('ancho').optional().isIn(['58', '80']).toInt()]), async (req, res) => {
  const turno = await turnos.obtener(req.alcance, req.user, req.datos.id, { verTodos: verTodos(req) });
  if (!turno.conteo) throw conflicto('El corte se imprime después de registrar el conteo', 'TURNO_SIN_CONTEO');
  const sucursal = await Sucursal.findById(turno.sucursal).lean();
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.type('html').send(htmlCorte(turno, { sucursal: sucursal?.nombre || '', ancho: req.datos.ancho || 80 }));
});

module.exports = router;

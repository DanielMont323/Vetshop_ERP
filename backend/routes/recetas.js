// Recetas (ruta operativa: autenticar + scopeSucursal).
// Capturar, consultar y adjuntar archivo: recetas:capturar (cajero, médico, dueño).
// Validar: con usuario y PIN del médico responsable (lo verifica el servicio).
const express = require('express');
const { body, param, query } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const recetas = require('../services/recetas');
const { ESTADOS } = require('../models/Receta');
const { TIPOS, TAMANO_MAXIMO } = require('../services/almacenamiento');

const router = express.Router();
router.use(requirePermiso('recetas:capturar'));

const id = param('id').isMongoId().withMessage('Id de receta inválido');
const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;
const texto = (campo, max, mensaje) => body(campo).isString().trim().isLength({ min: 1, max }).withMessage(mensaje);

const reglasReceta = [
  body('fechaReceta').matches(RE_YMD).withMessage('Fecha de la receta: AAAA-MM-DD'),
  texto('medico.nombre', 120, 'Falta el médico que prescribe'),
  texto('medico.cedula', 20, 'Falta la cédula profesional'),
  texto('propietario.nombre', 120, 'Falta el nombre del propietario'),
  body('propietario.telefono').optional().isString().trim().isLength({ max: 20 }),
  texto('paciente.nombre', 80, 'Falta el nombre del paciente'),
  texto('paciente.especie', 40, 'Falta la especie del paciente'),
  body('observaciones').optional().isString().trim().isLength({ max: 500 }),
  body('partidas').isArray({ min: 1, max: 20 }).withMessage('La receta debe tener entre 1 y 20 medicamentos'),
  body('partidas.*.producto').isMongoId().withMessage('Medicamento inválido'),
  body('partidas.*.cantidadPrescrita').custom(v => Number.isSafeInteger(v) && v > 0).withMessage('Cantidad prescrita: entero > 0 (piezas o gramos)'),
  body('partidas.*.indicaciones').optional().isString().trim().isLength({ max: 300 })
];
const reglasAutorizacion = [
  body('autorizacion.usuario').isString().trim().notEmpty().withMessage('Falta el usuario del médico responsable'),
  body('autorizacion.pin').isString().notEmpty().withMessage('Falta el PIN')
];

// GET /api/recetas — historial: ?estado=&desde=&hasta=&producto=&q=
router.get(
  '/',
  validar([
    query('estado').optional().isIn(ESTADOS),
    query('desde').optional().matches(RE_YMD),
    query('hasta').optional().matches(RE_YMD),
    query('producto').optional().isMongoId(),
    query('q').optional().isString().trim().isLength({ max: 80 }),
    query('pagina').optional().isInt({ min: 1 }).toInt(),
    query('limite').optional().isInt({ min: 1, max: 100 }).toInt()
  ]),
  async (req, res) => {
    res.json({ ok: true, ...(await recetas.listar(req.alcance, req.datos)) });
  }
);

// GET /api/recetas/disponibles?producto= — validadas con cantidad pendiente (para la caja)
router.get('/disponibles', validar([query('producto').isMongoId().withMessage('Indica el producto')]), async (req, res) => {
  res.json({ ok: true, datos: await recetas.disponibles(req.alcance, req.datos.producto) });
});

router.get('/:id', validar([id]), async (req, res) => {
  res.json({ ok: true, datos: await recetas.obtener(req.alcance, req.datos.id) });
});

router.post('/', validar(reglasReceta), async (req, res) => {
  res.status(201).json({ ok: true, datos: await recetas.crear(req.alcance, req.user, req.datos) });
});

router.put('/:id', validar([id, ...reglasReceta]), async (req, res) => {
  const { id: recetaId, ...datos } = req.datos;
  res.json({ ok: true, datos: await recetas.actualizar(req.alcance, req.user, recetaId, datos) });
});

router.post('/:id/validar', validar([id, ...reglasAutorizacion]), async (req, res) => {
  res.json({ ok: true, datos: await recetas.validar(req.alcance, req.user, req.datos.id, req.datos.autorizacion) });
});

router.post('/:id/cancelar', validar([id, body('motivo').isString().trim().isLength({ min: 3, max: 300 }).withMessage('Indica el motivo')]), async (req, res) => {
  res.json({ ok: true, datos: await recetas.cancelar(req.alcance, req.user, req.datos.id, req.datos.motivo) });
});

// PUT /api/recetas/:id/archivo — cuerpo binario (image/jpeg, image/png o application/pdf, máx. 5 MB)
// El nombre original va en el encabezado X-Nombre-Archivo (codificado con encodeURIComponent).
router.put(
  '/:id/archivo',
  express.raw({ type: Object.keys(TIPOS), limit: TAMANO_MAXIMO }),
  validar([id]),
  async (req, res) => {
    let nombre;
    try {
      nombre = decodeURIComponent(req.get('X-Nombre-Archivo') || '');
    } catch {
      nombre = '';
    }
    const tipo = (req.get('Content-Type') || '').split(';')[0].trim();
    const archivo = await recetas.subirArchivo(req.alcance, req.user, req.datos.id, req.body, { tipo, nombre });
    res.json({ ok: true, datos: archivo });
  }
);

router.get('/:id/archivo', validar([id]), async (req, res) => {
  const { buffer, tipo, nombre } = await recetas.leerArchivo(req.alcance, req.datos.id);
  res.set('Content-Type', tipo);
  res.set('Content-Disposition', `inline; filename="${encodeURIComponent(nombre)}"`);
  res.send(buffer);
});

module.exports = router;

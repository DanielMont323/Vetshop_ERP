// Pedidos a proveedores (ruta operativa: autenticar + scopeSucursal). Mismo permiso que la recepción.
const express = require('express');
const { body, param, query } = require('express-validator');
const { validar } = require('../middleware/validar');
const { requirePermiso } = require('../middleware/permisos');
const pedidos = require('../services/pedidos');
const Sucursal = require('../models/Sucursal');
const Proveedor = require('../models/Proveedor');
const { ESTADOS } = require('../models/PedidoProveedor');
const { htmlPedido } = require('../helpers/documentoPedido');

const router = express.Router();
router.use(requirePermiso('recepcion:registrar'));

const id = param('id').isMongoId().withMessage('Id de pedido inválido');
const entero = min => v => Number.isSafeInteger(v) && v >= min;
const reglasPedido = [
  body('proveedor').isMongoId().withMessage('Proveedor inválido'),
  body('notas').optional().isString().trim().isLength({ max: 500 }),
  body('origen').optional().isIn(['manual', 'sugeridas']),
  body('partidas').isArray({ min: 1, max: 200 }).withMessage('El pedido debe tener entre 1 y 200 productos'),
  body('partidas.*.producto').isMongoId().withMessage('Producto inválido'),
  body('partidas.*.cantidad').custom(entero(1)).withMessage('Cantidad: entero > 0 (piezas o gramos)'),
  body('partidas.*.costoEstimado').optional({ values: 'null' }).custom(entero(0)).withMessage('Costo: centavos enteros ≥ 0')
];

router.get('/', validar([query('estado').optional().isIn([...ESTADOS, 'abiertos']), query('proveedor').optional().isMongoId()]), async (req, res) => {
  res.json({ ok: true, datos: await pedidos.listar(req.alcance, req.datos) });
});

router.get('/:id', validar([id]), async (req, res) => {
  res.json({ ok: true, datos: await pedidos.obtener(req.alcance, req.datos.id) });
});

// Documento en hoja carta (imprimir o guardar como PDF)
router.get('/:id/documento', validar([id]), async (req, res) => {
  const pedido = await pedidos.obtener(req.alcance, req.datos.id);
  const [sucursal, proveedor] = await Promise.all([Sucursal.findById(pedido.sucursal).lean(), Proveedor.findById(pedido.proveedor.id).lean()]);
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.type('html').send(htmlPedido(pedido, { sucursal: sucursal?.nombre || '', proveedor: proveedor || {} }));
});

router.post('/', validar(reglasPedido), async (req, res) => {
  res.status(201).json({ ok: true, datos: await pedidos.crear(req.alcance, req.user, req.datos) });
});

router.put('/:id', validar([id, ...reglasPedido]), async (req, res) => {
  const { id: pid, ...datos } = req.datos;
  res.json({ ok: true, datos: await pedidos.actualizar(req.alcance, req.user, pid, datos) });
});

router.post('/:id/enviar', validar([id]), async (req, res) => {
  res.json({ ok: true, datos: await pedidos.enviar(req.alcance, req.user, req.datos.id) });
});

router.post('/:id/cancelar', validar([id, body('motivo').isString().trim().isLength({ min: 3, max: 300 }).withMessage('Indica el motivo')]), async (req, res) => {
  res.json({ ok: true, datos: await pedidos.cancelar(req.alcance, req.user, req.datos.id, req.datos.motivo) });
});

module.exports = router;

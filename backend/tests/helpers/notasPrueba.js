// Recurso operativo SOLO de pruebas para comprobar el alcance por sucursal de punta a punta.
// Imita cómo serán las rutas reales (existencias, ventas…): ruta → servicio con conAlcance.
// Se monta como ruta operativa (autenticar + scopeSucursal) solo en la app de pruebas.
const express = require('express');
const mongoose = require('mongoose');
const { alcanceSucursal } = require('../../models/plugins/alcanceSucursal');
const { conAlcance, sucursalDeEscritura, matchAlcance } = require('../../helpers/alcance');
const { requirePermiso } = require('../../middleware/permisos');
const { noEncontrado } = require('../../helpers/errores');

const esquema = new mongoose.Schema({
  sucursal: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal', required: true, index: true },
  texto: { type: String, required: true },
  importe: { type: Number, default: 0 }
});
esquema.plugin(alcanceSucursal);
const NotaPrueba = mongoose.models.NotaPrueba || mongoose.model('NotaPrueba', esquema);

// "Servicio"
const servicio = {
  listar: alcance => NotaPrueba.find(conAlcance({}, alcance)).sort({ texto: 1 }).lean(),
  obtener: async (alcance, id) => {
    const nota = await NotaPrueba.findOne(conAlcance({ _id: id }, alcance)).lean();
    if (!nota) throw noEncontrado('Nota no encontrada');
    return nota;
  },
  // Una `sucursal` que venga en el cuerpo se IGNORA a propósito: siempre se escribe en la sucursal activa
  crear: (alcance, { texto, importe }) => NotaPrueba.create({ texto, importe, sucursal: sucursalDeEscritura(alcance) }),
  actualizar: async (alcance, id, texto) => {
    const nota = await NotaPrueba.findOneAndUpdate(conAlcance({ _id: id }, { ...alcance, sucursalActiva: sucursalDeEscritura(alcance) }), { texto }, { new: true }).lean();
    if (!nota) throw noEncontrado('Nota no encontrada');
    return nota;
  },
  total: async alcance => {
    const [r] = await NotaPrueba.aggregate([matchAlcance(alcance), { $group: { _id: null, total: { $sum: '$importe' } } }]);
    return r ? r.total : 0;
  }
};

const router = express.Router();
router.get('/', requirePermiso('existencias:ver'), async (req, res) => res.json({ ok: true, datos: await servicio.listar(req.alcance) }));
router.get('/total', requirePermiso('existencias:ver'), async (req, res) => res.json({ ok: true, datos: await servicio.total(req.alcance) }));
router.get('/:id', requirePermiso('existencias:ver'), async (req, res) => res.json({ ok: true, datos: await servicio.obtener(req.alcance, req.params.id) }));
router.post('/', requirePermiso('existencias:ver'), async (req, res) => res.status(201).json({ ok: true, datos: await servicio.crear(req.alcance, req.body) }));
router.patch('/:id', requirePermiso('existencias:ver'), async (req, res) => res.json({ ok: true, datos: await servicio.actualizar(req.alcance, req.params.id, req.body.texto) }));

module.exports = { NotaPrueba, router };

// Venta en espera: un carrito guardado sin cobrar. NO consume inventario ni toma folio.
// Al cobrarla se manda su id y se borra en la misma transacción de la venta.
const mongoose = require('mongoose');
const { alcanceSucursal } = require('./plugins/alcanceSucursal');

const ventaEnEsperaSchema = new mongoose.Schema(
  {
    sucursal: { type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal', required: true },
    cajero: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
    cliente: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente' },
    nota: { type: String, trim: true, maxlength: 120 },
    partidas: [
      {
        _id: false,
        producto: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true },
        cantidad: { type: Number, required: true, min: 1 },
        descuentoPorcentaje: { type: Number, min: 0, max: 10000 },
        descuentoMonto: { type: Number, min: 0 }
      }
    ]
  },
  { timestamps: true }
);

ventaEnEsperaSchema.index({ sucursal: 1, createdAt: -1 });
ventaEnEsperaSchema.plugin(alcanceSucursal);

module.exports = mongoose.model('VentaEnEspera', ventaEnEsperaSchema, 'ventas_en_espera');

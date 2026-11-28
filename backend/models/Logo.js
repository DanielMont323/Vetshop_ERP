// Imágenes para las notas y tickets: logo de cada marca ('negocio' = Vet Shop, 'mostrador' = Huellitas Vetshop)
// y logos de las marcas que se manejan, al pie de la nota ('pie-0' … 'pie-7'). Se guardan como data URL
// (PNG, JPG o WEBP) en su propia colección para no cargarlas cada vez que se lee la configuración.
const mongoose = require('mongoose');

const CLAVES = ['negocio', 'mostrador', ...Array.from({ length: 8 }, (_, i) => `pie-${i}`)];
const RE_IMAGEN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_CARACTERES = 400000; // ≈ 290 KB de imagen

const logoSchema = new mongoose.Schema(
  {
    clave: { type: String, enum: CLAVES, required: true },
    imagen: { type: String, required: true, maxlength: MAX_CARACTERES, match: [RE_IMAGEN, 'Imagen inválida (PNG, JPG o WEBP)'] }
  },
  { timestamps: true }
);

logoSchema.index({ clave: 1 }, { unique: true });

module.exports = mongoose.model('Logo', logoSchema, 'logos');
Object.assign(module.exports, { CLAVES, RE_IMAGEN, MAX_CARACTERES });

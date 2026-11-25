// Usuario del sistema. Catálogo global; sus `sucursales` definen a qué datos operativos tiene acceso.
// El dueño ve todas las sucursales (su lista se ignora para el alcance).
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES, ROLES_CON_PIN } = require('../config/permisos');

const RONDAS_BCRYPT = process.env.NODE_ENV === 'test' ? 4 : 12;
const MIN_LONGITUD_PASSWORD = 8;
const RE_PIN = /^\d{4,6}$/;

const usuarioSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: [true, 'El nombre es obligatorio'], trim: true, maxlength: 80 },
    // Nombre para iniciar sesión (no se usa correo)
    usuario: {
      type: String,
      required: [true, 'El usuario es obligatorio'],
      trim: true,
      lowercase: true,
      match: [/^[a-z0-9._-]{3,30}$/, 'El usuario solo admite letras, números, punto, guion y guion bajo (3 a 30)']
    },
    passwordHash: { type: String, required: true, select: false },
    rol: { type: String, enum: ROLES, required: true },
    sucursales: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Sucursal' }],
    // PIN de autorización (solo dueño y médico responsable)
    pinHash: { type: String, select: false },
    activo: { type: Boolean, default: true },

    // Seguridad de inicio de sesión (en la BD, no en memoria: sirve en serverless)
    intentosFallidos: { type: Number, default: 0 },
    bloqueadoHasta: { type: Date },
    intentosPinFallidos: { type: Number, default: 0 },
    pinBloqueadoHasta: { type: Date },
    // Va dentro del JWT. Subirla invalida todas las sesiones abiertas (cambio de contraseña, baja…)
    versionToken: { type: Number, default: 0 }
  },
  { timestamps: true }
);

usuarioSchema.index({ usuario: 1 }, { unique: true });

usuarioSchema.path('sucursales').validate(function (lista) {
  if (this.rol === 'dueno') return true;
  return Array.isArray(lista) && lista.length > 0;
}, 'Los usuarios que no son dueño deben tener al menos una sucursal');

usuarioSchema.path('sucursales').validate(function (lista) {
  const ids = (lista || []).map(String);
  return new Set(ids).size === ids.length;
}, 'Sucursal repetida');

usuarioSchema.methods.usaPin = function () {
  return ROLES_CON_PIN.includes(this.rol);
};

usuarioSchema.methods.establecerPassword = async function (password) {
  if (typeof password !== 'string' || password.length < MIN_LONGITUD_PASSWORD) {
    const error = new mongoose.Error.ValidationError(this);
    error.addError('password', new mongoose.Error.ValidatorError({
      path: 'password',
      message: `La contraseña debe tener al menos ${MIN_LONGITUD_PASSWORD} caracteres`
    }));
    throw error;
  }
  this.passwordHash = await bcrypt.hash(password, RONDAS_BCRYPT);
};

usuarioSchema.methods.compararPassword = function (password) {
  if (!this.passwordHash || typeof password !== 'string') return Promise.resolve(false);
  return bcrypt.compare(password, this.passwordHash);
};

usuarioSchema.methods.establecerPin = async function (pin) {
  if (typeof pin !== 'string' || !RE_PIN.test(pin)) {
    const error = new mongoose.Error.ValidationError(this);
    error.addError('pin', new mongoose.Error.ValidatorError({ path: 'pin', message: 'El PIN debe tener de 4 a 6 dígitos' }));
    throw error;
  }
  this.pinHash = await bcrypt.hash(pin, RONDAS_BCRYPT);
  this.intentosPinFallidos = 0;
  this.pinBloqueadoHasta = undefined;
};

usuarioSchema.methods.compararPin = function (pin) {
  if (!this.pinHash || typeof pin !== 'string') return Promise.resolve(false);
  return bcrypt.compare(pin, this.pinHash);
};

// Datos que se pueden mostrar (nunca hashes ni contadores internos)
usuarioSchema.methods.publico = function () {
  return {
    id: this._id,
    nombre: this.nombre,
    usuario: this.usuario,
    rol: this.rol,
    sucursales: this.sucursales,
    activo: this.activo
  };
};

module.exports = mongoose.model('Usuario', usuarioSchema, 'usuarios');
module.exports.MIN_LONGITUD_PASSWORD = MIN_LONGITUD_PASSWORD;

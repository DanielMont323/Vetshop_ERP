// Almacenamiento de archivos (fotos/escaneos de recetas) FUERA de MongoDB.
//
// ALMACENAMIENTO=local        → carpeta en disco (ALMACENAMIENTO_CARPETA, por defecto backend/archivos).
//                               Solo para desarrollo y pruebas: en Vercel el disco no es persistente.
// ALMACENAMIENTO=vercel_blob  → PENDIENTE: requiere crear el almacén en Vercel y BLOB_READ_WRITE_TOKEN.
//                               (Se implementa con @vercel/blob: put / get / del, acceso privado.)
//
// La interfaz es la misma para cualquier driver: guardar(buffer, {tipo, nombre}) → clave; leer(clave) → buffer.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { solicitudInvalida, ErrorApp } = require('../helpers/errores');

const TAMANO_MAXIMO = 5 * 1024 * 1024; // 5 MB
// Tipos aceptados y su "firma" (primeros bytes): no basta con el Content-Type que manda el cliente
const TIPOS = {
  'image/jpeg': { extension: 'jpg', firma: [0xff, 0xd8, 0xff] },
  'image/png': { extension: 'png', firma: [0x89, 0x50, 0x4e, 0x47] },
  'application/pdf': { extension: 'pdf', firma: [0x25, 0x50, 0x44, 0x46] }
};

function validarArchivo(buffer, tipo) {
  const info = TIPOS[tipo];
  if (!info) throw solicitudInvalida('Solo se aceptan fotos JPG o PNG, o PDF');
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw solicitudInvalida('El archivo está vacío');
  if (buffer.length > TAMANO_MAXIMO) throw solicitudInvalida('El archivo pesa más de 5 MB');
  if (!info.firma.every((b, i) => buffer[i] === b)) throw solicitudInvalida('El contenido del archivo no corresponde a su tipo');
  return info;
}

function carpetaLocal() {
  return process.env.ALMACENAMIENTO_CARPETA || path.join(__dirname, '..', 'archivos');
}

const drivers = {
  local: {
    async guardar(buffer, { extension, prefijo }) {
      const clave = `${prefijo}/${crypto.randomUUID()}.${extension}`;
      const destino = path.join(carpetaLocal(), clave);
      await fs.mkdir(path.dirname(destino), { recursive: true });
      await fs.writeFile(destino, buffer, { flag: 'wx' });
      return clave;
    },
    async leer(clave) {
      // La clave la genera el servidor; aun así se impide salir de la carpeta
      const destino = path.resolve(carpetaLocal(), clave);
      if (!destino.startsWith(path.resolve(carpetaLocal()) + path.sep)) throw solicitudInvalida('Archivo inválido');
      return fs.readFile(destino);
    }
  },
  vercel_blob: {
    async guardar() {
      throw new ErrorApp(503, 'El almacenamiento en Vercel Blob aún no está configurado', 'ALMACENAMIENTO_NO_CONFIGURADO');
    },
    async leer() {
      throw new ErrorApp(503, 'El almacenamiento en Vercel Blob aún no está configurado', 'ALMACENAMIENTO_NO_CONFIGURADO');
    }
  }
};

function driver() {
  const nombre = process.env.ALMACENAMIENTO || 'local';
  if (!drivers[nombre]) throw new Error(`ALMACENAMIENTO desconocido: ${nombre}`);
  return drivers[nombre];
}

async function guardar(buffer, { tipo, nombre, prefijo = 'recetas' }) {
  const { extension } = validarArchivo(buffer, tipo);
  const clave = await driver().guardar(buffer, { extension, prefijo });
  return { clave, nombre: String(nombre || `archivo.${extension}`).slice(0, 120), tipo, tamano: buffer.length };
}

async function leer(clave) {
  return driver().leer(clave);
}

module.exports = { guardar, leer, validarArchivo, TIPOS, TAMANO_MAXIMO };

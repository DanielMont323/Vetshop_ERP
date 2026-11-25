// Cálculo de una venta: funciones puras (sin BD), todo en centavos enteros con redondeo half-up.
//
// Los precios son FINALES (con IVA). El IVA se DESGLOSA del importe: iva = importe − importe / (1 + tasa).
const { importePartida, aplicarTasa, dividirRedondeado, sumar, PUNTOS_BASE } = require('../helpers/dinero');
const { solicitudInvalida } = require('../helpers/errores');
const { PUNTOS_BASE_IVA } = require('../models/Producto');

// IVA contenido en un importe que ya lo incluye
function desglosarIva(importe, tasaPuntosBase) {
  if (tasaPuntosBase === 0) return 0;
  const base = dividirRedondeado(importe * PUNTOS_BASE, PUNTOS_BASE + tasaPuntosBase);
  return importe - base;
}

/**
 * @param {object} p
 *   producto (documento lean), cantidad (unidad base), precio { precio, lista } (de resolverPrecio),
 *   descuentoPorcentaje (puntos base, 1–10000) o descuentoMonto (centavos)
 */
function calcularPartida({ producto, cantidad, precio, descuentoPorcentaje, descuentoMonto }) {
  if (!Number.isSafeInteger(cantidad) || cantidad <= 0) throw solicitudInvalida(`${producto.nombre}: cantidad inválida`);
  if (descuentoPorcentaje !== undefined && descuentoMonto !== undefined) {
    throw solicitudInvalida(`${producto.nombre}: indica el descuento en porcentaje o en monto, no ambos`);
  }
  const bruto = importePartida({ precioUnitario: precio.precio, cantidad, unidad: producto.unidad });

  let descuento = 0;
  if (descuentoPorcentaje !== undefined) {
    if (!Number.isSafeInteger(descuentoPorcentaje) || descuentoPorcentaje < 0 || descuentoPorcentaje > PUNTOS_BASE) {
      throw solicitudInvalida(`${producto.nombre}: porcentaje de descuento inválido`);
    }
    descuento = aplicarTasa(bruto, descuentoPorcentaje);
  } else if (descuentoMonto !== undefined) {
    if (!Number.isSafeInteger(descuentoMonto) || descuentoMonto < 0) throw solicitudInvalida(`${producto.nombre}: descuento inválido`);
    if (descuentoMonto > bruto) throw solicitudInvalida(`${producto.nombre}: el descuento es mayor que el importe`);
    descuento = descuentoMonto;
  }

  const tasaIva = PUNTOS_BASE_IVA[producto.iva];
  const importe = bruto - descuento;
  return {
    producto: producto._id,
    sku: producto.sku,
    nombre: producto.nombre,
    unidad: producto.unidad,
    cantidad,
    listaAplicada: precio.lista,
    precioUnitario: precio.precio,
    tipoIva: producto.iva,
    tasaIva,
    bruto,
    ...(descuentoPorcentaje !== undefined && { descuentoPorcentaje }),
    descuento,
    importe,
    iva: desglosarIva(importe, tasaIva),
    requiereReceta: Boolean(producto.requiereReceta)
  };
}

function totales(partidas) {
  return {
    subtotal: sumar(partidas.map(p => p.bruto)),
    descuento: sumar(partidas.map(p => p.descuento)),
    total: sumar(partidas.map(p => p.importe)),
    iva: sumar(partidas.map(p => p.iva))
  };
}

/**
 * Pagos mixtos. Reglas:
 *   - Lo pagado debe cubrir el total.
 *   - Solo el EFECTIVO puede exceder: el excedente es el cambio, y no puede ser mayor que el efectivo recibido.
 *   - Tarjeta + transferencia no pueden sumar más que el total (no se da cambio de una tarjeta).
 */
function calcularPagos(total, pagos) {
  if (!Array.isArray(pagos) || pagos.length === 0) throw solicitudInvalida('Indica cómo se paga');
  for (const p of pagos) {
    if (!Number.isSafeInteger(p.monto) || p.monto <= 0) throw solicitudInvalida('Cada pago debe ser en centavos enteros mayor que cero');
  }
  const efectivo = sumar(pagos.filter(p => p.metodo === 'efectivo').map(p => p.monto));
  const otros = sumar(pagos.filter(p => p.metodo !== 'efectivo').map(p => p.monto));
  const pagado = efectivo + otros;
  if (pagado < total) throw solicitudInvalida(`Falta por pagar: el total es ${total} y se recibieron ${pagado} (centavos)`);
  if (otros > total) throw solicitudInvalida('Tarjeta y transferencia no pueden exceder el total (no se da cambio de esos pagos)');
  const cambio = pagado - total;
  if (cambio > efectivo) throw solicitudInvalida('El cambio no puede ser mayor que el efectivo recibido');
  return { cambio, efectivoNeto: efectivo - cambio, otros };
}

module.exports = { desglosarIva, calcularPartida, totales, calcularPagos };

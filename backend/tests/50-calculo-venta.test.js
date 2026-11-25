// Cálculo de la venta (sin BD): importes, descuentos, IVA desglosado y pagos mixtos.
const { desglosarIva, calcularPartida, totales, calcularPagos } = require('../services/calculoVenta');

const collar = { _id: 'c', sku: 'COL', nombre: 'Collar', unidad: 'pieza', iva: 'tasa_16' };
const granel = { _id: 'g', sku: 'GRA', nombre: 'Granel', unidad: 'kg', iva: 'tasa_0' };

describe('desglosarIva (precios con IVA incluido)', () => {
  test.each([
    [11600, 1600, 1600],
    [100, 1600, 14], // base 86.2 → 86
    [14900, 1600, 2055], // base 12844.8 → 12845
    [8990, 0, 0]
  ])('importe %p, tasa %p → IVA %p', (importe, tasa, iva) => expect(desglosarIva(importe, tasa)).toBe(iva));
});

describe('calcularPartida', () => {
  const precio = (p, lista = 'publico') => ({ precio: p, lista });

  test('pieza: precio × cantidad, con copia de precio, lista y tasa', () => {
    const r = calcularPartida({ producto: collar, cantidad: 3, precio: precio(34900, 'mayoreo') });
    expect(r).toMatchObject({ bruto: 104700, descuento: 0, importe: 104700, precioUnitario: 34900, listaAplicada: 'mayoreo', tasaIva: 1600, tipoIva: 'tasa_16' });
    expect(r.iva).toBe(104700 - Math.round(104700 / 1.16));
  });

  test('granel: precio por kg × gramos, half-up por partida', () => {
    expect(calcularPartida({ producto: granel, cantidad: 1500, precio: precio(8999) }).importe).toBe(13499); // 134.985 → 134.99
  });

  test('descuento en porcentaje (puntos base) y en monto', () => {
    expect(calcularPartida({ producto: collar, cantidad: 3, precio: precio(34900), descuentoPorcentaje: 1000 })).toMatchObject({ descuento: 10470, importe: 94230, descuentoPorcentaje: 1000 });
    expect(calcularPartida({ producto: collar, cantidad: 1, precio: precio(14900), descuentoMonto: 900 })).toMatchObject({ descuento: 900, importe: 14000 });
    expect(calcularPartida({ producto: collar, cantidad: 1, precio: precio(14900), descuentoPorcentaje: 10000 }).importe).toBe(0);
  });

  test('descuentos inválidos', () => {
    const base = { producto: collar, cantidad: 1, precio: precio(14900) };
    expect(() => calcularPartida({ ...base, descuentoMonto: 15000 })).toThrow(/mayor que el importe/);
    expect(() => calcularPartida({ ...base, descuentoMonto: 100, descuentoPorcentaje: 100 })).toThrow(/no ambos/);
    expect(() => calcularPartida({ ...base, descuentoPorcentaje: 10001 })).toThrow();
    expect(() => calcularPartida({ ...base, descuentoMonto: 1.5 })).toThrow();
    expect(() => calcularPartida({ ...base, cantidad: 0 })).toThrow();
  });

  test('totales suman brutos, descuentos, importes e IVA', () => {
    const ps = [
      calcularPartida({ producto: collar, cantidad: 2, precio: precio(14900), descuentoMonto: 800 }),
      calcularPartida({ producto: granel, cantidad: 750, precio: precio(8990) })
    ];
    expect(totales(ps)).toEqual({ subtotal: 29800 + 6743, descuento: 800, total: 29000 + 6743, iva: desglosarIva(29000, 1600) });
  });
});

describe('calcularPagos', () => {
  test('efectivo exacto o con cambio', () => {
    expect(calcularPagos(34900, [{ metodo: 'efectivo', monto: 34900 }])).toEqual({ cambio: 0, efectivoNeto: 34900, otros: 0 });
    expect(calcularPagos(34900, [{ metodo: 'efectivo', monto: 50000 }])).toEqual({ cambio: 15100, efectivoNeto: 34900, otros: 0 });
  });

  test('pago mixto: el cambio sale del efectivo', () => {
    expect(calcularPagos(34900, [{ metodo: 'tarjeta', monto: 20000 }, { metodo: 'efectivo', monto: 20000 }])).toEqual({ cambio: 5100, efectivoNeto: 14900, otros: 20000 });
    expect(calcularPagos(34900, [{ metodo: 'transferencia', monto: 34900 }]).cambio).toBe(0);
  });

  test('pago insuficiente, tarjeta de más, montos inválidos → error', () => {
    expect(() => calcularPagos(34900, [{ metodo: 'efectivo', monto: 30000 }])).toThrow(/Falta por pagar/);
    expect(() => calcularPagos(34900, [{ metodo: 'tarjeta', monto: 40000 }])).toThrow(/no pueden exceder/);
    expect(() => calcularPagos(34900, [{ metodo: 'tarjeta', monto: 30000 }, { metodo: 'transferencia', monto: 10000 }])).toThrow(/no pueden exceder/);
    expect(() => calcularPagos(100, [{ metodo: 'efectivo', monto: 0 }])).toThrow();
    expect(() => calcularPagos(100, [])).toThrow();
  });
});

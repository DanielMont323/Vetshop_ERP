const d = require('../helpers/dinero');

describe('aCentavos', () => {
  test.each([
    ['1250', 125000],
    ['1,250.50', 125050],
    ['$1,250.5', 125050],
    [' 0.05 ', 5],
    ['-12.30', -1230],
    [1250.5, 125050],
    [1.005 * 1, null], // 1.005 tiene 3 decimales: error, no se redondea en silencio
    [0.1 + 0.2, 30], // 0.30000000000000004 es 0.30 en pesos
    [19.99, 1999],
    [0, 0]
  ])('%p → %p', (entrada, esperado) => {
    if (esperado === null) expect(() => d.aCentavos(entrada)).toThrow();
    else expect(d.aCentavos(entrada)).toBe(esperado);
  });

  test('rechaza texto basura, NaN e Infinity', () => {
    for (const v of ['abc', '1.2.3', '', '12.345', NaN, Infinity, null, undefined, {}]) {
      expect(() => d.aCentavos(v)).toThrow();
    }
  });
});

describe('formatear', () => {
  test.each([
    [125000, '$1,250.00'],
    [5, '$0.05'],
    [0, '$0.00'],
    [-1230, '-$12.30'],
    [123456789, '$1,234,567.89']
  ])('%p → %p', (c, texto) => expect(d.formatear(c)).toBe(texto));

  test('rechaza decimales (no son centavos)', () => {
    expect(() => d.formatear(12.5)).toThrow();
  });

  test('ida y vuelta texto → centavos → texto', () => {
    expect(d.formatear(d.aCentavos('$9,876.54'))).toBe('$9,876.54');
  });
});

describe('dividirRedondeado (half-up entero)', () => {
  test.each([
    [1500, 1000, 2], // 1.5 sube
    [1499, 1000, 1],
    [2500, 1000, 3], // half-up, no "al par"
    [-1500, 1000, -2],
    [0, 7, 0]
  ])('%p / %p → %p', (n, den, r) => expect(d.dividirRedondeado(n, den)).toBe(r));
});

describe('importeGranel: precio por kg × gramos / 1000, half-up por partida', () => {
  test('kilo exacto', () => {
    expect(d.importeGranel(8990, 1000)).toBe(8990); // $89.90/kg × 1 kg
  });
  test('medio kilo con centavo impar sube (half-up)', () => {
    // $89.99/kg × 500 g = 4499.5 centavos → 4500
    expect(d.importeGranel(8999, 500)).toBe(4500);
  });
  test('por debajo de medio centavo baja', () => {
    // $45.00/kg × 333 g = 1498.5 → 1499 ; $45.00 × 111 g = 499.5 → 500 ; $10.00 × 1 g = 1 → 1
    expect(d.importeGranel(4500, 333)).toBe(1499);
    expect(d.importeGranel(4500, 111)).toBe(500);
    expect(d.importeGranel(1000, 1)).toBe(1);
    // $12.34/kg × 3 g = 3.702 centavos → 4
    expect(d.importeGranel(1234, 3)).toBe(4);
    // $12.34/kg × 1 g = 1.234 → 1
    expect(d.importeGranel(1234, 1)).toBe(1);
  });
  test('el redondeo es por partida, no por gramo', () => {
    // 250 g + 250 g en una sola partida de 500 g: 4499.5 → 4500 (no 2 × 2249.75 → 2250 + 2250)
    expect(d.importeGranel(8999, 500)).toBe(4500);
    expect(d.importeGranel(8999, 250)).toBe(2250);
  });
  test('cero gramos o precio cero', () => {
    expect(d.importeGranel(8999, 0)).toBe(0);
    expect(d.importeGranel(0, 750)).toBe(0);
  });
  test('rechaza decimales y negativos', () => {
    expect(() => d.importeGranel(89.99, 500)).toThrow();
    expect(() => d.importeGranel(8999, 0.5)).toThrow();
    expect(() => d.importeGranel(-1, 500)).toThrow();
    expect(() => d.importeGranel(8999, -500)).toThrow();
  });
});

describe('importePartida', () => {
  test('pieza: precio × piezas', () => {
    expect(d.importePartida({ precioUnitario: 34900, cantidad: 3, unidad: 'pieza' })).toBe(104700);
  });
  test('kg: delega en importeGranel (cantidad en gramos)', () => {
    expect(d.importePartida({ precioUnitario: 8999, cantidad: 1500, unidad: 'kg' })).toBe(13499); // 13498.5 → 13499
  });
  test('unidad desconocida', () => {
    expect(() => d.importePartida({ precioUnitario: 100, cantidad: 1, unidad: 'litro' })).toThrow();
  });
});

describe('aplicarTasa y sumar', () => {
  test('IVA 16 % half-up', () => {
    expect(d.aplicarTasa(10000, 1600)).toBe(1600);
    expect(d.aplicarTasa(3, 1600)).toBe(0); // 0.48 → 0
    expect(d.aplicarTasa(4, 1600)).toBe(1); // 0.64 → 1
    expect(d.aplicarTasa(1, 5000)).toBe(1); // 0.5 → 1
  });
  test('sumar exige enteros', () => {
    expect(d.sumar(100, [200, 300])).toBe(600);
    expect(() => d.sumar(100, 0.5)).toThrow();
  });
});

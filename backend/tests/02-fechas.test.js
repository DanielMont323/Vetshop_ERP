const f = require('../helpers/fechas');

describe('rangoDia (Tepic = UTC-7, fin exclusivo)', () => {
  test('por texto AAAA-MM-DD', () => {
    const { inicio, fin } = f.rangoDia('2026-11-24');
    expect(inicio.toISOString()).toBe('2026-11-24T07:00:00.000Z');
    expect(fin.toISOString()).toBe('2026-11-25T07:00:00.000Z');
  });

  test('por instante: las 20:00 de Tepic ya son el día siguiente en UTC, pero cuentan para hoy', () => {
    const { inicio, fin } = f.rangoDia(new Date('2026-11-25T03:00:00Z')); // 24/11 20:00 en Tepic
    expect(inicio.toISOString()).toBe('2026-11-24T07:00:00.000Z');
    expect(fin.toISOString()).toBe('2026-11-25T07:00:00.000Z');
  });

  test('fin de año', () => {
    expect(f.rangoDia('2026-12-31').fin.toISOString()).toBe('2027-01-01T07:00:00.000Z');
  });

  test('rangoDias incluye ambos extremos', () => {
    const { inicio, fin } = f.rangoDias('2026-12-01', '2026-12-31');
    expect(inicio.toISOString()).toBe('2026-12-01T07:00:00.000Z');
    expect(fin.toISOString()).toBe('2027-01-01T07:00:00.000Z');
    expect(() => f.rangoDias('2026-12-31', '2026-12-01')).toThrow();
  });

  test('rechaza fechas imposibles', () => {
    expect(() => f.rangoDia('2026-02-30')).toThrow();
    expect(() => f.rangoDia('2026-13-01')).toThrow();
  });
});

describe('diaLocal y formatearLocal', () => {
  test('el día en Tepic, no el día UTC', () => {
    expect(f.diaLocal(new Date('2026-11-25T06:59:59Z'))).toBe('2026-11-24');
    expect(f.diaLocal(new Date('2026-11-25T07:00:00Z'))).toBe('2026-11-25');
  });
  test('muestra la hora de Tepic', () => {
    expect(f.formatearLocal(new Date('2026-11-25T03:15:00Z'))).toBe('24/11/2026 20:15');
  });
  test('deHoraLocal guarda el instante UTC real (no "hora de Tepic como UTC")', () => {
    expect(f.deHoraLocal(2026, 11, 24, 9, 30).toISOString()).toBe('2026-11-24T16:30:00.000Z');
  });
});

describe('parsearCaducidad', () => {
  test('MM/AAAA → último día del mes, 23:59:59.999 de Tepic, en UTC', () => {
    expect(f.parsearCaducidad('03/2027').toISOString()).toBe('2027-04-01T06:59:59.999Z');
    expect(f.parsearCaducidad('3/2027').toISOString()).toBe('2027-04-01T06:59:59.999Z');
    expect(f.parsearCaducidad('03-2027').toISOString()).toBe('2027-04-01T06:59:59.999Z');
  });

  test('meses de 30 días, febrero y bisiesto', () => {
    expect(f.parsearCaducidad('04/2027').toISOString()).toBe('2027-05-01T06:59:59.999Z'); // 30/04
    expect(f.parsearCaducidad('02/2027').toISOString()).toBe('2027-03-01T06:59:59.999Z'); // 28/02
    expect(f.parsearCaducidad('02/2028').toISOString()).toBe('2028-03-01T06:59:59.999Z'); // 29/02 bisiesto
  });

  test('diciembre cruza al año siguiente en UTC', () => {
    expect(f.parsearCaducidad('12/2026').toISOString()).toBe('2027-01-01T06:59:59.999Z');
  });

  test('el día local de la caducidad es el último del mes', () => {
    expect(f.diaLocal(f.parsearCaducidad('02/2028'))).toBe('2028-02-29');
  });

  test('DD/MM/AAAA y AAAA-MM-DD → fin de ese día', () => {
    expect(f.parsearCaducidad('15/06/2027').toISOString()).toBe('2027-06-16T06:59:59.999Z');
    expect(f.parsearCaducidad('2027-06-15').toISOString()).toBe('2027-06-16T06:59:59.999Z');
  });

  test('rechaza formatos y fechas inválidas', () => {
    for (const t of ['13/2027', '00/2027', '2027', '31/02/2027', '03/27', 'marzo 2027', '', 20270301]) {
      expect(() => f.parsearCaducidad(t)).toThrow();
    }
  });
});

describe('estaCaducado y diasParaCaducar', () => {
  const cad = f.parsearCaducidad('03/2027'); // vence 31/03/2027 23:59:59.999 de Tepic

  test('se puede vender todo el último día; caduca al empezar el día siguiente', () => {
    expect(f.estaCaducado(cad, new Date('2027-04-01T06:59:59.000Z'))).toBe(false); // 31/03 23:59:59
    expect(f.estaCaducado(cad, new Date('2027-04-01T07:00:00.000Z'))).toBe(true); // 01/04 00:00
  });

  test('días de calendario en Tepic', () => {
    expect(f.diasParaCaducar(cad, new Date('2027-03-31T15:00:00Z'))).toBe(0);
    expect(f.diasParaCaducar(cad, new Date('2027-03-01T15:00:00Z'))).toBe(30);
    expect(f.diasParaCaducar(cad, new Date('2027-04-02T15:00:00Z'))).toBe(-2);
  });

  test('sin caducidad nunca caduca', () => {
    expect(f.estaCaducado(null)).toBe(false);
  });
});

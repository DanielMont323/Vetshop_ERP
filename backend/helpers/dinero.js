// Dinero en CENTAVOS ENTEROS (125000 = $1,250.00). Nunca decimales de JS para dinero.
// Cantidades en UNIDAD BASE ENTERA: piezas para 'pieza' y GRAMOS para 'kg'.
// Todo redondeo es half-up (0.5 sube) y se hace con aritmética entera.

const GRAMOS_POR_KG = 1000;
const PUNTOS_BASE = 10000; // 1600 puntos base = 16 %

function esCentavos(valor) {
  return Number.isSafeInteger(valor);
}

function exigirEnteroNoNegativo(valor, nombre) {
  if (!Number.isSafeInteger(valor) || valor < 0) {
    throw new TypeError(`${nombre} debe ser un entero no negativo (recibido: ${valor})`);
  }
}

// numerador / denominador redondeado half-up, con enteros (sin pasar por decimales).
// Para negativos redondea alejándose de cero (-2.5 → -3), simétrico a los positivos.
function dividirRedondeado(numerador, denominador) {
  if (!Number.isSafeInteger(numerador) || !Number.isSafeInteger(denominador) || denominador <= 0) {
    throw new TypeError('dividirRedondeado requiere enteros seguros y denominador positivo');
  }
  const signo = numerador < 0 ? -1 : 1;
  const n = Math.abs(numerador);
  const cociente = Math.floor(n / denominador);
  const residuo = n - cociente * denominador;
  const resultado = residuo * 2 >= denominador ? cociente + 1 : cociente;
  return signo * resultado || 0;
}

// Texto o número en pesos → centavos. Acepta "$1,250.50", "1250.5", "1250", 1250.5.
// Más de 2 decimales es un error (no se redondea dinero capturado en silencio).
function aCentavos(valor) {
  let texto;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) throw new TypeError(`Importe inválido: ${valor}`);
    // toFixed(6) evita la notación científica y los restos binarios (1.005 → "1.005000")
    texto = valor.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  } else if (typeof valor === 'string') {
    texto = valor.trim().replace(/[$\s,]/g, '');
  } else {
    throw new TypeError(`Importe inválido: ${valor}`);
  }
  const m = /^(-)?(\d+)(?:\.(\d{0,2}))?$/.exec(texto);
  if (!m) throw new TypeError(`Importe inválido o con más de 2 decimales: ${valor}`);
  const [, menos, enteros, decimales = ''] = m;
  const centavos = Number(enteros) * 100 + Number(decimales.padEnd(2, '0'));
  if (!Number.isSafeInteger(centavos)) throw new TypeError(`Importe fuera de rango: ${valor}`);
  return menos ? -centavos || 0 : centavos;
}

// Centavos → "$1,250.00" (negativos: "-$1,250.00"). Solo para mostrar.
function formatear(centavos) {
  if (!esCentavos(centavos)) throw new TypeError(`Se esperaban centavos enteros (recibido: ${centavos})`);
  const negativo = centavos < 0;
  const abs = Math.abs(centavos);
  const pesos = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cent = String(abs % 100).padStart(2, '0');
  return `${negativo ? '-' : ''}$${pesos}.${cent}`;
}

// Centavos → número en pesos (1250.5) para exportar a Excel. No usar para cálculos.
function aPesos(centavos) {
  if (!esCentavos(centavos)) throw new TypeError(`Se esperaban centavos enteros (recibido: ${centavos})`);
  return centavos / 100;
}

// Importe de una partida a granel: precio por kg × gramos / 1000, half-up al centavo.
function importeGranel(precioPorKg, gramos) {
  exigirEnteroNoNegativo(precioPorKg, 'precioPorKg');
  exigirEnteroNoNegativo(gramos, 'gramos');
  const producto = precioPorKg * gramos;
  if (!Number.isSafeInteger(producto)) throw new RangeError('Importe a granel fuera de rango');
  return dividirRedondeado(producto, GRAMOS_POR_KG);
}

// Importe de una partida según la unidad del producto.
//   pieza: precioUnitario (por pieza) × cantidad (piezas)
//   kg:    precioUnitario (por kg) × cantidad (gramos) / 1000
function importePartida({ precioUnitario, cantidad, unidad }) {
  if (unidad === 'kg') return importeGranel(precioUnitario, cantidad);
  if (unidad !== 'pieza') throw new TypeError(`Unidad desconocida: ${unidad}`);
  exigirEnteroNoNegativo(precioUnitario, 'precioUnitario');
  exigirEnteroNoNegativo(cantidad, 'cantidad');
  const importe = precioUnitario * cantidad;
  if (!Number.isSafeInteger(importe)) throw new RangeError('Importe fuera de rango');
  return importe;
}

// Centavos × tasa en puntos base (IVA 16 % = 1600), half-up al centavo.
function aplicarTasa(centavos, puntosBase) {
  if (!esCentavos(centavos)) throw new TypeError(`Se esperaban centavos enteros (recibido: ${centavos})`);
  exigirEnteroNoNegativo(puntosBase, 'puntosBase');
  return dividirRedondeado(centavos * puntosBase, PUNTOS_BASE);
}

function sumar(...importes) {
  return importes.flat().reduce((total, c) => {
    if (!esCentavos(c)) throw new TypeError(`Se esperaban centavos enteros (recibido: ${c})`);
    return total + c;
  }, 0);
}

module.exports = {
  GRAMOS_POR_KG, PUNTOS_BASE,
  esCentavos, dividirRedondeado, aCentavos, formatear, aPesos,
  importeGranel, importePartida, aplicarTasa, sumar
};

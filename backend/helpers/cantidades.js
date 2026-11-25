// Cantidades en unidad base entera: piezas, o GRAMOS para productos por kg.

// 2500 g → "2.5" ; 3 piezas → "3". Solo para mensajes y para mostrar.
function baseATexto(cantidad, unidad) {
  if (unidad !== 'kg') return String(cantidad);
  const signo = cantidad < 0 ? '-' : '';
  const abs = Math.abs(cantidad);
  const kg = Math.floor(abs / 1000);
  const g = abs % 1000;
  return `${signo}${kg}${g ? `.${String(g).padStart(3, '0').replace(/0+$/, '')}` : ''}`;
}

module.exports = { baseATexto };

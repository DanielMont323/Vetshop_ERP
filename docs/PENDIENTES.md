# Pendientes conocidos

Cosas detectadas y aceptadas por ahora, para resolver más adelante. Cada una indica dónde está y qué haría falta.

## Seguridad

### El mensaje de cuenta bloqueada revela que el usuario existe
- **Dónde:** `backend/services/auth.js` → `login()`.
- **Qué pasa:** con un usuario inexistente, el login siempre responde 401 «Usuario o contraseña incorrectos». Con uno
  existente, tras 5 intentos fallidos responde **429 «Cuenta bloqueada…»**. Quien pruebe nombres puede distinguir así
  los usuarios reales de los inventados.
- **Riesgo:** bajo (unos 10 usuarios, nombres fáciles de adivinar de todos modos), pero facilita enfocar un ataque.
- **Opciones:**
  1. Responder igual a usuarios inexistentes: llevar también un contador de intentos para nombres que no existen
     (en una colección aparte con TTL) y devolver el mismo 429 tras 5 intentos.
  2. Devolver siempre 401 con el mismo mensaje y avisar del bloqueo solo por otro canal (p. ej. aviso al dueño).
  3. Añadir un límite por IP en la BD (colección con TTL) que se aplique igual a todos los nombres.
- **Decidir antes de:** salir a producción en todas las sucursales (enero).

## Compras

### Devolución o cancelación de una compra ya recibida
- **Qué pasa:** una compra recibida no se puede cancelar. Si se capturó mal, hoy hay que corregir con ajustes de
  inventario (con PIN del dueño).
- **Opciones:** permitir cancelarla con autorización del dueño solo si sus capas no se han tocado (revertir entradas),
  o registrar una "devolución a proveedor" como salida dirigida a esas capas.
- **Decidir antes de:** el arranque en enero.

## Ventas

### Devoluciones parciales
- **Qué pasa:** hoy una venta solo se cancela completa. Si el cliente regresa una pieza de tres, hay que cancelar y
  volver a cobrar.
- **Opción:** devolución parcial con autorización (movimiento contrario de esas partidas y nota de crédito/reembolso).

### Cancelar una venta de un turno ya cerrado
- **Qué pasa:** la cancelación no revisa el turno (los turnos llegan en el Paso 7). Cancelar una venta de un corte ya
  cerrado alteraría ese corte.
- **Qué hacer en el Paso 7:** decidir si se permite (con registro en el turno actual) o se bloquea.

## Resueltos

- **Cambiar la unidad de un producto con existencias** (Paso 3): `productos.actualizar()` responde 409
  `UNIDAD_CON_INVENTARIO` si el producto tiene capas en cualquier sucursal.

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

## Catálogo

### Cambiar la unidad de un producto con existencias
- **Dónde:** `backend/services/productos.js` → `actualizar()`.
- **Qué pasa:** hoy se puede cambiar `unidad` de `pieza` a `kg` (o al revés) libremente. Cuando haya capas de
  inventario (Paso 3), sus cantidades quedarían en la unidad equivocada (piezas leídas como gramos).
- **Qué hacer en el Paso 3:** rechazar el cambio de unidad si el producto tiene capas o movimientos (409).

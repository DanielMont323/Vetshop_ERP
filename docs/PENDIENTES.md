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

### Tolerancia en el corte
- **Qué pasa:** cualquier diferencia, aunque sea de $0.50, exige justificación y PIN del dueño para cerrar el turno.
- **Opción:** si en la práctica resulta pesado, definir una tolerancia (p. ej. ±$5) que cierre sin autorización pero
  quede registrada.

## Recetas

### Almacenamiento de archivos en producción
- **Qué pasa:** el driver `vercel_blob` de `services/almacenamiento.js` aún no está implementado. En Vercel el disco
  no es persistente, así que en producción hay que configurarlo antes de capturar recetas con archivo.
- **Qué hacer:** crear un almacén Blob en Vercel (privado), poner `BLOB_READ_WRITE_TOKEN` y `ALMACENAMIENTO=vercel_blob`,
  e implementar `guardar`/`leer` con `@vercel/blob`. (Alternativa: Cloudinary con acceso autenticado.)
- **Decidir antes de:** el piloto de diciembre.

### Vigencia de las recetas
- **Qué pasa:** una receta validada se puede surtir sin límite de tiempo.
- **Opción:** fijar una vigencia (p. ej. 30 días desde la fecha de la receta, o la que marque la norma para
  controlados) y rechazar el surtido después.

## Resueltos

- **Cambiar la unidad de un producto con existencias** (Paso 3): `productos.actualizar()` responde 409
  `UNIDAD_CON_INVENTARIO` si el producto tiene capas en cualquier sucursal.
- **Cancelar una venta de un turno ya cerrado** (Paso 7): se permite con PIN del dueño; el dinero sale del turno
  abierto de quien cancela (`cancelacion.turno`) y el corte cerrado no cambia. Si el turno de la venta está en corte,
  no se puede cancelar hasta cerrarlo.

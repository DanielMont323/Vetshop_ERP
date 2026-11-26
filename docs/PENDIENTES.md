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

### Vigencia de las recetas
- **Qué pasa:** una receta validada se puede surtir sin límite de tiempo.
- **Opción:** fijar una vigencia (p. ej. 30 días desde la fecha de la receta, o la que marque la norma para
  controlados) y rechazar el surtido después.

## Facturación (CFDI)

### Timbrar de verdad con Facturapi
- **Qué pasa:** hoy se timbra con el PAC **simulado** (UUID y XML de prueba, sin validez fiscal). El adaptador de
  Facturapi (`services/pac/facturapi.js`) está escrito con su documentación pública pero **no se ha probado** contra
  el servicio.
- **Qué hacer:** crear la cuenta de Facturapi y la organización de Huellitas, poner `FACTURACION_PAC=facturapi` y la
  clave de **pruebas** (`sk_test_…`) en `FACTURAPI_KEY`, y probar: factura a cliente, global, nota de crédito,
  complemento de pago, cancelación y descarga del PDF. Después cargar el CSD real y cambiar a la clave de producción.
- **Decidir antes de:** facturar en enero.

### Envío por correo y complementos automáticos
- **Qué pasa:** la factura no se envía por correo (el cliente la descarga o se le comparte el archivo). El complemento
  de pago de una factura PPD se emite a mano desde la factura cuando el cliente paga (no se genera solo al registrar
  el abono en Cobranza).
- **Opciones:** con Facturapi, su envío por correo; ligar el abono de Cobranza con la factura PPD para proponer el
  complemento automáticamente.

### Claves SAT de los productos
- **Qué pasa:** los productos sin clave SAT se facturan con `01010101` («No existe en el catálogo»), que el SAT
  acepta pero no es lo recomendable. Conviene capturar la clave de cada producto (se puede hacer con la importación).

## Resueltos

- **Almacenamiento de archivos en producción** (recetas y XML de facturas): driver `vercel_blob` con acceso privado;
  almacén `vetshop-archivos` conectado al proyecto `vetshop-api` (`BLOB_READ_WRITE_TOKEN`, `ALMACENAMIENTO=vercel_blob`).

- **Cambiar la unidad de un producto con existencias** (Paso 3): `productos.actualizar()` responde 409
  `UNIDAD_CON_INVENTARIO` si el producto tiene capas en cualquier sucursal.
- **Cancelar una venta de un turno ya cerrado** (Paso 7): se permite con PIN del dueño; el dinero sale del turno
  abierto de quien cancela (`cancelacion.turno`) y el corte cerrado no cambia. Si el turno de la venta está en corte,
  no se puede cancelar hasta cerrarlo.

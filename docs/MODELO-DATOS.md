# Modelo de datos y decisiones (Fase 1)

Aprobado por Ulises antes del Paso 0. Complementa `CLAUDE.md` y `docs/PLAN-FASE-1.md`.

## Unidades

- **Dinero:** centavos enteros (`125000` = $1,250.00). Helpers en `backend/helpers/dinero.js`.
- **Cantidades:** enteros en unidad base: **piezas** para productos `pieza` y **gramos** para productos `kg`.
  Precio y costo van por pieza o **por kg**.
- **Importe a granel:** `precio por kg × gramos / 1000`, redondeado half-up al centavo **por partida** (`importeGranel`).
- **Fechas:** instantes UTC reales. `America/Mazatlan` solo para mostrar y calcular rangos (`backend/helpers/fechas.js`).
- **Caducidad:** fin del día (23:59:59.999 de Tepic) de la fecha capturada; `MM/AAAA` = último día del mes.
  Un lote está caducado cuando el instante actual es posterior a su caducidad.

## Colecciones

Globales (sin `sucursal`): `Sucursal`, `Usuario`, `Auditoria` (con `sucursal` opcional), `Producto`, `ListaPrecios`,
`Proveedor`, `Cliente`.

Por sucursal (`sucursal` obligatorio, con el plugin `alcanceSucursal`): `InventoryLayer`, `InventoryMovement`,
`Compra`, `Venta`, `Contador`, `Receta`, `Turno`. `Traspaso` usa `origen` y `destino`.

Ya implementadas (Paso 1): `Sucursal`, `Usuario`, `Auditoria`.

| Colección | Campos clave | Índices |
|---|---|---|
| `Sucursal` | nombre, tipo (`tienda`/`almacen`), activa | `nombre` único (sin distinguir mayúsculas ni acentos) |
| `Usuario` | nombre, usuario, passwordHash, rol, sucursales[], pinHash, activo, intentosFallidos, bloqueadoHasta, intentosPinFallidos, pinBloqueadoHasta, versionToken | `usuario` único |
| `Auditoria` | usuario, autorizadoPor, accion, entidad, entidadId, sucursal?, antes, despues, motivo, fecha | `{entidad, entidadId, fecha}`, `{sucursal, fecha}`, `{accion, fecha}` |

Paso 2 (catálogo):

| Colección | Campos clave | Índices |
|---|---|---|
| `Producto` | sku (mayúsculas), codigoBarras?, nombre, nombreBusqueda (sin acentos), categoria, unidad, presentacion, requiereReceta, esControlado, requiereRefrigeracion, iva, activo, minimos[{sucursal, cantidad}] | `sku` único, `codigoBarras` único (solo si existe), `nombreBusqueda`, `{categoria, activo}` |
| `ListaPrecios` | clave (`publico`, `mayoreo`, `clinica`, `empleado`), nombre, precios[{producto, precio}] | `clave` única, `precios.producto` |

Decisiones del Paso 2:
- **Precios finales con IVA incluido** (lo que paga el cliente). El desglose de IVA se calcula al facturar.
- `iva`: `tasa_16`, `tasa_0` o `exento` (CFDI distingue tasa 0 de exento).
- `categoria`: `medicamento`, `biologico`, `alimento`, `accesorio`, `higiene`, `otro`.
- `esControlado` implica `requiereReceta`.
- Si un producto no tiene precio en la lista del cliente se cobra el de **público** (`resolverPrecio` devuelve la
  lista aplicada para copiarla en la partida). Sin precio de público no se puede vender.
- Los productos no se borran: se desactivan.
- Búsqueda: código de barras o SKU exactos, o cada palabra contenida en el nombre sin acentos (regex escapado).
  Se eligió esto en lugar de un índice de texto porque el índice de texto no encuentra palabras parciales («croq»).
- Cada alta, cambio de producto y cambio de precio queda en la bitácora con antes y después.

Paso 3 (inventario por lotes):

| Colección | Campos clave | Índices |
|---|---|---|
| `InventoryLayer` | producto, sucursal, lote?, caducidad?, ordenFefo, cantidadInicial, cantidadRestante, costoUnitario, origen, referencia {modelo, id}, fechaEntrada, agotada, usuario | `{sucursal, producto, agotada, ordenFefo, _id}` (FEFO), `{sucursal, agotada, caducidad}`, `referencia.id` |
| `InventoryMovement` | producto, sucursal, tipo, cantidad (con signo), capas[{capa, lote, caducidad, cantidad, costoUnitario, costo}], costoTotal, referencia {modelo, id, partida}, movimientoOriginal?, motivo?, nota?, autorizadoPor?, usuario, fecha | `{sucursal, producto, fecha}`, `{sucursal, tipo, fecha}`, `referencia.id`, `movimientoOriginal` único |

Decisiones del Paso 3:
- **FEFO:** se consume primero la capa con menor `ordenFefo` (= caducidad; las capas sin caducidad, al final;
  empate por `_id`). Nunca se consumen capas caducadas en ventas o traspasos.
- **Caducado** = el instante actual ya pasó la caducidad (fin del día en Tepic). **Por caducar** = caduca dentro de
  los próximos 30 días (en días de calendario de Tepic). **Existencia** = solo lo vendible (sin caducados).
- **Bajo mínimo** = existencia vendible < mínimo de esa sucursal. Los productos sin capas pero con mínimo aparecen
  con existencia 0.
- Lote obligatorio en medicamentos y biológicos; caducidad obligatoria en medicamentos, biológicos y alimento.
- No se recibe mercancía ya caducada; solo el **inventario inicial** puede registrarla (para darla de baja después).
- Las operaciones validan la existencia de **todos** los productos antes de descontar; si uno no alcanza, no se
  descuenta nada (409 `EXISTENCIA_INSUFICIENTE` con disponible, solicitado y caducado).
- Descuento de cada capa atómico (`cantidadRestante ≥ q` en el filtro) dentro de la transacción.
- Costo de una porción = `importePartida(costoUnitario, cantidad, unidad)` (half-up por capa en granel).
- **Ajustes:** siempre con usuario y PIN del dueño (aunque quien ajuste sea el dueño). Entrada: crea capa con lote,
  caducidad y costo. Salida: FEFO sobre lo vigente o de una capa concreta (puede estar caducada: así se da de baja).
  Pedir entrada exige `inventario:entradas`; salida, `inventario:salidas`. Quedan en bitácora con `autorizadoPor`.
- Costos visibles solo para quien tiene `inventario:entradas` (almacén y dueño).
- Reversión: devuelve a las capas exactas; el índice único de `movimientoOriginal` impide revertir dos veces.

Paso 4 (recepción de mercancía):

| Colección | Campos clave | Índices |
|---|---|---|
| `Proveedor` | nombre, rfc?, contacto, telefono, email, diasCredito, activo | `nombre` único (sin mayúsculas ni acentos), `rfc` único (si existe) |
| `Compra` | sucursal, proveedor, proveedorNombre, folioFactura, fechaFactura, condicionPago, diasCredito, vencimiento?, partidas[{producto, sku, nombre, unidad, tasaIva, cantidad, costoUnitario, importe, iva, lote?, caducidad?, temperaturaLlegada?, fueraDeRango, capa?}], subtotal, iva, total, estado, vigente, observaciones, usuario, recibidoPor, fechaRecepcion | `{sucursal, estado, fechaFactura}`, `{sucursal, proveedor, fechaFactura}`, `{proveedor, folioFactura}` único si `vigente` |

Decisiones del Paso 4:
- Flujo: **borrador** (editable con PUT) → **recibida** (al confirmar; ya no cambia) | **cancelada** (solo desde borrador).
- **Costo de compra sin IVA** (como viene en la factura). El IVA se calcula por partida con la tasa del producto
  (half-up) y se guarda la tasa en la partida. Las capas guardan el costo sin IVA.
- Confirmar es atómico: el cambio de estado borrador → recibida va en el filtro de la actualización, así que dos
  confirmaciones simultáneas no crean capas dos veces; si una partida falla no se crea ninguna capa.
- La regla de lote y caducidad por categoría se valida al guardar el borrador y de nuevo al confirmar.
- **Cadena de frío:** la temperatura de llegada es opcional; si el producto requiere refrigeración y llegó fuera de
  2–8 °C, la partida queda marcada `fueraDeRango` (no se bloquea la recepción).
- **Vencimiento** (solo a crédito) = fecha de factura + días de crédito (los del proveedor salvo que se indiquen),
  fin del día en Tepic. Se usará en las cuentas por pagar de la Fase 2.
- La misma factura (proveedor + folio) no se registra dos veces en ninguna sucursal mientras esté vigente; cancelar
  un borrador libera el folio.
- Proveedores y recepciones: permiso `recepcion:registrar` (almacén y dueño).

Paso 5 (punto de venta), primera entrega — API:

| Colección | Campos clave | Índices |
|---|---|---|
| `Cliente` | nombre, tipo, listaPrecios, rfc?, telefono, email, esPublicoGeneral, activo | `nombre`, `rfc` único (si existe), `esPublicoGeneral` único (si true) |
| `Contador` | sucursal, serie, ultimo | `{sucursal, serie}` único |
| `Venta` | sucursal, serie, folio, caja, turno (Paso 7), cajero(+nombre), cliente(+nombre), listaPrecios, partidas[{producto, sku, nombre, unidad, cantidad, listaAplicada, precioUnitario, tipoIva, tasaIva, bruto, descuentoPorcentaje?, descuento, importe, iva, costo, lotes[], requiereReceta}], subtotal, descuento, total, iva, costo, pagos[{metodo, monto, referencia?}], cambio, autorizacionDescuento?, estado, cancelacion{usuario, autorizadoPor, motivo, fecha}, claveOperacion, fecha | `{sucursal, serie, folio}` único, `{sucursal, claveOperacion}` único, `{sucursal, fecha}`, `{sucursal, cajero, fecha}`, `{sucursal, turno}` |
| `VentaEnEspera` | sucursal, cajero, cliente?, nota, partidas[{producto, cantidad, descuento?}] | `{sucursal, createdAt}` |

Decisiones del Paso 5:
- **El precio lo decide el servidor** con la lista del cliente (`resolverPrecio`, respaldo en público). La caja solo
  manda producto, cantidad y descuento. Sin precio → 409 `SIN_PRECIO`.
- Sin cliente → **"Público en general"** (cliente especial, único, siempre activo, lista público).
- **Descuentos:** por partida, en porcentaje (puntos base) o monto. Cualquier descuento > 0 requiere usuario y PIN
  del dueño (no hay promociones todavía); se guarda `autorizacionDescuento` y queda en bitácora.
- **IVA desglosado** del importe con IVA incluido: `iva = importe − round(importe / (1 + tasa))`, por partida.
- **Pagos:** efectivo, tarjeta, transferencia. Lo pagado cubre el total; solo el efectivo puede exceder (el
  excedente es el cambio); tarjeta + transferencia nunca exceden el total.
- **Folio** por sucursal y serie `V`, tomado dentro de la transacción: si la venta falla no queda hueco.
- **Idempotencia:** la caja manda `claveOperacion` (UUID); un reintento con la misma clave devuelve la venta ya
  cobrada (200, `repetida: true`) en lugar de cobrar otra vez.
- Productos con receta: **bloqueados** (409 `RECETA_REQUERIDA`) hasta el Paso 6.
- **Venta inmutable:** no hay PUT ni DELETE; el modelo rechaza cualquier actualización que no sea la de cancelación.
- **Cancelación:** usuario y PIN del dueño (`autorizar:cancelacion`) y motivo; regresa la mercancía a los lotes
  exactos (`revertirSalidas`) y queda en bitácora.
- **Consulta:** el cajero ve solo sus ventas del día; el dueño todas, con costo y margen.
- **Ticket:** `GET /api/ventas/:id/ticket?ancho=58|80` devuelve HTML para impresora térmica; todo el texto se escapa.
- Clientes: los consultan los 4 roles (`catalogo:ver`); crearlos o cambiarles la lista de precios es del dueño
  (`clientes:gestionar`).

Pasos siguientes (diseño acordado): ver la tabla del plan. Ajustes ya decididos:
- `Venta.partidas[]` guarda copia de precio unitario, lista de precios, tasa de IVA y descuento.
- `Receta.partidas[]`: producto, cantidad prescrita, cantidad entregada, lote.
- Sin existencias negativas en Fase 1: la venta se bloquea con mensaje claro.
- `InventoryLayer` / `InventoryMovement` conservan esos nombres; sus campos van en español.

## Alcance por sucursal (tres capas)

1. **Middleware `scopeSucursal`** (`backend/middleware/scopeSucursal.js`), en todas las rutas operativas
   (`app.js` → `RUTAS_OPERATIVAS`). Deja `req.alcance = { sucursalActiva, permitidas, esDueno }`.
   - `X-Sucursal` debe ser un id válido (400), existir (404) y estar entre las sucursales del usuario (403).
   - **Toda escritura exige `X-Sucursal` explícito, también para el dueño** (sin él → 400). No se escribe en una
     sucursal desactivada (403).
   - Lectura sin encabezado: el dueño ve todas; con una sola sucursal, esa; con varias, todas las suyas.
   - Las rutas de catálogos globales (`/api/usuarios`, `/api/sucursales`) no pasan por `scopeSucursal`.
2. **Servicios**: construyen todo filtro con `conAlcance` / `conAlcanceMultiple` / `matchAlcance` y escriben
   con `sucursalDeEscritura(alcance)` (`backend/helpers/alcance.js`). Una `sucursal` que venga en el cuerpo se ignora.
3. **Plugin `alcanceSucursal`** (`backend/models/plugins/alcanceSucursal.js`): lanza error si una consulta llega
   sin filtro de sucursal: find, findOne, count, distinct, update, replace y delete. En `aggregate` exige que la
   primera etapa sea un `$match` con sucursal. Reconoce `origen`/`destino` en Traspaso. Para scripts hay un
   escape explícito: `.setOptions({ sinAlcance: true })` o `.option({ sinAlcance: true })` en aggregate.

## Sesión y autorizaciones

- JWT de 12 h con `versionToken`: cambiar o restablecer la contraseña, desactivar al usuario o cambiarle el rol
  invalida todas sus sesiones.
- Login: 5 intentos fallidos bloquean 15 min (contador en la BD, incremento atómico).
- PIN de autorización (dueño y médico responsable): 4 a 6 dígitos con bcrypt y bloqueo propio (5 intentos, 15 min).
  `services/autorizaciones.verificarPin({ usuario, pin, permiso, sucursal })`.
- Debe quedar siempre al menos un dueño activo.

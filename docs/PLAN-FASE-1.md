# Plan Fase 1 — Piloto en una sucursal (diciembre)

Objetivo: operar una sucursal piloto en diciembre con caja, inventario por lotes, recetas, corte de caja y reportes básicos; arrancar en todas las sucursales en enero con el inventario de cierre de año.

Trabaja en este orden. Al terminar cada paso: pruebas verdes, resumen de cambios y espera la revisión de Ulises antes del siguiente.

## Paso 0 — Base del proyecto
- Repo con `backend/` y `frontend/` (Vite), `.gitignore` correcto, `.env.example` en ambos.
- Conexión a Mongo reutilizable en serverless (cachear la conexión; sin `process.exit`).
- Middleware de errores, encabezados de seguridad, CORS por variable de entorno.
- Jest + Supertest con Mongo en memoria (`mongodb-memory-server` con réplica para transacciones).
- Helpers: `dinero.js` (centavos ↔ texto), `fechas.js` (UTC ↔ America/Mazatlan, rangos de día).

## Paso 1 — Sucursales, usuarios y permisos
- Modelos `Sucursal` (nombre, tipo: tienda | almacen, activa) y `Usuario` (nombre, usuario, password hash, rol, sucursales[], PIN de autorización para dueño y médico responsable, intentos fallidos, bloqueadoHasta).
- Login, cambio de contraseña, sesión invalidada al cambiar contraseña.
- `permisos.js` con la matriz:
  - cajero: vender, ver sus ventas del día, ver existencias, capturar conteo de corte.
  - almacen: entradas/salidas, recepción, traspasos, conteo físico.
  - medico_responsable: validar recetas, ver existencias.
  - dueno: todo, incluidas autorizaciones (descuentos, cancelaciones, ajustes, cambio de forma de pago, diferencias de corte).
- `scopeSucursal` aplicado a todas las rutas operativas. Pruebas: un cajero de la sucursal A no puede leer ni escribir datos de la B.

## Paso 2 — Catálogo y precios
- `Producto`: sku, codigoBarras, nombre, categoría, unidad (pieza | kg), presentación, requiereReceta, esControlado, requiereRefrigeracion, iva, activo, mínimo por sucursal.
- `ListaPrecios` (publico, mayoreo, clinica, empleado) con precio por producto en centavos.
- CRUD con búsqueda por nombre, SKU o código de barras.

## Paso 3 — Inventario por lotes (FEFO)
- Adaptar `InventoryLayer` (producto, sucursal, lote, caducidad, cantidad, costoUnitario) e `InventoryMovement` (tipo: entrada | venta | cancelacion | traspaso_salida | traspaso_entrada | ajuste, referencia, usuario).
- Servicio de consumo FEFO (por caducidad) con transacción; nunca consumir lotes caducados; reversión para cancelaciones.
- Consulta de existencias por sucursal / producto / lote con estado: vigente, por caducar (≤30 días), caducado, bajo mínimo.
- Ajustes de inventario solo con autorización del dueño.
- Cantidades en unidad base entera: piezas para `pieza`, **gramos** para `kg` (ver `docs/MODELO-DATOS.md`).
- Caducidad: se acepta `MM/AAAA` y se guarda como el último día de ese mes, fin del día en `America/Mazatlan`, en UTC (`parsearCaducidad` en `helpers/fechas.js`). También `DD/MM/AAAA` y `AAAA-MM-DD`.
- Sin existencia suficiente la operación se bloquea con un mensaje claro. **No hay existencias negativas en Fase 1.**

## Paso 4 — Recepción de mercancía
- `Proveedor` y `Compra` (proveedor, folioFactura, fecha, sucursal que recibe, condición de pago, partidas con lote, caducidad, costo, temperatura de llegada opcional).
- Al confirmar: crea capas y movimientos de entrada en una transacción. (La cuenta por pagar se agrega en Fase 2; deja el campo de vencimiento guardado.)

## Paso 5 — Punto de venta
- `Cliente` (público en general por defecto; tipo; lista de precios).
- `Venta`: folio por sucursal, sucursal, caja, turno, cajero, cliente, partidas (producto, cantidad, precio, descuento, lotes consumidos con costo), pagos[] (método, monto), totales en centavos, estado (cobrada | cancelada).
- Cada partida guarda una **copia** de: precio unitario, lista de precios aplicada, tasa de IVA y descuento (si después cambia el catálogo, la venta no cambia).
- Importe de partida a granel = precio por kg × gramos / 1000, redondeado al centavo por partida (half-up): `importeGranel` en `helpers/dinero.js`.
- Sin existencia suficiente la venta se bloquea con mensaje claro (qué producto, cuánto hay, cuánto se pidió).
- Precio según lista del cliente. Descuento fuera de promoción requiere PIN del dueño.
- Productos con `requiereReceta`: no se puede cobrar sin `Receta` validada (ver Paso 6).
- Pagos mixtos; cambio calculado en efectivo.
- Venta en espera (guardada sin consumir inventario).
- Cancelación con autorización → movimientos de reversa.
- Ticket imprimible (HTML para impresora térmica de 58/80 mm; sin html2canvas).
- Pantalla de caja optimizada para teclado y lector de código de barras (atajos F2 buscar, F12 cobrar).

## Paso 6 — Recetas
- `Receta`: folio, fecha, médico que prescribe, cédula, propietario, paciente (nombre, especie), **partidas[]** (producto, cantidad prescrita, cantidad entregada, lote entregado), archivo (foto/escaneo), validadaPor (médico responsable), venta. Una receta puede incluir varios medicamentos.
- Validación con PIN del médico responsable. Cantidad entregada ≤ prescrita, por partida.
- Historial filtrable de recetas surtidas.
- Archivos: guardar en almacenamiento externo (Vercel Blob o Cloudinary), no en Mongo.

## Paso 7 — Turnos y corte de caja
- `Turno`: sucursal, caja, cajero, apertura (fondo inicial), cierre.
- Corte ciego: el cajero captura conteo por denominación sin ver lo esperado.
- Comparación por forma de pago: esperado (ventas + fondo − retiros) vs contado; tarjeta vs total de la terminal capturado.
- Diferencia ≠ 0 → justificación obligatoria + autorización del dueño para cerrar.
- Cambio de forma de pago de una venta: solo dueño, con bitácora.
- Impresión del corte.

## Paso 8 — Traspasos
- `Traspaso`: origen, destino, partidas con lote, estado (en_transito | recibido | recibido_con_diferencia), envió, recibió, observaciones.
- Salida descuenta del origen al enviar; entrada suma al destino al confirmar lo recibido; diferencias quedan registradas para autorización.

## Paso 9 — Dashboard y reportes básicos
- Dashboard: ventas del día, tickets, ticket promedio, margen (costo por lotes consumidos), ventas 7 días, alertas (caducados, por caducar, bajo mínimo, cortes con diferencia).
- Reportes: ventas por día/semana/mes/año, por sucursal, por cajero/vendedor, por forma de pago, público vs distribución, producto más vendido. Exportar a Excel (exceljs).

## Paso 10 — Migración y arranque
- Script de importación desde Excel/CSV: catálogo, precios, existencias con lote y caducidad, clientes y saldos.
- Seed de datos de prueba para la demo.
- Checklist de puesta en marcha del piloto.

## Fase 2 (enero, no empezar todavía)
Clientes y crédito (estado de cuenta, bonificación por pronto pago a 8 días), cuentas por pagar, facturación CFDI 4.0 con PAC (factura global y autofactura), conteo físico semanal, compras sugeridas, bitácora de cadena de frío, metas de vendedores, modo sin conexión de la caja.

**Nota para el modo sin conexión:** en Fase 1 el folio de venta es por sucursal (`Contador` con `{sucursal, serie}`), asignado por el servidor dentro de la transacción. Con cajas que venden sin conexión, el servidor ya no puede dar el siguiente folio en el momento: **los folios tendrán que ser por caja** (serie propia de cada caja, p. ej. `CEN-1-000123`) para que dos cajas desconectadas nunca generen el mismo folio. Diseñar `Venta.folio` y `Contador` para que agregar la caja a la serie no exija migrar ventas ya emitidas.

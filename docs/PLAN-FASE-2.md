# Plan Fase 2 — Módulos que faltan

Objetivo: completar los 14 módulos antes de empezar las pruebas con usuarios de prueba. Mismas reglas que la Fase 1
(`CLAUDE.md`): centavos enteros, fechas en UTC, inventario por movimientos, transacciones, bitácora, filtro de
sucursal en el servidor, lógica en `services/`, cada endpoint con su prueba. **Una rama y un PR por paso.**

Fuera de esta fase (se deja para después): **modo sin conexión de la caja** (no está en la lista de módulos; la nota
de folios por caja de `PLAN-FASE-1.md` sigue vigente).

## Paso 11 — Clientes y crédito
- `Cliente` gana: `credito: { activo, limite (centavos), dias (30 por defecto), bonificacionProntoPago (puntos base),
  diasProntoPago (8 por defecto) }`. Solo el dueño lo configura.
- En la caja, nueva forma de pago **crédito** (solo para clientes con crédito activo). Se bloquea si el saldo + la
  venta pasa el límite o si el cliente tiene facturas vencidas (el dueño puede autorizar con PIN).
- `CuentaCliente` (cargo por cada venta a crédito: venta, importe, vencimiento, saldo) y `AbonoCliente`
  (fecha, monto, forma de pago, cargos que liquida, turno). Un abono en efectivo entra al **corte** del turno que lo cobra.
- Bonificación por pronto pago: si el cargo se liquida completo dentro de los 8 días, el abono aplica la
  bonificación (queda como nota de crédito interna, registrada en bitácora).
- Cancelar una venta a crédito cancela su cargo (si no tiene abonos; si tiene, primero se revierte el abono con PIN).
- Pantallas: **Clientes** (alta/edición con crédito), **Estado de cuenta** (cargos, abonos, saldo, vencido, imprimible),
  **Cobranza** (cuentas por cobrar por antigüedad: al corriente, 1–30, 31–60, +60 días).
- Reportes: cartera por cliente y vencimientos; ventas a crédito en el Excel.

## Paso 12 — Cuentas por pagar
- Cada compra recibida a **crédito** genera una `CuentaPorPagar` (proveedor, factura, total, vencimiento, saldo).
  Las de contado se registran ya pagadas.
- `PagoProveedor`: fecha, monto, forma (transferencia, efectivo, cheque), referencia, facturas que liquida (abonos
  parciales permitidos). Solo dueño.
- Pantalla **Cuentas por pagar**: por vencer (7 días), vencidas, por proveedor, historial de pagos.
- Alerta en el tablero: facturas que vencen esta semana. Exportar a Excel para el contador.

## Paso 13 — Conteo físico
- `ConteoFisico` por sucursal: total o por categoría/ubicación, estado `en_captura → en_revision → aplicado | cancelado`.
- Al iniciar se toma la **foto** de existencias por producto y lote; captura **ciega** (con lector de código de barras),
  varias personas a la vez. Lo que se vende durante el conteo se toma en cuenta para no marcar diferencias falsas.
- Revisión: diferencias por producto/lote con su valor a costo. Recontar renglones.
- Aplicar: el dueño autoriza con PIN y se generan los ajustes de entrada/salida (movimientos `conteo_fisico`) en una
  transacción. Mientras haya un conteo abierto, los ajustes manuales de esa sucursal se bloquean.
- Programación semanal: aviso en el tablero si una sucursal lleva más de 7 días sin conteo.
- Reporte: historial de conteos, merma por sucursal.

## Paso 14 — Cadena de frío
- `EquipoFrio` por sucursal (refrigerador, nombre, rango permitido; 2–8 °C por defecto).
- `LecturaTemperatura`: equipo, fecha, °C, usuario, observación. Al menos 2 lecturas al día por equipo (apertura y
  cierre, configurable).
- Lectura fuera de rango → obligatoria la **acción correctiva** (qué se hizo, productos afectados); si hay producto
  dañado se da de baja con ajuste «Cadena de frío».
- Alertas en el tablero: lecturas fuera de rango y lecturas faltantes del día.
- Bitácora imprimible por equipo y mes (formato para inspección sanitaria), y en Excel.
- La temperatura de llegada en la recepción (ya existe) aparece en la misma bitácora.

## Paso 15 — Compras sugeridas
- `Producto` gana `minimo` y `maximo` por sucursal (o un cálculo automático si no se definen).
- Sugerido por sucursal: venta diaria promedio (últimos 30/60/90 días, elegible) × días de cobertura
  − existencias vendibles − en tránsito (traspasos y compras en borrador), redondeado a la presentación de compra.
- Agrupado por proveedor habitual (último proveedor que lo surtió). Considera lotes por caducar.
- Botón **Crear borrador de compra** con lo sugerido (se edita antes de recibir) o **sugerir traspaso** desde el almacén
  si ahí hay existencia.

## Paso 16 — Metas
- `Meta`: periodo (mes), sucursal y, opcional, vendedor; monto en centavos (y opcional número de tickets).
- El dueño las define en **Reportes → Metas**.
- Avance en el tablero y en reportes: vendido vs meta, porcentaje, proyección al cierre del mes, ranking de vendedores.
- La venta se atribuye al cajero que cobró (y se puede elegir vendedor en la caja si es distinto).

## Paso 17 — Facturación CFDI 4.0
- Con un **PAC** por API (propuesta: **Facturapi**, que tiene modo de pruebas sin costo; alternativas: Facturama,
  SW Sapien). El código queda detrás de un adaptador (`services/pac/`) para poder cambiar de proveedor.
- Datos fiscales: emisor (RFC, régimen, CP, CSD cargado en el PAC), clientes (RFC, razón social, régimen, CP, uso CFDI),
  productos (clave SAT de producto y de unidad, objeto de impuesto).
- **Factura a cliente** desde una o varias ventas (PUE si se pagó; PPD + complemento de pago para crédito).
- **Factura global** de público en general (diaria/semanal/mensual) con las ventas no facturadas del periodo.
- **Autofactura**: página pública donde el cliente captura folio del ticket + total + sus datos fiscales (con límite de
  intentos), dentro del mes de la venta.
- Cancelación de CFDI con motivo del SAT; notas de crédito (egreso) para devoluciones y bonificaciones.
- XML y PDF guardados en almacenamiento externo; envío por correo.
- Una venta facturada no entra en la global; cancelar una venta facturada exige cancelar antes su CFDI.
- **Todo en modo de pruebas del PAC** hasta tener el CSD real de Huellitas.

## Paso 18 — Cierre y preparación de pruebas con usuarios
- Datos de demostración ampliados para todos los módulos (clientes con crédito y saldos, cuentas por pagar,
  refrigeradores con lecturas, un conteo, metas, facturas de prueba).
- Recargar la base `vetshop-pruebas` con esos datos.
- Guion de pruebas por rol (cajero, almacén, médico, dueño) para las pruebas con usuarios.
- Revisión de permisos de cada pantalla nueva y de los pendientes de `docs/PENDIENTES.md`.

## Permisos nuevos (se agregan en cada paso)
`credito:vender`, `cobranza:registrar_abono`, `autorizar:credito_excedido`, `cuentas_pagar:gestionar`,
`conteo_fisico:aplicar`, `cadena_frio:capturar`, `cadena_frio:gestionar_equipos`, `compras:sugeridas`,
`metas:gestionar`, `facturacion:emitir`, `facturacion:cancelar`.

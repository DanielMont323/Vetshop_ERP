# Plan Fase 3 — Observaciones de Carlos sobre la demo

Origen: observaciones de Carlos después de ver la demo (noviembre 2026). Mismas reglas de siempre (`CLAUDE.md`):
centavos enteros, fechas en UTC, filtro de sucursal en el servidor, bitácora, transacciones, pruebas por endpoint.
**Una rama y un PR por paso.**

## Qué ya existe y qué falta

| # | Observación | Hoy en el sistema | Qué falta |
|---|---|---|---|
| PG-1 | Salidas de efectivo (mandaditos) | Retiro de efectivo en el turno, siempre con PIN del dueño y motivo libre | Botón rápido «Gasto de caja» con conceptos (mandadito, garrafón, papelería…) y un tope diario sin PIN |
| PG-2 | Descuentos 5, 10 y 15 % a clientes frecuentes | Descuento por renglón en la caja, siempre con PIN | Lealtad por costales premium (5.º, 10.º y 15.º costal) y botones rápidos 5/10/15 % |
| PG-3 | Registrar clientes para lealtad | Solo el dueño da de alta clientes (Administración) | Alta rápida desde la caja y programa de lealtad |
| PG-4 | Pacientes de clínica y recordatorio de cita 5 días antes | No hay mascotas ni citas | Mascotas por cliente, agenda de citas, recordatorios |
| PG-5 | Clientes de estética canina y recordatorio de cita | No hay | Lo mismo con citas de estética |
| PG-6 | Directorio de clientes | Lista de clientes solo para el dueño, sin dirección | Directorio para la caja con dirección, teléfonos y mascotas |
| PG-7 | Agenda de alimento, medicamento y vacunas de sus mascotas | No hay | Recordatorios recurrentes por mascota (p. ej. croquetas cada 30 días, vacuna anual) |
| PG-8 | Venta de mayoreo según piezas | Precio por lista del cliente (mayoreo, clínica…), no por cantidad | Escalas por cantidad: desde N piezas, precio de mayoreo automático |
| PG-9 | Promociones (por caducidad o exclusivas) | No hay promociones; todo descuento pide PIN | Promociones con fechas: por producto o por lote próximo a caducar, se aplican solas |
| PG-10 | Descuentos especiales (recomendación, etc.) | Descuento libre con PIN | Catálogo de motivos de descuento con su porcentaje y si piden PIN |
| VP-1 | Facturas y notas para veterinarias, petshops y estéticas | Facturación CFDI lista (Paso 17) | **Nota de venta** (remisión) imprimible en hoja carta para clientes de distribución |
| VP-2 | Cobrar a un veterinario, abonar a su cuenta y avisar por WhatsApp lo cobrado y las facturas afectadas | Abonos en Cobranza con comprobante; sin WhatsApp ni ligar a facturas | Mensaje de WhatsApp con el abono, las ventas y facturas que cubrió; complemento de pago de las facturas PPD |
| G-1 | Pedidos a proveedores | Compras sugeridas crean un borrador de recepción (Paso 15) | **Pedido (orden de compra)** que se envía al proveedor (WhatsApp/PDF) y luego se recibe contra lo pedido |
| G-2 | Sugerencia de pedidos según inventario | **Ya existe**: Recepción → Compras sugeridas (venta diaria, mínimos/máximos, caducidades, en camino) | Conectarla con los pedidos (G-1) |

## Decisiones tomadas (27/11/2026)

- **WhatsApp por enlace**: el sistema arma el mensaje y abre WhatsApp; se presiona *Enviar*. La API queda para después.
- **Huellitas no da consulta ni estética**: son clientes. No hay agenda de citas; se registran las mascotas de los
  clientes y sus recordatorios (alimento, medicamento, vacunas, y la próxima cita que tengan en su clínica o estética).
- **Lealtad (Carlos):** cada **costal de alimento premium** suma 1 punto. En el **5.º costal** se aplica **5 %**, en el
  **10.º 10 %** y en el **15.º 15 %**. Solo aplica a costales de alimento premium y únicamente en la compra de alimento.
- **Prioridad:** primero caja y precios (pasos 20 y 21).

## WhatsApp: dos formas

1. **Enlace de WhatsApp (recomendado para empezar):** el sistema arma el mensaje y abre WhatsApp (Web o del celular)
   con el texto listo; quien atiende solo presiona *Enviar*. Gratis, sin trámites, funciona hoy.
   Para los recordatorios: una lista diaria «Recordatorios de hoy» con un botón por cliente.
2. **WhatsApp Business API (después):** envío automático sin intervención (recordatorios a las 9:00, avisos de abono).
   Requiere cuenta de Meta Business verificada, número dedicado, plantillas aprobadas por Meta y un proveedor
   (Meta Cloud API o Twilio); cada mensaje tiene costo. Se agrega sobre lo mismo sin rehacer nada.

## Pasos propuestos

### Paso 20 — Caja más rápida
- **Gastos de caja** (PG-1): conceptos configurables; sin PIN hasta un tope por turno (configurable, p. ej. $300),
  arriba del tope pide PIN. Salen en el corte como hoy los retiros.
- **Alta rápida de cliente** desde la caja (PG-3): nombre, teléfono, dirección; el dueño sigue siendo quien da crédito
  y listas de precios.
- **Directorio de clientes** (PG-6) para la caja: búsqueda por nombre o teléfono, dirección, teléfonos, notas.
  `Cliente` gana `direccion` y `telefonos[]`.

### Paso 21 — Precios: mayoreo por cantidad, promociones y descuentos con motivo
- **Escalas de mayoreo** (PG-8): por producto, «desde N piezas → precio X» (o lista mayoreo). La caja lo aplica sola.
- **Promociones** (PG-9): precio o % especial con vigencia; por producto, por categoría o **por lote** (para mover lo
  próximo a caducar: la caja vende primero ese lote y aplica el precio). Las crea el dueño; se aplican sin PIN.
- **Descuentos con motivo** (PG-2, PG-10): botones 5/10/15 % y motivos (cliente frecuente, recomendación…), cada
  motivo con su % máximo y si requiere PIN. Todo queda en bitácora y en reportes («descuentos por motivo»).

### Paso 22 — Lealtad por costales de alimento premium
- `Producto.lealtad` (marca los costales de alimento premium).
- Cada costal premium vendido a un cliente registrado suma 1 punto (una cancelación lo resta).
- Al cobrar, la caja ve cuántos lleva: el costal que hace el 5.º lleva 5 %, el 10.º 10 % y el 15.º 15 %, sin PIN.
  Se muestra «lleva 4: el siguiente costal tiene 5 %».
- El descuento solo se aplica a ese costal premium (no al resto de la compra).
- Tarjeta de lealtad en el estado del cliente y reporte de descuentos de lealtad.

### Paso 23 — Mascotas y recordatorios
- **Mascotas** por cliente: nombre, especie, raza, nacimiento, peso, notas.
- **Recordatorios** por mascota (PG-4, PG-5, PG-7): próxima cita (en su clínica o estética) avisando 5 días antes, y
  recurrentes (alimento cada N días, desparasitante, vacuna anual). Al vender alimento se puede proponer el siguiente
  recordatorio. Lista diaria «Recordatorios de hoy» con botón de WhatsApp y marca de «avisado».

### Paso 24 — Clientes de distribución
- **Nota de venta** (VP-1) en hoja carta con datos del cliente, para veterinarias, petshops y estéticas.
- **Abono con WhatsApp** (VP-2): al registrar el abono, mensaje con lo cobrado, las ventas que cubrió, sus facturas y
  el saldo; **complemento de pago** automático cuando la venta tenía factura PPD.

### Paso 25 — Pedidos a proveedores
- **Pedido** (G-1): desde Compras sugeridas (G-2) o a mano; folio, proveedor, partidas, estado
  (borrador → enviado → recibido parcial / recibido / cancelado); PDF y WhatsApp al proveedor.
- Al llegar la mercancía, la recepción se hace **contra el pedido** (se ve lo pendiente por surtir).
- Proveedor gana `whatsapp` y `correo`.

## Decisiones pendientes (Carlos / Ulises)

1. **Topes sin PIN:** gasto de caja (¿$300 por turno?) y descuentos manuales (¿el cajero aplica 5 y 10 % sin PIN y
   15 % con PIN?).
2. **Lealtad:** después del 15.º costal, ¿vuelve a empezar la cuenta? ¿Los puntos vencen (p. ej. a los 12 meses)?
   ¿Qué productos son «alimento premium» (marcas o lista)?

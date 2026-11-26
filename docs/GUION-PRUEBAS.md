# Guion de pruebas con usuarios de prueba

Para probar los 14 módulos antes del arranque. Usa la base **`vetshop-pruebas`** (o `npm run dev:memoria` en local,
que se borra al cerrar). Todos los datos de demostración dicen «(prueba)».

## Antes de empezar

- Usuarios de prueba (misma contraseña para todos, la de `DEMO_PASSWORD` en `backend/.env`):

  | Usuario | Rol | Sucursales |
  |---|---|---|
  | `dueno.demo` | Dueño (con PIN) | Todas |
  | `cajero.centro` | Cajero | Centro (prueba) |
  | `cajero.norte` | Cajero | Norte (prueba) |
  | `almacen.demo` | Almacén | Almacén, Centro y Norte |
  | `medico.demo` | Médico responsable (con PIN) | Centro (prueba) |

- Los PIN están en `backend/.env` (`DEMO_PIN_DUENO`, `DEMO_PIN_MEDICO`).
- La demo trae: ventas de los últimos días, un turno abierto en Centro (caja 1), crédito con saldo y un cargo
  vencido, una cuenta por pagar que vence en 5 días, un refrigerador con una lectura fuera de rango, metas del mes y
  una factura de prueba (PAC **simulado**: sin validez fiscal).
- Cada prueba: marca ✅ si funcionó o anota qué pasó (pantalla, qué hiciste, qué esperabas, captura).

## Cajero (`cajero.centro`)

- [ ] **Caja**: escanear o buscar (F2) productos, cambiar cantidad, cobrar (F12) en efectivo con cambio; tarjeta;
  pago mixto.
- [ ] Producto a granel en kg (Croqueta Gato a granel) con decimales.
- [ ] Descuento: pide usuario y PIN del dueño.
- [ ] Venta en espera y recuperarla.
- [ ] Producto con receta (Antibiótico): no deja cobrar sin receta validada.
- [ ] **Crédito**: cliente «Clínica Patitas» → «A crédito» / «Todo a crédito». Con «Estética Peludos» (tiene vencido)
  pide PIN del dueño.
- [ ] Elegir **vendedor** distinto en la caja.
- [ ] Reimprimir ticket (sale la dirección de autofactura).
- [ ] **Cobranza**: estado de cuenta de Clínica Patitas, registrar un abono, imprimir comprobante.
- [ ] **Facturas**: facturar una venta a Clínica Patitas; ver/imprimir; descargar XML.
- [ ] **Frío**: registrar la temperatura del refrigerador (en rango y una fuera de rango con acción correctiva).
- [ ] **Turno y corte**: retiro de efectivo (PIN del dueño), corte ciego por denominación; si hay diferencia queda
  para que el dueño la autorice.
- [ ] Inicio: «Mi meta del mes».
- [ ] Intentar entrar a `/reportes` o `/cuentas-por-pagar` escribiendo la dirección: debe decir «No tienes acceso».

## Almacén (`almacen.demo`)

- [ ] **Recepción**: nueva recepción con lote, caducidad (MM/AAAA) y temperatura de llegada de la vacuna;
  confirmar (aparece la confirmación de la app).
- [ ] Recepción a crédito: después el dueño la ve en «Por pagar».
- [ ] **Compras sugeridas** (botón en Recepción): cambiar días de cobertura; «Crear borrador de compra».
- [ ] **Traspasos**: enviar del Almacén a Norte; recibir en Norte (con `cajero.norte` no se puede: lo recibe almacén o
  el dueño) con una diferencia.
- [ ] **Existencias**: ajuste de salida (pide PIN del dueño); motivo «Cadena de frío».
- [ ] **Conteo físico** en Norte: iniciar, escanear y capturar, «Terminar captura». Mientras está abierto, un ajuste
  debe rechazarse.
- [ ] Productos: mínimo y máximo por sucursal; clave SAT.

## Médico responsable (`medico.demo`)

- [ ] **Recetas**: capturar receta con varias partidas, adjuntar foto (solo en local por ahora), validar con su PIN.
- [ ] Con el cajero, surtir el antibiótico ligado a esa receta.
- [ ] Registrar temperatura en **Frío**.

## Dueño (`dueno.demo`)

- [ ] **Tablero**: ventas de hoy, 7 días, metas del mes y alertas (caducados, por caducar, cortes, facturas de
  proveedores, sucursales sin conteo, refrigeradores).
- [ ] Autorizar con PIN: diferencia de corte, cancelación de venta, corrección de forma de pago.
- [ ] **Reportes** y Excel; **Metas**: fijar meta de sucursal y de vendedor; ver proyección.
- [ ] **Cobranza**: cartera por antigüedad (Estética Peludos vencida) y Excel.
- [ ] **Por pagar**: pagar parcialmente la factura DEMO-101; cancelar el pago.
- [ ] **Conteo**: revisar diferencias y aplicar con PIN (con «no contados como cero» si faltó algo).
- [ ] **Frío**: alta de un equipo, bitácora del mes (imprimir y Excel).
- [ ] **Facturas**: factura global de días anteriores; nota de crédito; complemento de pago de la F-1 (PPD);
  cancelar una factura (PIN). Una venta facturada no se deja cancelar.
- [ ] **Administración**: crear usuario, sucursal, cliente con datos fiscales y crédito.
- [ ] **Autofactura** (sin sesión, en `/autofactura`): facturar un ticket del mes con folio y total.

## Cómo reportar

Para cada problema: usuario, sucursal, pantalla, pasos, qué esperabas y qué pasó (con captura). Se corrigen en PRs
pequeños antes de pasar a producción.

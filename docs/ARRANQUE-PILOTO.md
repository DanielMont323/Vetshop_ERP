# Arranque del piloto (una sucursal, diciembre)

Lista de verificación para poner en marcha el ERP en la sucursal piloto. Marca cada punto al terminarlo.
Responsable técnico: Ulises. Dueño: Carlos.

## 1. Antes de publicar: decisiones pendientes

Revisa `docs/PENDIENTES.md`. Para el piloto conviene resolver o aceptar explícitamente:

- [x] **Fotos de recetas y XML en producción**: Vercel Blob privado `vetshop-archivos` conectado a `vetshop-api`.
  Mientras no esté, no adjuntes archivos (los controlados no se podrán validar).
- [ ] Mensaje de cuenta bloqueada que revela si el usuario existe (riesgo bajo; decidir antes de enero).
- [ ] Devolución de compras a proveedor y devoluciones parciales de ventas (hoy: ajuste de inventario o cancelar y volver a cobrar).
- [ ] Tolerancia en el corte (hoy: cualquier diferencia pide justificación y PIN).

## 2. Infraestructura

- [ ] **MongoDB Atlas**: crear el clúster (réplica, incluida en todos los planes) y la base `vetshop`.
  - Usuario de base de datos con permiso solo sobre `vetshop`; contraseña larga.
  - Acceso de red: las IP de Vercel (o 0.0.0.0/0 con usuario y contraseña fuertes).
  - Activar los **respaldos** automáticos de Atlas y anotar cómo restaurar.
- [x] **Vercel – backend** (`vetshop-api` → https://vetshop-api.vercel.app) (carpeta `backend/`): variables `MONGODB_URI`, `JWT_SECRET` (aleatorio de 48+ bytes),
  `CORS_ORIGINS` (la URL del frontend), `FRONTEND_URL` (se imprime en el ticket para la autofactura),
  `NODE_ENV=production`, y las de almacenamiento cuando se configure Blob.
- [ ] **Facturación**: mientras no se pruebe Facturapi, `FACTURACION_PAC=simulado` (facturas sin validez fiscal).
  Para timbrar: `FACTURACION_PAC=facturapi` y `FACTURAPI_KEY` (primero la de pruebas). Ver `docs/PENDIENTES.md`.
- [x] **Vercel – frontend** (`vetshop-web` → https://vetshop-web.vercel.app) (carpeta `frontend/`): variable `VITE_API_URL` = URL del backend + `/api`.
- [x] Crear la base `vetshop` con sus colecciones e índices: `npm run preparar-bd` (desde `backend/`, con `.env` apuntando
  a Atlas). Repetirlo después de cada actualización que agregue índices.
- [x] Abrir `https://<backend>/api/salud` y ver `{"ok":true}`.
- [x] Atlas → Network Access con `0.0.0.0/0` (Vercel no tiene IPs fijas; exige contraseña fuerte en la base).
- [ ] Hoy la app publicada usa la base **`vetshop-demo`** (pruebas con usuarios). Para el arranque: cambiar
  `MONGODB_URI` en Vercel a `vetshop`, crear el primer dueño y cargar el catálogo; volver a publicar.
- Los dos proyectos están conectados a GitHub (carpeta raíz `backend` / `frontend`): cada merge a `main` publica a
  producción y cada PR tiene su vista previa.

## 3. Datos iniciales

- [ ] Crear el primer dueño (desde `backend/`, con `.env` apuntando a Atlas):
  ```powershell
  $env:DUENO_PASSWORD = "una-contraseña-larga"; npm run crear-dueno -- --usuario carlos --nombre "Carlos"
  ```
- [ ] Entrar como Carlos → **Contraseña** → definir su **PIN de autorización**.
- [ ] **Administración → Sucursales**: crear la sucursal piloto (y el almacén si surte a la tienda).
- [ ] **Administración → Usuarios**: cajero(s), almacén y médico responsable con sus sucursales.
  Cada médico entra y define su PIN en **Contraseña**.
- [ ] **Proveedores**: dar de alta los principales (o al capturar la primera recepción).
- [ ] **Importación del catálogo e inventario inicial** (el inventario de cada sucursal se carga **una sola vez**):
  1. `npm run plantilla-importacion -- plantilla.xlsx` y llenarla (instrucciones en la primera hoja).
  2. Contar físicamente la sucursal piloto el día anterior al arranque; capturar lote, caducidad, cantidad y costo.
  3. Revisar sin cargar: `npm run importar -- datos.xlsx --usuario carlos` → corregir hasta 0 errores.
  4. Cargar: `npm run importar -- datos.xlsx --usuario carlos --aplicar`.
  5. Verificar en **Existencias** de la sucursal: totales contra el conteo, y alertas de caducados (darlos de baja
     con un ajuste de salida «Caducado»).
- [ ] **Precios**: revisar en **Listas de precios** que todos los productos activos tengan precio de público.
- [ ] **Clientes** de distribución con su lista de precios (en la importación o en Administración → Clientes),
  sus **datos fiscales** y, si compran a crédito, su límite y plazo.
- [ ] **Equipos de frío** de cada sucursal (Frío → Nuevo equipo) y **metas** del mes (Reportes → Metas).
- [ ] Mínimos y máximos de los productos principales (para las compras sugeridas).

## 4. Equipo de la caja

- [ ] Computadora con Chrome o Edge actualizado; abrir el frontend y guardar el acceso directo.
- [ ] **Lector de código de barras** en modo teclado con Enter al final: escanear 5 productos en la caja.
- [ ] **Impresora térmica** (58 u 80 mm) como impresora predeterminada, márgenes en cero, sin encabezado/pie del
  navegador: imprimir un ticket y un corte de prueba. Si el ancho no cuadra, ajustar `ancho` (58/80).
- [ ] Terminal bancaria: confirmar cómo sacar su **total del día** (lo pide el corte).

## 5. Capacitación (1 a 2 horas, con los datos de demostración)

Usar `npm run dev:memoria` (local) o una base de demostración (`npm run seed-demo` en una base vacía).

- [ ] Cajero: abrir turno con el fondo, cobrar (lector, F2, F12), cliente y lista de precios, venta en espera,
  producto con receta, reimprimir ticket, corte ciego al final del día.
- [ ] Dueño: autorizar descuento, cancelación, corrección de forma de pago, diferencia de corte; revisar el tablero
  y descargar el Excel de ventas.
- [ ] Almacén: recepción de mercancía (con temperatura para refrigerados), traspasos, ajustes con PIN.
- [ ] Médico responsable: validar recetas con su PIN (y adjuntar el archivo de controlados).

## 6. Primer día

- [ ] Abrir turno contando el fondo por denominación.
- [ ] Durante el día: el dueño revisa el tablero (ventas, alertas).
- [ ] Al cierre: corte ciego; si hay diferencia, justificar y autorizar. Imprimir y firmar el corte.
- [ ] Revisar con Carlos el reporte del día y el Excel para el contador.
- [ ] Anotar todo lo que estorbe o falte para ajustarlo antes del arranque en todas las sucursales (enero).

## 7. Antes de enero (todas las sucursales)

- [ ] Inventario de cierre de año de cada sucursal → importar (una vez por sucursal).
- [ ] Usuarios y PIN de las demás sucursales.
- [ ] Resolver los pendientes marcados para enero en `docs/PENDIENTES.md`.
- [ ] Fase 2: crédito y cobranza, cuentas por pagar, CFDI 4.0, conteo físico, compras sugeridas, cadena de frío,
  metas, modo sin conexión (ver `docs/PLAN-FASE-1.md`).

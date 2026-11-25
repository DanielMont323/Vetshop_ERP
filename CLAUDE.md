# CLAUDE.md — ERP con punto de venta Huellitas Vetshop

Proyecto: ERP con punto de venta para **Huellitas Vetshop** (Tepic, Nayarit), comercializadora y farmacia veterinaria.
Cliente: Carlos (dueño). Desarrollador responsable: Ulises. Ulises revisa y aprueba todo cambio antes de producción.

## Contexto del negocio

- 70% venta al público, 30% distribución (clínicas, veterinarias, petshops, estéticas).
- 3 sucursales + 1 almacén hoy; abren 3 sucursales más → 6 puntos de venta, 1 caja por sucursal, ~10 usuarios.
- 20–40 tickets por tienda al día. ~300 productos (SKUs). Todos con código de barras.
- Medicamentos (algunos controlados, con receta cuantificada), biológicos con cadena de frío, alimento (costal cerrado y algunos por kilo), accesorios.
- Listas de precios (público, mayoreo, clínica, empleado). Crédito a 30 días con bonificación por pronto pago a 8 días.
- Formas de pago: efectivo, tarjeta, transferencia. Factura global de público en general + ~10% de ventas facturadas a clientes.
- Problema actual principal: en el corte registran efectivo como tarjeta (y viceversa) y hay sobrantes/faltantes sin explicación.
- Contabilidad: contador externo con Contpaq (solo se le exportan reportes; NO construimos contabilidad).
- Zona horaria del negocio: `America/Mazatlan` (Tepic, UTC-7 todo el año).

Las pantallas de referencia están en el lienzo de diseño "Vetshop – Pantallas de prueba" y la descripción de módulos en el documento "Huellitas Vetshop – Descripción de módulos del sistema". Ulises te pasará capturas o el texto cuando haga falta.

## Stack (igual que ERP_ESTETICA_CANINA_VERCEL, con ajustes)

- **Frontend:** React 18 + **Vite** (no Create React App, está descontinuado) + Tailwind + React Router + axios + Recharts + lucide-react + react-hot-toast.
- **Backend:** Node + Express + Mongoose, exportado como app para Vercel (igual que estética canina).
- **Base de datos:** MongoDB Atlas (réplica, para poder usar transacciones). **Una sola base de datos para todas las sucursales.**
- **Auth:** JWT + bcrypt, con bloqueo por intentos (copiar el enfoque de estética canina, pero el contador de intentos en la BD, no en memoria).
- **Pruebas:** Jest + Supertest en backend, desde el inicio.
- **Despliegue:** Vercel (frontend y backend como proyectos separados), Atlas para la BD.

Reutiliza de estética canina la lógica que ya funciona: capas de inventario (`InventoryLayer`), movimientos (`InventoryMovement`), consumo y reversión FIFO, middleware de auth, anti doble clic en `api.js`, estructura de pruebas. Cópiala y adáptala; no importes código muerto ni los helpers de carnet/mascotas.

## Reglas de arquitectura (obligatorias)

1. **Una sola BD multi-sucursal.** Toda colección operativa lleva `sucursal` (ObjectId). El catálogo de productos, listas de precios, clientes y proveedores son globales. Existencias, lotes, ventas, cortes, traspasos, conteos y lecturas de temperatura son por sucursal.
2. **Filtro de sucursal en el servidor, nunca solo en el frontend.** Un middleware `scopeSucursal` toma las sucursales permitidas del usuario (`req.user.sucursales`) y las aplica a cada consulta. El rol `dueno` ve todas.
3. **Dinero en centavos enteros** (`Number` entero, p. ej. `125000` = $1,250.00). Nunca decimales de JS para dinero. Formatear solo al mostrar.
4. **Fechas en UTC real.** Nada de "hora de Tepic guardada como UTC" (fue un bug en estética canina). Convertir a `America/Mazatlan` solo al mostrar y al calcular rangos de día (usar `date-fns-tz`).
5. **Ventas inmutables.** Una venta cobrada no se edita (no hay `PUT /ventas/:id`). Se cancela o se devuelve, y eso genera movimientos contrarios. Cambiar la forma de pago de una venta requiere autorización del dueño y queda en bitácora.
6. **Inventario por movimientos.** Las existencias se derivan de `InventoryLayer` (por producto + sucursal + lote + caducidad) y cada cambio crea un `InventoryMovement` que nunca se edita.
7. **Salida por caducidad (FEFO):** al vender o traspasar se consume primero el lote que caduca antes (no el que entró primero). Los lotes caducados no se venden.
8. **Transacciones** de Mongo en toda operación que toque varias colecciones (venta, recepción, traspaso, ajuste, corte).
9. **Bitácora** (`Auditoria`): usuario, acción, entidad, antes/después, fecha, para autorizaciones, cancelaciones, ajustes y cambios de forma de pago.
10. **Permisos por rol:** `cajero`, `almacen`, `medico_responsable`, `dueno`. Middleware `requirePermiso('ventas:cobrar')`, etc. Matriz en `backend/config/permisos.js`.
11. **Lógica en servicios, no en rutas.** `routes/` solo valida y llama a `services/`. Ningún archivo de ruta o página de más de ~400 líneas; divide en componentes.
12. **Validación** de entrada en backend en cada endpoint (express-validator o Joi).

## Convenciones

- Código, nombres de modelos y campos en español (como estética canina): `Producto`, `Venta`, `sucursal`, `caducidad`.
- Commits pequeños y descriptivos en español. Una funcionalidad por rama/PR.
- `node_modules`, `.env*` (excepto `.env.example`), builds y respaldos SIEMPRE en `.gitignore` desde el primer commit.
- Cada endpoint nuevo con su prueba. No subir con pruebas rotas.
- No inventar datos de clientes reales; usa datos de prueba en seeds.
- Antes de cambios grandes, propone el plan y espera la aprobación de Ulises.

## Estructura

```
vetshop-erp/
├─ backend/
│  ├─ config/        (database.js, permisos.js)
│  ├─ middleware/    (auth.js, scopeSucursal.js, permisos.js, errores.js)
│  ├─ models/
│  ├─ services/      (ventas, inventario, cortes, traspasos, recepcion, recetas…)
│  ├─ routes/
│  ├─ scripts/       (seed, migración desde Excel, respaldo)
│  ├─ tests/
│  └─ server.js
├─ frontend/
│  ├─ src/pages/  src/components/  src/services/api.js  src/contexts/
│  └─ vite.config.js
├─ docs/PLAN-FASE-1.md
└─ CLAUDE.md
```

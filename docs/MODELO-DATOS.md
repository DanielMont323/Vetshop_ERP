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

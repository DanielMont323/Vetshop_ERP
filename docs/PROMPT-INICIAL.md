Vamos a construir el ERP con punto de venta de Huellitas Vetshop.

Lee primero CLAUDE.md y docs/PLAN-FASE-1.md completos. Como referencia de código existente, revisa el repositorio
https://github.com/DanielMont323/ERP_ESTETICA_CANINA_VERCEL (sobre todo models/InventoryLayer.js, models/InventoryMovement.js,
helpers/consumoFifo.js, helpers/revertirFifoVenta.js, middleware/auth.js, routes/auth.js, frontend/src/services/api.js y tests/).
Reutiliza lo que sirva respetando las reglas de CLAUDE.md (una sola BD multi-sucursal, dinero en centavos, fechas en UTC real,
ventas inmutables, salida por caducidad FEFO, lógica en servicios).

Antes de escribir código:
1. Resume en 10 líneas o menos lo que entendiste del proyecto.
2. Muéstrame el modelo de datos de la Fase 1 (colecciones, campos clave e índices), incluyendo cómo aplicas el filtro por sucursal.
3. Dime qué piezas vas a copiar de estética canina y qué vas a cambiar.

Espera mi aprobación. Después empieza por el Paso 0 y el Paso 1 del plan, con pruebas, y detente al terminar el Paso 1 para que lo revise.

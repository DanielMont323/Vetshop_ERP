# Vetshop ERP

ERP con punto de venta para Huellitas Vetshop (comercializadora y farmacia veterinaria, Tepic, Nayarit).

- Reglas y contexto del proyecto: `CLAUDE.md`
- Plan de la Fase 1 (piloto): `docs/PLAN-FASE-1.md`
- Modelo de datos y decisiones: `docs/MODELO-DATOS.md`
- Pendientes conocidos: `docs/PENDIENTES.md`
- Arranque del piloto (lista de verificación): `docs/ARRANQUE-PILOTO.md`
- Primer mensaje para Claude Code: `docs/PROMPT-INICIAL.md`

## Requisitos

Node 20 o superior.

## Backend (`backend/`)

```bash
cd backend
npm install
npm test               # Jest + Supertest con Mongo en memoria (no toca Atlas)
npm run dev:memoria    # API local con Mongo en memoria y usuarios de prueba (se borra al cerrar)
```

`dev:memoria` crea los usuarios `dueno.demo`, `cajero.centro`, `almacen.demo` y `medico.demo`. Todos usan la
contraseña `Prueba-12345`; el PIN del dueño es 1234 y el del médico 4321.

Con Atlas: copia `backend/.env.example` a `backend/.env`, llena los valores, ejecuta `npm run preparar-bd` (crea
colecciones e índices; se puede repetir) y luego `npm run dev`. El primer dueño se crea con:

```bash
DUENO_PASSWORD="una-contraseña-larga" npm run crear-dueno -- --usuario carlos --nombre "Carlos"
```

Importación inicial y datos de demostración:

```bash
npm run plantilla-importacion -- plantilla.xlsx                 # plantilla vacía con instrucciones
npm run importar -- datos.xlsx --usuario carlos                 # revisa y lista errores (no escribe)
npm run importar -- datos.xlsx --usuario carlos --aplicar       # carga
DEMO_PASSWORD="una-contraseña" npm run seed-demo                # datos de demostración en una base VACÍA
```

## Frontend (`frontend/`)

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173 (usa VITE_API_URL, por defecto http://localhost:5000/api)
```

## Despliegue

Backend y frontend van en proyectos de Vercel separados (cada carpeta trae su `vercel.json`). En el backend hay que
configurar `MONGODB_URI`, `JWT_SECRET` y `CORS_ORIGINS` (la URL del frontend); en el frontend, `VITE_API_URL`.

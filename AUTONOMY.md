# AUTONOMY.md — Cómo poner el sistema a funcionar solo

Guía de activación de la FASE 5. Mientras no completes estos pasos el sistema
funciona igual, pero **olvida todo lo aprendido al reiniciar el servidor**, y
lo dice en `/dashboard/autonomy` en lugar de dar a entender lo contrario.

## 1. Aplicar la migración

```bash
supabase db push          # o: psql "$DATABASE_URL" -f supabase/migrations/0003_autonomy.sql
```

Es idempotente (`if not exists` / `drop policy if exists`), así que puedes
ejecutarla sin saber el estado previo de la base de datos y repetirla sin
romper nada.

Crea seis tablas —`memory_events`, `lead_outcomes`, `known_errors`,
`experiments`, `experiment_observations`, `autonomous_runs`—, añade el estado
`NOT_INTERESTED` a los leads y dos columnas de control de reinvestigación a
`businesses`.

**Comprobación:** entra en `/dashboard/autonomy`. La tarjeta "Persistencia del
aprendizaje" enumera exactamente qué tablas faltan si algo no se aplicó.

## 2. Configurar las variables

```bash
SUPABASE_SERVICE_ROLE_KEY=...      # ya documentada en ENVIRONMENT.md
AUTONOMOUS_OWNER_ID=<uuid>         # el auth.users.id de tu cuenta
AUTONOMOUS_CYCLE_SECRET=<32+ chars aleatorios>
```

`AUTONOMOUS_OWNER_ID` tiene que configurarse a mano a propósito: todo lo que
el sistema escribe pertenece a una cuenta real, y adivinarla a partir de la
primera fila de la tabla sería exactamente el tipo de suposición que este
proyecto no hace.

Para obtener el tuyo: Supabase → Authentication → Users → copia el `UID`.

Genera el secreto con `openssl rand -hex 32`.

## 3. Programar los ciclos

```bash
curl -X POST https://tu-dominio/api/autonomous/cycle \
  -H "Authorization: Bearer $AUTONOMOUS_CYCLE_SECRET"
```

`GET` sobre la misma ruta devuelve el estado sin ejecutar nada: sirve para
comprobar la configuración antes de programar la primera ejecución.

**Vercel Cron** (`vercel.json`):

```json
{ "crons": [{ "path": "/api/autonomous/cycle", "schedule": "0 8 * * 1-5" }] }
```

Vercel Cron no envía cabeceras propias, así que necesitarás un proxy o una
GitHub Action si quieres mandar el `Authorization`. Con GitHub Actions:

```yaml
on:
  schedule: [{ cron: "0 8 * * 1-5" }]
jobs:
  cycle:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fX POST "${{ secrets.APP_URL }}/api/autonomous/cycle" \
            -H "Authorization: Bearer ${{ secrets.AUTONOMOUS_CYCLE_SECRET }}"
```

No hay proceso residente haciendo de reloj: en un despliegue serverless un
`setInterval` muere con la instancia y se duplica entre instancias. El reloj
vive fuera y este endpoint es la puerta.

## 4. Cerrar el bucle de aprendizaje

Esto es lo que de verdad hace que el sistema mejore, y es lo único que
requiere trabajo humano: **marca el desenlace real de cada lead**.

En `/dashboard/pipeline` o en la ficha del prospecto, mueve el lead a
`Cliente`, `Perdido` o `No interesado`. En ese momento el sistema guarda la
puntuación que él mismo había dado *antes de saber el resultado*, y esa pareja
predicción/realidad es la única evidencia que el motor de aprendizaje trata
como verdad.

Sin desenlaces registrados el sistema puede descubrir y puntuar, pero no puede
aprender qué predice una venta, y lo dirá así en el dashboard.

## Qué decide solo y qué no

**Puede cambiar por su cuenta** (`AUTONOMOUS_AREAS`): orden de fuentes, orden
de municipios, orden de sectores, estrategia de consulta, profundidad
sugerida.

**No puede tocar nunca** (`HARD_CONSTRAINTS`): la regla anti-invención, la
regla de corroboración (1 fuente = PROBABLE, 2 = VERIFICADO, contradicción =
NO_VERIFICADO), el umbral de confianza, los pesos del scoring, el mínimo de
competidores y las reglas de verificación.

Cualquier área que no esté en la primera lista se rechaza por defecto. Los
rechazos se registran igual que las aplicaciones: un cambio que nadie puede
señalar después no es un cambio en el que se pueda confiar.

## Umbrales

| Regla | Valor | Dónde |
|---|---|---|
| Observaciones mínimas para actuar | 10 | `MIN_SAMPLE_FOR_ACTION` |
| Ventaja mínima sobre la tasa base | 15 puntos | `MIN_LIFT_POINTS` |
| Observaciones por variante de experimento | 5 | `MIN_OBSERVATIONS_PER_VARIANT` |
| Días antes de reinvestigar | 30 | `REVISIT_AFTER_DAYS` |
| Presupuesto por ciclo | 3 municipios, 40 leads, 45 min | `DEFAULT_CYCLE_BUDGET` |

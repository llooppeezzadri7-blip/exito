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

## 3. Ejecutar un ciclo desde la terminal

La vía más rápida para lanzar la primera investigación real:

```bash
npm run cycle:check      # ¿responden las fuentes abiertas?
npm run cycle            # un ciclo completo, el sistema elige el objetivo
```

Con objetivo impuesto o presupuesto distinto:

```bash
npm run cycle -- --municipio Blanes --sector Hostelería
npm run cycle -- --municipios Blanes,Roses --leads 15 --objetivos 2 --minutos 20
```

Es el mismo código que ejecutan el botón del dashboard y el cron, no una
versión más suave. Al terminar imprime el objetivo elegido con su porqué, el
informe completo, y guarda `informes/informe-<fecha>.txt` y
`informes/leads-<fecha>.csv`.

`cycle:check` existe por un fallo real: detrás de un cortafuegos todas las
peticiones fallan, el ciclo registra "fuente no disponible" en cada objetivo y
termina con cero leads — indistinguible de "ahí no hay negocios". La
comprobación previa separa las dos cosas, y el ciclo se cancela solo si
ninguna fuente responde (`--force` lo fuerza igualmente).

## 4. Programar los ciclos

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

## 5. Cerrar el bucle de aprendizaje

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

---

## Auditoría de webs (W1)

Independiente del ciclo de prospección: audita cualquier web y puntúa nueve
dimensiones.

```bash
npm run audit -- https://ejemplo.com
npm run audit -- http://localhost:3000 --local     # tu propio dev server
npm run audit -- https://ejemplo.com --json auditoria.json
```

Sale con código 1 si el quality gate no pasa, así que puede encadenarse en CI.

**La regla que gobierna el modelo:** una comprobación que no se pudo ejecutar
vale `NO_EVALUABLE`, nunca cero. Un cero afirma "lo hacen mal"; no poder medir
dice otra cosa. Por eso cada puntuación lleva su confianza —qué porcentaje del
modelo se pudo medir de verdad— y una dimensión sin nada medible puntúa `null`
en lugar de arrastrar la nota global hacia abajo con una afirmación falsa.

El quality gate bloquea la entrega por dos motivos: un fallo crítico, o una
dimensión entera sin medir. Entregar a ciegas no es lo mismo que entregar algo
comprobado y aceptable.

`--local` permite auditar loopback. Está desactivado por defecto a propósito:
sin ese freno, la herramienta apuntaría a cualquier cosa que escuche en
localhost del servidor donde corra.

---

## Crawler y análisis de sitio (W2)

Convierte la auditoría de una URL en el análisis de un sitio entero.

```bash
npm run crawl -- https://ejemplo.com
npm run crawl -- https://ejemplo.com --paginas 100 --profundidad 4 --auditar 5
npm run crawl -- http://localhost:3000 --local
npm run crawl -- https://ejemplo.com --json sitio.json     # modelo completo
```

Descubre URLs por enlaces internos, sitemap (incluido sitemap index), robots.txt
y destinos de redirección. Construye el grafo del sitio —profundidad, enlaces
entrantes y salientes, huérfanas, hubs— y detecta 4xx, 5xx, enlaces rotos,
cadenas y bucles de redirección, títulos/H1/meta descriptions duplicados, URLs
duplicadas por barra final, contenido idéntico, canonicals cruzados o apuntando
a páginas no indexables, páginas demasiado profundas, y las tres
inconsistencias entre sitemap y crawl.

**Tres decisiones que conviene conocer:**

La normalización de URLs **solo** colapsa lo que es inequívocamente el mismo
recurso: fragmento, puerto por defecto, mayúsculas de esquema y host, y
parámetros de campaña. La barra final y los parámetros ordinarios se rastrean
por separado a propósito: fusionarlos ocultaría justo el problema de contenido
duplicado que el crawler existe para encontrar.

Un crawl que topó con un límite **rebaja sus conclusiones a PROBABLE**. Decir
"12 páginas huérfanas" tras parar en la página 20 sería una cifra inventada.

El **quality gate de sitio** es más estricto que el de página: bloquea también
si el crawl no llegó a cubrirlo todo. Dar por bueno un sitio del que solo se ha
visto la mitad no es lo mismo que darlo por bueno.

**Límites conocidos:** el contenido casi-duplicado solo se detecta cuando el
texto es idéntico —la detección por similitud necesita shingling, y afirmarla
desde un hash sería exagerar lo medido—. El crawl es de un solo hilo y con
pausa entre peticiones por educación con el servidor. El JavaScript no se
ejecuta durante el crawl: las páginas que solo renderizan en cliente se ven
como las sirve el servidor.

---

## Motor de oportunidad — "analiza este negocio"

La primera capacidad que va de una URL a algo vendible.

```bash
npm run analizar -- https://negocio.com --nombre "Talleres Munné"
npm run analizar -- http://localhost:3000 --local --una-pagina
npm run analizar -- https://negocio.com --json analisis.json
```

Encadena `crawl (W2) → audit (W1) → diagnóstico → recomendación`, reutilizando
los módulos existentes sin reimplementar nada.

**Qué añade sobre W1/W2:** ellos responden *"qué falla en esta web"*. Nadie
compra esa respuesta. El diagnóstico traduce cada hallazgo técnico a un
problema de negocio —"quien entra no tiene forma de contactar"— con su
consecuencia comercial y la evidencia técnica debajo, para poder defenderlo.

**La regla que gobierna la recomendación:** proponer la intervención más
pequeña que resuelve lo encontrado. Un negocio cuyo único fallo real es que
falta el enlace `tel:` no necesita una web nueva, y proponérsela es como se
pierde una venta que ya estaba ganada. Un rediseño solo se justifica cuando la
estructura falla —no funciona en móvil— o cuando la web está mal en varios
frentes a la vez.

Los precios salen del catálogo configurado en ajustes. Un servicio sin precio
se declara "a presupuestar" en lugar de inventarle una cifra.

Veredictos posibles: `web_nueva`, `rediseno`, `mejoras_puntuales`, `solo_seo`,
`sin_oportunidad_clara`, `evidencia_insuficiente`. Los dos últimos existen a
propósito: no todo negocio es una venta, y decirlo vale más que forzarla.

---

## Prospección por lotes — el comando de la mañana

Procesa una cartera de negocios y devuelve a quién llamar primero y qué decirle.

```bash
npm run prospectar -- negocios.csv --top 3 --briefs briefs/
npm run prospectar -- negocios.csv --json cartera.json
```

Columnas del CSV: `nombre`, `web`, `ciudad`, `sector`, `telefono`, `rating`,
`reseñas`. Acepta también los nombres en inglés y variantes sin tilde.

Cadena por negocio: `crawl → audit → diagnóstico → recomendación → oportunidad`.
Un negocio que falla no tumba el lote: se registra y se sigue.

**Qué mide el Opportunity Score.** No es "cómo de fea es la web". Pesa la
gravedad de los problemas (40), la calidad del negocio según señales públicas
(30), el valor del trabajo recomendado (20) y la contactabilidad (10). Un buen
negocio con web deficiente puntúa más que una web horrible de un negocio que no
tiene clientes que perder — que es precisamente lo que se busca.

**ALTA_OPORTUNIDAD es exigente a propósito:** hace falta puntuación ≥ 75 **y**
al menos un problema crítico que esté perdiendo clientes hoy. Un certificado
caducado no convierte a nadie en prioridad: se arregla en una tarde. Un ranking
donde todos son prioritarios no dice nada.

Estados que no venden nada y son resultados válidos: `SIN_OPORTUNIDAD_CLARA`,
`EVIDENCIA_INSUFICIENTE`. Un negocio sin puntuar aparece aparte, nunca como un
cero: no saber no es lo mismo que valer cero.

### DEMO_BRIEF

Con `--briefs` se escribe un brief por cada una de las mejores oportunidades:
páginas necesarias con su razón de ser, qué mejora respecto a la web actual,
patrón de titles, tipos de schema, dirección de diseño justificada por sector,
y — lo que más importa — el registro explícito de qué es `VERIFIED` y qué es
`PLACEHOLDER`, más lo que hay que pedirle al cliente. Un generador que no
distingue ambas cosas acaba inventándose la dirección de un negocio.

Nada del brief lo escribe un modelo de lenguaje: cada campo se copia de la
entrada verificada, se deriva de una medición, o se marca como marcador.

---

## Barrido de toda la Costa Brava

El comando para llenar el pipeline de una vez.

```bash
npm run barrido
npm run barrido -- --analizar 100 --top 15 --briefs briefs/
npm run barrido -- --municipios Blanes,Roses,Lloret\ de\ Mar --sectores Restaurantes,Hoteles
```

Descubre en los 72 municipios configurados × los sectores prioritarios,
deduplica en toda la región, analiza cada web a fondo y devuelve **un solo
ranking** de los más necesitados, con su teléfono, su problema principal y el
valor del trabajo recomendado.

Antes de gastar nada dice lo que va a costar (consultas, duración) y comprueba
que las fuentes responden. Si no responden, se cancela: cero negocios por falta
de red es indistinguible de cero negocios por falta de negocios, y prefiero
cancelar a darte un informe vacío que parece un resultado.

**Techos por defecto:** 20 negocios por consulta, 60 analizados a fondo, pausa
de 1,2 s entre consultas. Overpass es una API pública y gratuita; martillearla
es como se acaba con la IP bloqueada. Lo que queda fuera del techo se declara
como "descubierto pero sin analizar", nunca como descartado.

Diferencia con `npm run cycle`: el ciclo es el bucle desatendido con
presupuesto pequeño, pensado para correr solo cada día. El barrido es la
operación deliberada que lanzas tú una vez para llenar la cartera.

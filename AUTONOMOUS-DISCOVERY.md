# Descubrimiento autónomo sin Google Places — roadmap técnico

Estado: **propuesta, sin implementar**. Escrito antes de tocar código, para acordar el
enfoque. Fecha: 2026-08-14.

---

## 1. Inventario de lo que ya existe

Reutilizable tal cual, sin tocar (33 módulos, 163 tests en verde):

| Módulo | Qué hace | ¿Depende de Places? |
|---|---|---|
| `lib/research/evidence.ts` | Procedencia, FACT/OBSERVATION/OPPORTUNITY, NO_VERIFICADO | No |
| `lib/research/dedupe.ts` | Identidad por teléfono, dominio, nombre+dirección | Solo `gbp_place_id` como uno más |
| `lib/research/website-resolver.ts` | Verifica que una web pertenece al negocio | No |
| `lib/research/pipeline.ts` | Fases, reintentos, estado persistido | No |
| `lib/research/seasonality.ts` | Estacionalidad por sector y localidad | No |
| `lib/research/costa-brava.ts` | 23 municipios × 5 sectores × 41 subsectores | No |
| `lib/research/api-log.ts` | Registro de llamadas externas | No |
| `backend/scanner/scan-website.ts` | Auditoría técnica y SEO real | No |
| `backend/scanner/mobile-audit.ts` | Render móvil real en Chromium | No |
| `backend/scanner/detectors.ts` | CMS, reservas, ecommerce, analytics, redes | No |
| `lib/scoring/commercial-score.ts` | 7 factores, confianza, tiers | Sí, en un punto |
| `lib/security/ssrf-guard.ts` | Fetch seguro, redirects, timeouts | No |
| `backend/research/run-research.ts` | Orquestador de fases | Sí, en el descubrimiento |

**Acoplamiento real a Places: tres puntos.** No es una reescritura.

1. `google-places-provider.ts` — el proveedor. Se elimina.
2. `commercial-score.ts` → `websiteAbsenceIsEvidence()`: hoy solo cree que "no tiene web"
   si el dato viene de Places, porque Places devuelve siempre el campo. Sin Places hay
   que sustituir esa regla (ver §5).
3. `run-research.ts` → instancia el proveedor de Places por defecto.

Más `GOOGLE_PLACES_API_KEY` en env/docs/UI y `gbp_place_id` en el esquema, que se queda
como identificador externo opcional, no como identidad principal.

---

## 2. La restricción dura, verificada hoy

Antes de prometer "descubrimiento autónomo gratuito", el estado real del terreno:

| Fuente | Clave | Coste | Estado 2026 |
|---|---|---|---|
| Bing Web Search API | — | — | **Retirada** el 11-08-2025 |
| Brave Search API | Sí | 5 $/mes de crédito ≈1.000 consultas | **Sin plan gratuito** para nuevos usuarios; exige tarjeta |
| Google Custom Search | Sí | 100 consultas/día gratis | Vivo, pero con clave y tope bajo |
| SerpAPI / Tavily / Exa | Sí | 100–1.000/mes gratis | Vivo, con clave |
| SearXNG autoalojado | **No** | **0 €** | Vivo. Hay que levantar un contenedor |
| **Overpass API (OpenStreetMap)** | **No** | **0 €** | Vivo, ~10.000 peticiones/día, uso comercial permitido, sin SLA |
| **Registre de Turisme de Catalunya** | **No** | **0 €** | Vivo, API Socrata, CSV/JSON |

**Conclusión honesta: no existe hoy una búsqueda web general, gratuita y sin clave que
sea fiable.** Quien diga lo contrario está proponiendo scraping de Google, que viola sus
condiciones y acaba bloqueado por CAPTCHA en pocas decenas de consultas.

Pero **sí existe descubrimiento de negocios gratuito, sin clave y legítimo** — solo que no
pasa por un buscador. Pasa por datos abiertos.

---

## 3. Estrategia de fuentes, en capas

### Capa A — Columna vertebral: datos abiertos estructurados (0 €, sin clave)

**A1. OpenStreetMap vía Overpass API.** Es el sustituto real de Places. Consulta por área
administrativa y categoría; devuelve nombre, coordenadas, dirección, teléfono, web,
horarios y etiquetas de sector. Cobertura en la Costa Brava: buena en hostelería y
comercio, menor en servicios profesionales. Licencia ODbL: uso permitido citando la
fuente. Sin clave, sin tarjeta.

**A2. Registre de Turisme de Catalunya.** Registro oficial de alojamientos (hoteles,
campings, apartamentos, turismo rural) por municipio y dirección, con API y CSV. Es
**dato oficial**, más fiable que cualquier scraping: si un hotel está aquí, existe.

**A3. Portales de datos abiertos municipales y `datos.gob.es`** para censos de actividad
económica cuando el municipio los publique.

Estas tres cubren el "¿qué negocios existen?" sin gastar un euro y sin violar ninguna
condición de uso.

### Capa B — Enriquecimiento por navegación (0 €, sin clave)

Ya tenemos Playwright y el escáner. Para cada negocio descubierto en la capa A:

- Resolver su web oficial (el módulo ya existe) y auditarla.
- Extraer sus redes **desde su propia web** — atestiguadas por el dueño, que es la única
  atribución de alta confianza que existe (§9 de tu brief).
- Recorrer directorios públicos concretos y acotados, respetando `robots.txt`.

### Capa C — Búsqueda web (opcional, tú decides)

Para las consultas del tipo "mejores restaurantes de Blanes" hace falta un buscador. Tres
opciones, y quiero que elijas:

1. **SearXNG autoalojado** — 0 €, sin clave, sin tarjeta. Coste: levantar un contenedor
   Docker en tu máquina. Es la única vía verdaderamente gratuita y bajo tu control.
2. **Google Custom Search** — 100 consultas/día gratis, con clave. Suficiente para un
   barrido diario modesto.
3. **Sin buscador** — el sistema funciona solo con las capas A y B, con menos cobertura
   en sectores mal mapeados en OSM.

El sistema se construirá con una interfaz `SearchProvider` para que las tres sean
intercambiables y la ausencia de buscador **degrade, no rompa**.

### Lo que NO voy a construir, y por qué

- **Scraping de Google Maps / Google SERP**: viola las condiciones de uso de Google y se
  bloquea en producción. Que sea técnicamente posible no lo hace viable.
- **Scraping de Instagram / TikTok**: igual. Ambas bloquean el acceso automatizado y
  exigen login. Las redes se detectarán por enlace desde la web oficial, y si no aparecen,
  `NO_VERIFICADO`.

Si aun así los quieres, dímelo y lo hablamos, pero no lo voy a implementar por defecto.

---

## 4. Arquitectura propuesta

```
OBJETIVO ("oportunidades en la Costa Brava")
        │
        ▼
┌───────────────────────┐
│ AutonomousPlanner     │  decide municipios, sectores, subsectores y orden
└───────────┬───────────┘
            ▼
┌───────────────────────┐
│ DiscoveryOrchestrator │  ejecuta consultas contra varias fuentes
└───────────┬───────────┘
            ▼
   ┌────────┴─────────┬──────────────┬─────────────────┐
   ▼                  ▼              ▼                 ▼
OverpassProvider  TurismeCatProvider  DirectoryProvider  SearchProvider
 (OSM, 0€)         (oficial, 0€)      (navegación, 0€)   (opcional)
   └────────┬─────────┴──────────────┴─────────────────┘
            ▼
┌───────────────────────┐
│ CorroborationEngine   │  cruza fuentes, exige ≥2 para VERIFICADO
└───────────┬───────────┘
            ▼
     dedupe → website-resolver → scanner → mobile → competencia → scoring
            ▼
┌───────────────────────┐
│ ResearchMemory        │  qué se investigó, qué consultas funcionaron, errores
└───────────────────────┘
```

Cada proveedor implementa la misma interfaz y declara su coste, fiabilidad y cobertura,
que es lo que pide tu §15.

---

## 5. Cómo se garantiza que el dato sea verificable

Esta es la parte que más me importa, porque es donde ya fallé dos veces contigo.

**Regla de corroboración.** Un negocio es `VERIFICADO` cuando **dos fuentes independientes
coinciden** en su identidad (nombre + dirección, o teléfono, o dominio). Una sola fuente
lo deja en `PROBABLE`. Ninguna, `NO_VERIFICADO`. Esto es más estricto que hoy con Places,
donde una única fuente bastaba.

**El problema del "no tiene web", resuelto de otra forma.** Hoy esa afirmación se apoya en
que Places siempre devuelve el campo. Sin Places, la nueva regla:

> "No tiene web" solo es `VERIFICADO` si **al menos dos fuentes** que sí publican el campo
> web (OSM y el registro oficial, por ejemplo) lo traen vacío **y** una búsqueda dirigida
> por nombre + municipio no devuelve candidato corroborable. Si solo hay una fuente, es
> `PROBABLE`. Si no hay buscador configurado, es `NO_VERIFICADO`, nunca "no tiene".

Es exactamente el error de Smile Dentik y El Gaucho, convertido en regla que el sistema no
puede saltarse.

**Trazabilidad.** Cada campo seguirá llevando su `DataPoint` con fuente, URL, método y
fecha. Añadiré `corroboratedBy: DataSource[]` para que se vea qué fuentes coincidieron.

**Identidad sin `place_id`.** El identificador principal pasa a ser el `business_id`
interno. `gbp_place_id` se conserva como identificador externo opcional. La deduplicación
ya funciona sin él (teléfono, dominio, nombre+dirección) y está probada.

---

## 6. Fases de implementación

| # | Fase | Entrega | Riesgo |
|---|---|---|---|
| 1 | Retirar Places | Proveedor, env var, UI y coste eliminados; abstracción y CSV intactos; tests en verde | Bajo |
| 2 | `OverpassProvider` | Descubrimiento real por municipio y categoría, con tests contra respuestas fijadas | Medio: sintaxis Overpass QL |
| 3 | `TurismeCatProvider` | Alojamientos oficiales de la Costa Brava | Bajo |
| 4 | `CorroborationEngine` | Regla de 2 fuentes + nueva regla de "no tiene web" | **Alto: toca el scoring** |
| 5 | `SearchProvider` | Interfaz + SearXNG y Google CSE; degradación sin buscador | Medio |
| 6 | Generación de consultas | Múltiples variantes por sector/localidad, con detección de agotamiento | Medio |
| 7 | `AutonomousPlanner` | Objetivo → plan de tareas, con cobertura y prioridad adaptativa | Alto |
| 8 | `ResearchMemory` | Qué se investigó, qué consultas funcionaron, errores, correcciones | Medio |
| 9 | Detección de cambios | Re-investigación y `CHANGE_DETECTED` | Bajo |
| 10 | Revisión diaria | Proceso programado con límites de gasto y de volumen | Medio |

Propongo **entregar y validar por fases**, no todo de golpe. Las fases 1–3 ya te dan
descubrimiento autónomo real y gratuito de la Costa Brava.

---

## 7. Lo que necesito que decidas

1. **Buscador**: ¿SearXNG autoalojado (0 €, hay que levantar Docker), Google CSE (clave,
   100/día gratis), o de momento sin buscador?
2. **Alcance de la fase 1**: ¿elimino el código de Places del repositorio, o lo dejo
   desconectado por si algún día vuelves a él? Mi recomendación: eliminarlo. Está en el
   historial de git si hiciera falta.
3. **Cobertura frente a fiabilidad**: OSM tiene menos cobertura que Google en algunos
   sectores. ¿Prefieres menos negocios pero verificados, o incluir también los de una sola
   fuente marcados como `PROBABLE`? Mi recomendación: incluirlos marcados, y que el filtro
   de la interfaz decida.

---

## 8. Riesgos que asumo por delante

- **Cobertura menor que Places.** OSM y el registro oficial no traen todos los negocios.
  Talleres, peluquerías y servicios profesionales estarán peor cubiertos que hoteles y
  restaurantes. Es el precio de no depender de una API de pago, y es un precio real.
- **Overpass no da garantías de servicio.** Es gratis y sin clave, pero puede ralentizarse
  o cortar el acceso. Hay que cachear agresivamente y no depender de una sola fuente.
- **Sin buscador, la generación adaptativa de consultas (§3 de tu brief) queda coja.** Las
  consultas múltiples solo tienen sentido si algo las responde.
- **El scoring cambia en la fase 4.** La regla de "no tiene web" es la que más peso tiene
  en el factor Necesidad. Cambiarla mueve puntuaciones. Lo haré con tests de regresión que
  fijen el comportamiento antes y después, y te enseñaré la diferencia.

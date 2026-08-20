# GTA VI Portal — Análisis y Plan Maestro de Arquitectura

> **Versión:** 1.0 · **Fecha:** 2026-08-20 · **Estado:** propuesta para aprobación — no se ha modificado ni publicado nada en Webflow.
>
> Portal independiente y no oficial dedicado a Grand Theft Auto VI, orientado a público angloparlante. Plataforma principal: **Webflow**. Tecnologías de apoyo: Claude Code, Supabase (solo cuando sea necesario), Cloudflare (solo cuando sea necesario).

---

## 0. Resumen ejecutivo

- **Estado actual:** la conexión MCP con Webflow funciona pero **no hay ningún sitio Webflow accesible** (la API devuelve 0 sitios). Antes de construir hay que crear el sitio o autorizar el existente a la app conectada. Este repositorio (`exito`) contiene otro proyecto sin relación (AI Digital Agency OS); el plan del portal vive en `docs/gta-vi-portal/`.
- **Tesis de producto:** el mercado de webs de GTA VI está saturado de *noticias recicladas*. La diferenciación es una **base de datos verificable** (wiki estructurada con sistema de veracidad de 5 niveles), **herramientas** (mapa, buscador, seguimiento de progreso) y **credibilidad editorial** (fuentes citadas, fechas de verificación). Noticias sí, pero como capa de captación, no como núcleo.
- **Arquitectura:** Webflow es la plataforma única de diseño, CMS, contenido y SEO. Todo lo dinámico se resuelve por capas, en este orden: CMS → componentes → custom code/JS en el propio Webflow → APIs externas detrás de Cloudflare Workers → Supabase solo para datos por usuario (progreso, comunidad) e IA. **Nunca** una web paralela en React/Next.js.
- **Roadmap:** 6 fases, de fundaciones a IA especializada. Cada fase publica valor real y ninguna bloquea a la anterior.

---

## A. Inspección del proyecto Webflow conectado

Realizada el 2026-08-20 vía Webflow MCP (Data API v2, MCP 2.0.1):

| Comprobación | Resultado |
|---|---|
| Autenticación MCP | ✅ Correcta (el servidor responde) |
| `list_sites` | ⚠️ **0 sitios** (`total: 0`) |
| Páginas, colecciones CMS, componentes, variables, assets | No inspeccionables — no hay sitio al que apuntar |
| Sesión de Designer activa | No disponible (las herramientas de Designer requieren el Designer abierto con la app MCP) |

**Interpretación.** La autorización OAuth de la app conectada no incluye ningún sitio. Causas típicas:
1. El sitio aún no existe (proyecto nuevo).
2. El sitio existe pero al autorizar la app no se le concedió acceso a ese sitio/workspace.

**Acción requerida (usuario, ~5 min):** en Webflow → *Workspace Settings → Apps* (o al reinstalar la app de Claude/MCP), conceder acceso al sitio del portal; si no existe, crear un sitio en blanco (no usar plantilla) y concederle acceso. Sin esto no se puede ejecutar ninguna fase.

## B. Qué existe actualmente

- **Webflow:** nada accesible (ver A). Asumimos partida desde cero: sin páginas, sin CMS, sin design system, sin dominio conectado confirmado.
- **Repositorio `exito`:** proyecto Next.js 16 + Supabase de una agencia digital ("AI Digital Agency OS"). **No se toca.** Este repo puede servir de monorepo de soporte del portal (custom code versionado, scripts de automatización, docs) bajo carpetas propias, o el portal puede tener repo propio más adelante (recomendado: repo propio en Fase 1 para separar ciclos de vida).
- **Dominio, analítica, newsletter, redes:** sin evidencia de que existan. Se tratan como decisiones pendientes (§L).

---

## C. Arquitectura de producto

### C.1 Pilares (en orden de prioridad estratégica)

1. **Base de datos / wiki verificable** — vehículos, personajes, armas, localizaciones, misiones (post-lanzamiento), con el sistema de veracidad como rasgo estructural. Es el activo SEO evergreen y lo más difícil de copiar.
2. **Páginas pilar de alta intención** — release date, mapa, trailers, ediciones/precio, requisitos. Capturan el 80 % del volumen de búsqueda pre-lanzamiento.
3. **Noticias** — frecuencia y frescura para Google News/Discover y retorno recurrente. Nada de granja de contenido: cada pieza cita fuentes.
4. **Herramientas** — mapa interactivo, buscador, seguimiento de progreso (post-lanzamiento), calculadoras/checklists. Generan enlaces entrantes y retención.
5. **Audiencia propia** — newsletter y comunidad: el seguro frente a los vaivenes de Google.
6. **IA especializada** — asistente que responde solo con el contenido verificado del sitio (fase final; depende de que la base de datos exista).

### C.2 Sistema de veracidad (regla transversal, no negociable)

Toda afirmación sobre GTA VI lleva un estado de una taxonomía cerrada de 5 niveles. Es un **campo Option obligatorio** en cada colección wiki y un componente visual (badge) presente en cards, fichas y tablas:

| Estado | Definición operativa | Color semántico |
|---|---|---|
| `Confirmed` | Declarado por Rockstar/Take-Two o material oficial (trailers, web, notas de inversores) | Verde |
| `Observed` | Visible en material oficial pero no declarado explícitamente (análisis frame a frame) | Azul |
| `Reported` | Publicado por medios reputados con historial (Bloomberg/Schreier, etc.), sin confirmación oficial | Ámbar |
| `Rumor` | Origen no verificable (foros, insiders sin historial) | Naranja/violeta |
| `Debunked` | Desmentido oficialmente o demostrado falso | Rojo |

Reglas editoriales asociadas:
- Cada ficha lleva **fuentes citadas** (colección Sources referenciada) y **fecha de última verificación** visible.
- Los rumores jamás se titulan como hechos; el estado aparece en el titular social/SEO cuando aplica ("Report:", "Rumor:").
- Página pública **"How we verify"** + política editorial: es contenido E-E-A-T, no burocracia.
- **Política de filtraciones:** no se publica ni se enlaza material robado (p. ej. el hack de 2022). Se puede informar *sobre* el hecho noticioso sin redistribuir el material. Reduce riesgo DMCA y es coherente con la marca de credibilidad.
- Disclaimer permanente en footer y About: sitio de fans independiente, sin afiliación con Rockstar Games ni Take-Two Interactive; marcas citadas con uso nominativo.

### C.3 Diferenciación frente al mercado

- GTABase/GTA6 fan sites compiten en volumen; ninguno expone un sistema de veracidad explícito ni fechas de verificación → esa es la cuña.
- Actualización con **changelog visible** en páginas pilar ("Last updated + qué cambió") — Google premia frescura real, los usuarios premian honestidad.
- Contenido escrito por humanos con criterio; la IA (Claude Code) se usa para estructura, datos, QA y automatización, no para generar masa de texto genérico (objetivo 10 del brief).

---

## D. Estructura de páginas (arquitectura de información)

Restricción de Webflow que condiciona el diseño: las páginas de colección viven en `/{slug-de-colección}/{slug-de-item}` (un solo nivel, una plantilla por colección). Las páginas estáticas sí admiten carpetas.

### D.1 Árbol de páginas

```
/                       Home — hero + últimas noticias + countdown + accesos a pilares
/news                   Hub de noticias (filtros por categoría)
/news/{slug}            Artículo (plantilla CMS)
/database               Hub de la wiki (entrada a todas las bases de datos)
/vehicles               Índice filtrable (clase, marca, estado de veracidad)
/vehicles/{slug}        Ficha de vehículo (plantilla CMS)
/characters             Índice de personajes
/characters/{slug}      Ficha de personaje
/weapons                Índice de armas
/weapons/{slug}         Ficha de arma
/locations              Índice de localizaciones (por región)
/locations/{slug}       Ficha de localización
/missions               Índice de misiones (se llena post-lanzamiento)
/missions/{slug}        Ficha/guía de misión
/guides                 Hub de guías
/guides/{slug}          Guía (plantilla CMS)
/map                    Mapa interactivo (página estática + custom code)
/trailers               Trailers y análisis (plantilla CMS "Media")
/trailers/{slug}        Análisis de un trailer/material oficial
/gta-6-release-date     PÁGINA PILAR (estática, evergreen, changelog)
/gta-6-map              PÁGINA PILAR (SEO del mapa; enlaza a /map como herramienta)
/gta-6-editions         PILAR: ediciones, precio, preorder (afiliación futura)
/gta-6-system-requirements  PILAR (cuando aplique/PC)
/faq                    FAQ estructurada (CMS + schema FAQPage)
/search                 Resultados de búsqueda
/newsletter             Landing de captación
/authors/{slug}         Ficha de autor (E-E-A-T)
/about, /editorial-policy, /how-we-verify, /contact
/legal/privacy, /legal/cookies, /legal/terms, /legal/dmca
/progress               (Fase post-lanzamiento) tracker de progreso
404, 401, /style-guide (interna, draft)
```

### D.2 Navegación

- **Navbar:** News · Database (mega-menú: Vehicles, Characters, Weapons, Locations, Missions) · Map · Guides · Release Date · buscador (icono) · CTA Newsletter.
- **Footer:** columnas por pilar + legal + disclaimer no-afiliación + redes.
- **Breadcrumbs** en todas las plantillas CMS (con schema BreadcrumbList).
- Los índices usan **filtros client-side** (Finsweet Attributes) sobre listas CMS: cero backend.

---

## E. Colecciones CMS

Diseñadas para el plan **CMS (20 colecciones)** con ruta de crecimiento a **Business (40)**. 14 colecciones núcleo + 3 opcionales. Campos comunes a toda colección wiki (❖): `Status` (Option 5 niveles), `Status note` (texto corto), `Sources` (multi-ref → Sources), `Last verified` (fecha), `Summary` (texto plano para cards/meta), `Hero image` + `Alt`, `SEO title/description override`.

| # | Colección | Campos clave (además de ❖ donde aplique) | Notas |
|---|---|---|---|
| 1 | **News Articles** | Título, Rich text, Excerpt, Categoría (ref), Autor (ref), Sources (multi-ref), Fecha publicación, Updated, Featured (switch), Tags (multi-ref), Related entities (multi-ref a colecciones wiki vía Tags) | El estado (Report/Rumor) se refleja en categoría/prefijo de titular |
| 2 | **News Categories** | Nombre, descripción, color | News, Report, Rumor Watch, Analysis, Official |
| 3 | **Authors** | Nombre, bio, foto, rol, redes, E-E-A-T links | Página pública por autor |
| 4 | **Sources** | Nombre del medio/origen, URL, tipo (Official/Media/Insider/Community), fiabilidad (Option), fecha | Reutilizable desde cualquier colección; base del sistema de citas |
| 5 | **Vehicles** ❖ | Clase (ref), Marca (ref), inspiración real (texto), imágenes (multi-image), aparición (multi-ref Media), specs estructuradas (velocidad/asientos/etc. como campos number/text), Notes (rich) | |
| 6 | **Vehicle Classes** | Nombre, descripción, icono | Sports, Muscle, SUV, Boats, Aircraft… |
| 7 | **Vehicle Brands** | Nombre, lore, equivalente real | Vapid, Declasse… |
| 8 | **Characters** ❖ | Rol (Option: Protagonist/Antagonist/Supporting/Rumored), actor/actriz (texto), afiliaciones (texto o ref), primera aparición (ref Media), relaciones (multi-ref Characters), Bio (rich) | |
| 9 | **Weapons** ❖ | Categoría (Option), inspiración real, stats estimadas, imágenes, aparición (multi-ref Media) | |
| 10 | **Locations** ❖ | Región (ref), tipo (Option: City/District/Landmark/Business…), equivalente real (texto), coordenadas mapa (`lat`,`lng` como Number — alimentan el mapa), imágenes, aparición (multi-ref Media) | |
| 11 | **Regions** | Nombre (Leonida, Vice City, Port Gellhorn…), descripción, mapa parcial | Jerarquía ligera sin anidar URLs |
| 12 | **Missions** ❖ | Acto/capítulo, giver (ref Characters), localización (ref), recompensas, walkthrough (rich), orden (number), checklist items (para el tracker) | Vacía hasta el lanzamiento; el esquema se deja listo |
| 13 | **Guides** | Título, Rich text, Categoría (Option), dificultad, tiempo lectura, Autor (ref), Related (multi-ref), Updated | |
| 14 | **Media / Trailers** | Título, tipo (Trailer/Screenshot set/Official post), fecha oficial, URL vídeo, análisis (rich), entidades detectadas (multi-refs) | Ancla del contenido "Observed" |
| 15 | **FAQs** | Pregunta, respuesta (rich), categoría, orden | Render con schema FAQPage |
| 16 | *Tags* (opcional) | Nombre | Costura transversal para "Related" |
| 17 | *Glossary* (opcional, F3+) | Término, definición | |

**Decisiones de modelado:**
- Multi-referencias con moderación (límites de Webflow: ~60 campos/colección, límites de refs por colección y de listas anidadas). Las relaciones complejas (p. ej. "todos los vehículos vistos en el Trailer 2") se resuelven con multi-ref *desde* Media hacia entidades, no en ambos sentidos.
- Los items totales previstos (< 3.000 en 2 años) caben en plan CMS; Business da margen (10k) y habilita site search nativo.
- `lat`/`lng` en Locations es lo que permite que el mapa sea 100 % alimentado por CMS sin base de datos externa.

---

## F. Sistema de componentes (Webflow Components)

Construidos como **componentes nativos de Webflow con props**, sobre clases utilitarias mínimas y variables (§G). Nomenclatura tipo Client-First simplificada.

**Estructura global**
- `Navbar` (mega-menú Database, buscador, CTA) · `Footer` · `AnnouncementBar` (countdown/breaking)

**Confianza y credibilidad (los distintivos del sitio)**
- `StatusBadge` — 5 variantes por prop; se usa en cards, fichas y dentro de rich text vía embed
- `FactBox` — "Quick facts" lateral de ficha (campos clave + badge + last verified)
- `SourceList` — bloque de citas numeradas (lista CMS anidada de Sources)
- `LastUpdated` + `Changelog` — para páginas pilar
- `DisclaimerNote` — no-afiliación / spoilers

**Cards y listados**
- `NewsCard` (variantes: featured/standard/compact) · `EntityCard` (vehículo/personaje/arma/localización — imagen, nombre, badge, clase) · `GuideCard` · `AuthorByline`
- `FilterBar` (checkbox/segmented, Finsweet Attributes) · `LoadMore`

**Contenido de ficha/artículo**
- `SpecTable` (pares clave-valor) · `TOC` (auto-generada por JS desde h2/h3) · `RelatedGrid` (multi-ref) · `Breadcrumbs` · `MediaEmbed` (YouTube lite-embed para performance) · `Lightbox` galería

**Conversión y monetización**
- `NewsletterCTA` (inline + footer + slide-in) · `AdSlot` (variantes 728×90/300×250/320×100, **altura reservada fija** para CLS ≈ 0) · `AffiliateCard` (producto, precio, CTA, disclosure)

**Utilidades**
- `SectionHeader` · `HeroHome` · `HeroEntity` · `EmptyState` ("No confirmed data yet — here's what we know") · `CountdownTimer` (JS)

Página interna `/style-guide` (draft) con todos los componentes instanciados: sirve de QA visual y de contrato para Claude Code al automatizar.

---

## G. Sistema visual

**Dirección de arte:** "Neon noir de Florida" — identidad propia inspirada en la atmósfera (atardeceres saturados, neón, humedad tropical) **sin copiar el trade dress de Rockstar** (ni logo VI, ni tipografías oficiales, ni artwork oficial como identidad). Dark-first: el público gaming lo espera y hace vibrar el neón.

**Tokens (Webflow Variables, colección "Core" + modo claro futuro):**
- **Color:** `bg/base` #0B0E14 aprox., `bg/surface`, `bg/raised`; `text/primary`, `text/secondary`; `brand/primary` (magenta-rosa neón), `brand/secondary` (aqua), `brand/accent` (naranja atardecer); semánticos de estado: `status/confirmed|observed|reported|rumor|debunked` (mapean al StatusBadge); `utility/border`, `utility/overlay`.
- **Tipografía:** display condensada/expandida con carácter (p. ej. Archivo Expanded o similar vía Google Fonts, self-hosted por Webflow) + `Inter` para cuerpo + mono para datos/specs. Escala fluida con `clamp()` (variables de tamaño: display, h1–h4, body-lg, body, small, caption).
- **Espaciado:** escala 4px (4–128) como variables de tamaño; contenedor máx. 1200–1280px; grid 12 col desktop / 4 mobile.
- **Radios y elevación:** radius sm/md/lg/full; sombras sutiles + glow de neón solo en interactivos.
- **Motion:** micro-interacciones ≤ 200 ms, `prefers-reduced-motion` respetado; nada de animaciones pesadas de scroll en plantillas de contenido (LCP primero).

**Accesibilidad:** contraste AA sobre fondo oscuro verificado por token (los neones se usan sobre superficies oscuras, texto largo siempre en `text/primary`); focus visible; los badges de estado llevan texto, nunca solo color.

---

## H. Estrategia SEO

### H.1 Técnico (Webflow lo cubre bien de serie)
- SSL, CDN global, HTML estático renderizado (sin problemas de JS rendering), sitemap.xml automático + control por página/ítem, robots.txt editable, 301 desde panel, canonical global.
- **Metas dinámicas** por plantilla CMS (title/description desde campos con override).
- **Schema.org vía custom code por plantilla, con campos CMS inyectados:** `NewsArticle` (news), `Article` + `VideoGame` (contexto en wiki), `FAQPage`, `BreadcrumbList`, `Organization`/`WebSite` (+ `SearchAction`) globales, `Person` en autores. Herramienta MCP disponible para escribir JSON-LD por página en bloque.
- **Core Web Vitals:** imágenes AVIF/WebP (compresión vía API de assets), lazy-load nativo, lite-embed para YouTube, alturas reservadas en AdSlots (CLS), sin librerías JS pesadas en plantillas de contenido, fuentes con `font-display: swap`. Objetivo: LCP < 2 s móvil en plantillas de contenido.

### H.2 Contenido y topical authority
- **Clusters:** (1) Release date & editions, (2) Map & Leonida, (3) Characters (Jason/Lucia como cabezas), (4) Vehicles, (5) Weapons, (6) Gameplay/mechanics, (7) Trailers/media analysis, (8) Plataformas/технical. Cada cluster = página pilar estática + fichas CMS + noticias que enlazan al pilar.
- **Interlinking estructural:** breadcrumbs + RelatedGrid (multi-ref) + enlaces pilar↔fichas: el grafo interno se construye solo desde el CMS.
- **News SEO:** cadencia realista y constante (mejor 3–5/semana verificadas que 20 refritos), `NewsArticle` schema, autores con página, fechas honestas de update → apto para Google News/Discover.
- **E-E-A-T:** políticas públicas (editorial, verificación, correcciones), autores reales, About sólido, citas salientes a fuentes primarias (enlazar fuera no penaliza; da confianza).
- **Freshness comprobable:** páginas pilar con changelog visible; los updates reales son el mejor señuelo de re-crawl.
- Medición: GA4 + Search Console desde el día 1; Webflow Analyze opcional más adelante.

---

## I. Arquitectura técnica

### I.1 Principio de capas (regla fundamental del brief)

Ante cada funcionalidad, se evalúa en este orden y solo se sube de capa con justificación:

```
1. Webflow nativo (páginas, CMS, formularios, componentes)
2. Ecosistema estándar Webflow (Finsweet Attributes: filtros, load-more, nest)
3. Custom code en Webflow (JS vanilla, por página o global, versionado en Git)
4. Servicio externo embebido (Cloudflare Worker como API; widget en página Webflow)
5. Supabase (solo datos por usuario / IA)
```

### I.2 Mapa de soluciones por funcionalidad

| Funcionalidad | Capa | Solución | Por qué no basta Webflow nativo |
|---|---|---|---|
| Noticias, wiki, guías, FAQ | 1 | CMS + plantillas | — (es el caso ideal de Webflow) |
| Índices filtrables | 2 | Finsweet Attributes sobre listas CMS | El filtrado nativo de listas es limitado; Finsweet es el estándar del ecosistema, client-side, sin backend |
| Buscador v1 | 1/3 | Site Search nativo (plan Business) con página de resultados a medida; si no hay Business: índice JSON generado desde la Data API (GitHub Action) + Fuse.js | El search nativo no tiene facetas; suficiente para v1 |
| Buscador v2 (facetas/instant) | 4 | Algolia o Typesense; sync CMS→índice vía webhook `collection_item_published` → Cloudflare Worker | Búsqueda instantánea con facetas no existe en Webflow |
| Mapa interactivo | 3 | Página estática + Leaflet/MapLibre con tiles propios (artwork del mapa por zoom); marcadores leídos de la colección Locations (lista CMS oculta con data-attributes `lat/lng` → JS) | Webflow no tiene mapas; así el mapa se edita desde el CMS sin tocar código |
| Countdown, TOC, lightbox, lite-embeds | 3 | JS vanilla global (~pocos KB), versionado en Git y minificado | Trivial, sin dependencias |
| Newsletter | 1+4 | Form Webflow → webhook → proveedor (Beehiiv/MailerLite) o embed directo del proveedor | Webflow no envía emails masivos |
| Seguimiento de progreso v1 (post-lanzamiento) | 3 | Checklists por misión/coleccionable en `localStorage` (sin cuenta, cero fricción) | No requiere backend y funciona offline |
| Progreso v2 (sincronizado) + comunidad | 5 | Supabase (Auth + Postgres + RLS); widget JS en páginas Webflow contra Supabase JS SDK; comentarios propios o Hyvor Talk como atajo | **Webflow User Accounts está descontinuado/sunset** — no apostar por él; los datos por usuario exigen base de datos real |
| IA especializada GTA VI | 4+5 | Cloudflare Worker (o Supabase Edge Function) como proxy a la API de Claude + RAG sobre el contenido del CMS (sync vía webhooks a tabla/vector store en Supabase); widget de chat embebido; **responde solo con contenido del sitio y cita el estado de veracidad** | Requiere servidor (API keys nunca en cliente) y almacén vectorial |
| Automatización editorial | — | Claude Code + Data API/MCP: alta de items, QA de veracidad (detectar fichas sin fuente o sin verificar > 60 días), schema JSON-LD en bloque, compresión de imágenes, redirects | Productividad; la API de Webflow lo permite todo |

### I.3 Cloudflare: cuándo sí y cuándo no

- **No** poner el dominio principal proxied (orange-cloud) delante del hosting de Webflow: Webflow ya sirve por su propio CDN y el doble proxy causa problemas de SSL/caché (soportado solo en Enterprise). DNS-only para el apex/www.
- **Sí** usar Cloudflare para: DNS, y un subdominio `api.{dominio}` con **Workers** (buscador v2, proxy IA, webhooks del CMS, generación del índice de búsqueda) y R2 si hiciera falta almacenar índices/tiles del mapa.

### I.4 Repos y flujo de trabajo

- Repo del portal (recomendado separado): `/custom-code` (JS/CSS por página y global, con build mínimo y hash), `/workers` (APIs), `/automation` (scripts Data API), `/docs` (este plan, decisiones, runbooks de contenido).
- El custom code se pega en Webflow como snippet que **carga el bundle versionado** (jsDelivr/Cloudflare Pages) → el código real vive en Git y se revisa con PRs; Webflow solo tiene el loader.
- Publicación: staging en `*.webflow.io` para QA; producción manual (o vía API cuando haya confianza). Webhooks (`site_publish`, `collection_item_published`) disparan sincronizaciones (índice de búsqueda, RAG).

## J. Riesgos y limitaciones (Webflow y generales)

| # | Riesgo/limitación | Impacto | Mitigación |
|---|---|---|---|
| 1 | **Límites CMS** por plan (items ~2k CMS/10k Business; nº colecciones 20/40; ~60 campos y refs limitadas por colección; listas anidadas restringidas; 100 items por lista) | Medio | Modelo de §E diseñado dentro de límites; Business como plan objetivo; paginación/load-more Finsweet |
| 2 | **Sin lógica de servidor** (ni queries relacionales complejas, ni cron) | Medio | Capas 4–5 (§I); relaciones precalculadas como multi-ref |
| 3 | **Site search nativo pobre** (sin facetas; requiere Business) | Medio | v1 nativo o Fuse.js; v2 Algolia/Typesense |
| 4 | **User Accounts/Memberships descontinuado** | Alto si se ignora | Supabase Auth para todo lo de usuario (decisión ya tomada en §I) |
| 5 | **Rate limits Data API** (60–120 req/min) | Bajo | Automatizaciones con backoff; ya previsto en scripts |
| 6 | **Publicar es global** (cambios de diseño y contenido salen juntos al publicar sitio) | Medio | Disciplina de staging; publicar items CMS individualmente vía API; ventanas de publicación |
| 7 | **Custom code con límites de tamaño** por página/sitio | Bajo | Loader + bundle externo versionado (§I.4) |
| 8 | **Cloudflare proxy incompatible** con hosting Webflow (no Enterprise) | Bajo | DNS-only + Workers en subdominio (§I.3) |
| 9 | **Vendor lock-in Webflow** (export limitado del CMS relacional) | Medio | Backups automatizados del CMS vía Data API (JSON en Git/R2, semanal) |
| 10 | **Legal/PI:** marcas y material de Rockstar/Take-Two; historial de C&D a proyectos de fans que cruzan líneas | Alto | Uso nominativo, disclaimer, sin assets oficiales como identidad, política anti-leaks (§C.2), páginas legales + DMCA agent, dominio sin pretensión de oficialidad |
| 11 | **Riesgo de calendario** (retrasos del juego ya ocurridos; picos de tráfico en anuncios) | Medio | El modelo pre-lanzamiento (pilares + veracidad) rinde igual con retrasos; Webflow escala lecturas sin trabajo propio |
| 12 | **AdSense/ad networks + CWV** | Medio | AdSlots con altura fija; lazy en viewport; medir antes/después |
| 13 | **Contenido IA masivo penalizable** | Alto si se ignora | Política editorial: IA solo asiste (§C.3); QA humano en todo lo publicado |

## K. Roadmap por fases

Cada fase termina con algo publicado y medible. Sin fechas rígidas (dependen de tu dedicación); el orden sí es vinculante porque cada fase apoya la siguiente.

**F0 — Fundaciones (bloqueante, corta)**
Acceso de la app al sitio Webflow (§A) · decisión de dominio y plan (objetivo: CMS plan para arrancar, Business cuando llegue el search/tráfico) · creación del sitio en blanco · GA4 + Search Console · repo del portal + carpeta docs.
*Salida: sitio accesible por MCP, dominio conectado, analítica activa.*

**F1 — Design system + esqueleto editorial**
Variables/tokens (§G) · componentes núcleo (§F) · Navbar/Footer · Home v1 · colecciones News/Categories/Authors/Sources · plantilla de artículo con schema · páginas legales y de credibilidad (About, Editorial Policy, How we verify) · newsletter v1 (embed) · /style-guide.
*Salida: portal de noticias publicable con sistema de veracidad operativo en news.*

**F2 — Base de datos wiki (el diferencial)**
Colecciones Vehicles/Brands/Classes, Characters, Weapons, Locations/Regions, Media/Trailers, FAQs · plantillas de ficha (FactBox, SpecTable, SourceList, Related) · índices filtrables (Finsweet) · páginas pilar (release date, map SEO, editions) · carga inicial de contenido verificado (todo lo Confirmed/Observed de trailers y material oficial) · JSON-LD en bloque.
*Salida: la wiki navegable y filtrable con decenas de fichas citadas.*

**F3 — Herramientas v1**
Mapa interactivo (Leaflet + Locations CMS) · buscador v1 · countdown/TOC/lightbox pulidos · backups automatizados del CMS · automatizaciones editoriales Claude Code (QA de veracidad, fichas sin fuente).
*Salida: /map y /search vivos; rutina editorial semiautomatizada.*

**F4 — Monetización v1 + growth**
AdSlots activos (AdSense o red disponible; upgrade a Raptive/Mediavine al alcanzar umbral de tráfico) · afiliación (preorders/ediciones, hardware) con disclosure · newsletter con automatización de bienvenida · social embeds/OG pulidos.
*Salida: ingresos > 0 y pipeline de crecimiento medible.*

**F5 — Usuarios: progreso y comunidad (ligada al lanzamiento del juego)**
Progreso v1 localStorage (checklists de misiones/coleccionables desde CMS) → Supabase Auth + sync (v2) · comentarios (atajo: Hyvor Talk; propio: Supabase) · Discord como comunidad inicial desde F2 (barato y fuerte) · colección Missions poblada al ritmo del juego.
*Salida: usuarios registrados propios y retención post-lanzamiento.*

**F6 — IA especializada**
RAG sobre el CMS (sync por webhooks → Supabase/pgvector) · Worker proxy a Claude API · widget de chat que responde citando fichas y su estado de veracidad · límites de uso y coste controlados.
*Salida: "GTA VI AI" como feature única del portal.*

## L. Decisiones que necesito de ti (para arrancar F0)

1. **Acceso Webflow:** ¿existe ya un sitio? Si sí, autoriza la app al sitio; si no, ¿lo creo yo en blanco cuando la app tenga acceso al workspace?
2. **Dominio:** ¿tienes dominio comprado? (recomendación: nombre de marca propia + término genérico, sin pretender oficialidad).
3. **Plan Webflow:** confirmar arranque en CMS plan (~$23–29/mes) con upgrade a Business previsto.
4. **Repo:** ¿repo nuevo dedicado para el portal, o carpetas dentro de `exito`? (recomiendo repo nuevo).
5. **Newsletter:** preferencia de proveedor (Beehiiv / MailerLite / ConvertKit) — afecta a F1.
6. **Marca:** ¿hay nombre/identidad decididos o lo trabajamos como primer entregable de F1?

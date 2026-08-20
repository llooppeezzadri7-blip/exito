# Plan Maestro v2 — "El sitio de referencia mundial de GTA VI"

> **Versión:** 2.0 · **Fecha:** 2026-08-20 · Sustituye la sección estratégica del plan v1; lo construido en F0–F1 se conserva y se audita aquí.
> **Contexto duro:** lanzamiento 19-11-2026 → **~91 días**. Todo el plan está calibrado a ese calendario.

---

## 0. La tesis (y una advertencia honesta del responsable de producto)

**Tesis:** ganaremos siendo *el lugar donde la información de GTA VI está verificada, estructurada y conectada* — no otra web de noticias. El posicionamiento es "the answer engine for GTA 6": buscas cualquier cosa del juego → nuestra página responde, con estado de veracidad, fuente y fecha.

**Advertencia:** la arquitectura no será nuestro cuello de botella — lo será la **velocidad de producción de contenido de calidad**. Con 91 días, la estrategia correcta es *profundidad concentrada*: dominar 6–8 clusters con las mejores páginas del mercado antes del lanzamiento, y tener las plantillas listas para el "gold rush" de guías del día 1. Mil páginas mediocres pierden contra cien páginas definitivas. Todo el roadmap respeta este principio.

---

## 1. Auditoría de lo construido (F0–F1)

### Lo que está bien y se conserva
- **CMS relacional** (News ↔ Categories ↔ Authors ↔ Sources): es la base correcta; Sources como colección de citas es exactamente lo que pide E-E-A-T.
- **Tokens + sistema de clases + componentes Navbar/Footer**: el design system escala; nada que rehacer.
- **Veracidad como datos** (badges + Sources): la dirección es correcta; en v2 se eleva a colección propia (Claims).
- Staging publicado y funcional.

### Problemas actuales y correcciones (por orden de importancia)
| # | Problema | Corrección | Cuándo |
|---|---|---|---|
| 1 | **Plan free bloquea todo el F1 real**: 2 páginas estáticas (ya usadas), sin custom code de sitio, 50 items CMS | Contratar **plan CMS** (~23–29 $/mes) | Ya — es la decisión que desbloquea el resto |
| 2 | Fuentes vía Embed por página (render-blocking duplicado) | Mover el `<link>` de Google Fonts al head del sitio | Al tener plan CMS |
| 3 | Home v1 es un placeholder correcto pero no la Home cinematográfica | Rebuild completo (blueprint en §5); navbar/footer se conservan | F1 v2 |
| 4 | News Articles sin campo de tipo editorial ni "Last verified" | Añadir Option "Article Type" (News/Report/Rumor Watch/Analysis/Official) + DateTime "Last verified" | F1 v2 |
| 5 | Sin páginas legales ni de credibilidad (About, Editorial Policy, How We Verify, Privacy, Cookies, Terms, Contact, Corrections) | Crearlas — requisito AdSense y E-E-A-T | F1 v2, primera tanda tras plan |
| 6 | Sin JSON-LD, sin OG image, sin favicon, sin 404 propia | Añadir por plantilla (herramienta de schema en bloque disponible) | F1 v2 |
| 7 | Nombre de sitio "gtaiv" (se lee GTA IV) y subdominio confuso | Renombrar al cerrar marca | Con la decisión de marca |
| 8 | /style-guide indexable | Excluir de sitemap + noindex | F1 v2 |
| 9 | Sin OG/social defaults ni Search Console/GA4 | Alta al conectar dominio | F1 v2 |

Nada de lo anterior es trabajo tirado: son las piezas que faltaban por plan y por fase.

---

## 2. Arquitectura de información v2 (entity-first)

Principio: **cada entidad del juego es una página; cada página es un nodo conectado**. Google construye su grafo de entidades — nosotros le damos uno ya hecho: personajes ↔ localizaciones ↔ vehículos ↔ misiones ↔ trailers ↔ afirmaciones (claims) ↔ fuentes.

### Mapa de URLs (final propuesto)

```
/                          Home "answer engine"
/news/                     Hub noticias · /news/{slug}
/characters/               Índice · /characters/{slug}         "lucia gta 6", "jason gta 6"
/locations/                Índice · /locations/{slug}          "vice city gta 6", "leonida"
/vehicles/                 Índice · /vehicles/{slug}           "gta 6 cars"
/weapons/                  Índice · /weapons/{slug}
/missions/                 Índice · /missions/{slug}           (post-lanzamiento)
/activities/               Índice · /activities/{slug}         (post-lanzamiento)
/map                       Mapa interactivo (herramienta)
/database                  Hub visual de todas las bases de datos
/guides/                   Hub · /guides/{slug}                gold rush post-lanzamiento
/trailers/                 Hub media · /trailers/{slug}        análisis con timestamps
/tracker                   CLAIM TRACKER (moat #1)
/tracker/confirmed         Vista: todo lo confirmado
/tracker/rumors            Vista: rumores activos
/tracker/debunked          Vista: desmentidos
/timeline                  Cronología completa de hechos (moat #2)
/release-date              PILAR (la query #1 del nicho)
/platforms                 PILAR consolas + estado PC          "gta 6 pc" = enorme
/editions                  PILAR ediciones/precio/preorder     afiliación inmediata
/system-requirements       (solo cuando haya datos reales de PC — ver §4 anti-thin)
/faq                       Preguntas frecuentes agrupadas (schema FAQPage)
/search                    Resultados de búsqueda
/authors/{slug} · /about · /editorial-policy · /how-we-verify · /corrections · /contact
/legal/privacy · /legal/cookies · /legal/terms · /newsletter · 404
```

Decisiones razonadas frente a tu borrador:
- **`/rumors` y `/confirmed` NO son carpetas de contenido** sino vistas del Claim Tracker (`/tracker/*`). Si fueran secciones separadas duplicaríamos contenido (un rumor confirmado tendría que "mudarse"); como vistas de una misma base de datos, una afirmación cambia de estado sin cambiar de URL y su historial se conserva. Mejor SEO (sin duplicados), mejor producto.
- **Entidades en raíz** (`/characters/...`, no `/database/characters/...`): URLs más cortas, mejor CTR, y encaja con la restricción de Webflow (colección = un nivel). `/database` queda como hub de navegación.
- **`/platforms` en vez de página PC suelta**: el estado de PC es la pregunta más buscada sin respuesta oficial — se responde con el sistema de veracidad, no con invenciones. `/system-requirements` no se publica hasta que existan requisitos reales (anti-thin content).
- Breadcrumbs en todo: Home → Sección → Página (con schema BreadcrumbList).

### Modelo de interlinking (automático desde CMS)
1. **Hub → spoke:** cada pilar enlaza a sus fichas; cada ficha, a su hub (breadcrumb).
2. **Related multiref:** cada ficha muestra entidades relacionadas.
3. **"Appears in":** la colección Media (trailers) referencia entidades con timestamp → cada ficha muestra "visto en Trailer 2 · 0:41" con enlace; cada análisis de trailer enlaza a decenas de fichas. Es la costura del grafo.
4. **Claims → todo:** cada afirmación referencia las entidades a las que afecta → las fichas muestran sus claims activos.
5. **Cero páginas huérfanas por construcción:** una página solo se publica si es alcanzable desde un hub (regla editorial).

---

## 3. CMS v2

### Presupuesto de colecciones (límite 20 en plan CMS; 40 en Business)

Existentes (4): News Articles · News Categories · Authors · Sources — se conservan; News gana `Article Type` (Option) y `Last verified`.

Nuevas F1 (2): **Claims** · **Timeline Events** — el corazón del moat.

Nuevas F2 (9): Characters · Vehicles · Vehicle Classes · Locations · Regions · Weapons · Media/Trailers · Guides · FAQs.

Post-lanzamiento F4 (2–3): Missions · Activities (+ Glossary opcional) → total ~18; Brands de vehículos arranca como campo Option dentro de Vehicles (se promociona a colección en Business si el lore lo justifica).

### Esquema de las colecciones moat

**Claims (Claim Tracker):** Name (la afirmación, redactada como hecho verificable) · Status (Option 5 niveles) · Evidence summary (texto) · Evidence link/timestamp · First reported (fecha) · Last verified (fecha) · Status history (rich text: log de cambios con fechas) · Sources (multiref) · Related characters/locations/vehicles (multirefs, se añaden en F2) · Category (Option: Gameplay/Map/Characters/Release/Platforms/Story/Online) · Featured (switch).

**Timeline Events:** Name · Date · Event type (Option: Official announcement/Trailer/Statement/Credible report/Delay/Community) · Summary · Sources (multiref) · Related claim (ref) · Major (switch, para la vista comprimida).

**Campos comunes wiki (❖ — igual que v1):** Status, Status note, Sources, Last verified, Summary, imágenes+alt, overrides SEO. Media/Trailers añade "Appearances" (multirefs + campo de timestamps).

---

## 4. Estrategia SEO

### Prioridades de keywords (por fase, intención y viabilidad)

**Tier 1 — atacar YA (pre-lanzamiento, alto volumen, evergreen):**
`gta 6 release date` (la query reina — pilar con countdown + changelog) · `gta 6 map` / `leonida` / `vice city` · `gta 6 characters` / `lucia` / `jason` · `gta 6 trailer` / `trailer 2 breakdown` · `gta 6 price` / `editions` / `preorder` · `gta 6 pc` / `is gta 6 coming to pc` · `gta 6 cars` · `gta 6 news`. → 8 clusters, ~30–40 páginas definitivas.

**Tier 2 — semanas previas al lanzamiento:** `gta 6 preload` · `file size` · `install size` · `early access` · `review` (post-embargo) · `how long is gta 6` · `gta 6 map size comparison` · `day one patch`.

**Tier 3 — gold rush post-lanzamiento (preparar plantillas AHORA):** `how to ___ in gta 6` · walkthroughs de misión · collectibles · `gta 6 cheats` · builds/dinero/armas. Quien publique guías estructuradas más rápido en la semana 1 gana años de autoridad. Las plantillas, el esquema de Missions y el flujo editorial deben estar listos en octubre.

**No atacar:** queries de otros GTA (diluye la entidad del sitio), material filtrado (política anti-leaks), y páginas "para existir" sin sustancia.

### Reglas anti-basura (innegociables, escritas para poder crecer a miles de páginas)
1. **Barrera de publicación de fichas:** una entidad solo publica su página con ≥1 claim con fuente + resumen único ≥150 palabras + imagen con alt. Lo demás queda en draft (visible solo como fila del índice). Nada de miles de stubs autogenerados.
2. **Una entidad, una URL** — sin duplicar por sinónimos ("Vice City Metro" no tiene también página "Metro de Vice City"); las variantes se resuelven con contenido on-page y FAQs.
3. **Canonical + noindex** para vistas filtradas y /style-guide; paginación con enlaces reales (límites de listas + índices curados por hub, no scroll infinito indexable).
4. **Freshness real:** los pilares llevan changelog visible; "Last verified" se revisa por rutina (automatizable: informe de fichas sin verificar >30 días vía API).
5. **Imágenes:** WebP/AVIF (compresión vía API), nombre de archivo descriptivo, alt desde CMS, lazy salvo LCP.

### Datos estructurados (por plantilla, inyectados desde campos CMS)
| Plantilla | Schema |
|---|---|
| Global | Organization + WebSite (+ SearchAction) |
| Noticia | NewsArticle (autor→Person, fechas reales) |
| Ficha entidad | Article + `about`: VideoGame (Grand Theft Auto VI) + BreadcrumbList |
| FAQ | FAQPage |
| Autor | Person + sameAs |
| Guía (F3) | HowTo cuando aplique |
| Trailers | VideoObject |

### E-E-A-T operativo
Autores reales con página y redes · políticas públicas (editorial, verificación, correcciones) · citas salientes a fuentes primarias en cada pieza · disclaimer de independencia en footer y About · "Why trust us" en pilares.

---

## 5. Home v2 — blueprint "answer engine"

Jerarquía de módulos (todos alimentados por CMS; ninguno decorativo):

1. **Navbar** con buscador omnipresente.
2. **Launch ribbon** persistente: countdown al 19-11-2026 + plataformas (visible en todo el sitio, no solo Home).
3. **Hero cinematográfico** — gradiente atardecer-neón propio (CSS puro, sin assets de Rockstar, LCP-seguro: sin vídeo en móvil), titular de posicionamiento y **buscador grande como CTA principal** ("Ask anything about GTA 6") con sugerencias ("Who is Lucia?", "Will it be on PC?"). La Home declara el producto: respuestas, no scroll de noticias.
4. **Game Status board** (moat visible): última confirmación oficial · rumor más caliente ahora · próximo evento esperado — 3 tarjetas desde Claims/Timeline.
5. **Noticias verificadas / Rumor Watch** en doble carril — la separación editorial hecha layout.
6. **Personajes** (rail horizontal con fichas).
7. **Mapa** (teaser visual → /map).
8. **Base de datos** (grid de accesos con contadores reales: "84 vehicles · 31 characters…").
9. **Trailer hub** (último análisis con timestamps).
10. **Timeline** (últimos 5 hitos → /timeline).
11. **Quick facts** (release, plataformas, precio, con badges de estado).
12. **Guías destacadas** (crece post-lanzamiento).
13. **Newsletter** (un solo bloque, sin popups agresivos).
14. **Footer** completo (sitemap + legal + disclaimer).

Presupuesto de rendimiento: LCP < 2 s móvil, CLS ≈ 0 (alturas reservadas), animaciones solo transform/opacity y `prefers-reduced-motion`.

---

## 6. Moat — 5 funcionalidades defendibles

1. **Claim Tracker** (/tracker): toda afirmación sobre el juego como registro con estado, evidencia, fuentes, fechas e **historial de cambios**. Nadie del nicho lo tiene como base de datos navegable. Es citable ("according to Sixpedia's tracker…") → imán de enlaces.
2. **Timeline** (/timeline): la historia completa y verificada del desarrollo, filtrable. Contenido evergreen + razón de re-visita.
3. **Grafo de entidades con apariciones timestampadas:** "visto en Trailer 2 · 0:41" conecta trailers ↔ fichas en ambos sentidos. Convierte cada análisis en decenas de enlaces internos perfectos y da a Google un grafo explícito.
4. **Pilares vivos con changelog visible:** frescura demostrable como UX (y señal de ranking).
5. **Mapa por capas de veracidad:** localizaciones confirmadas vs. observadas vs. especulación comunitaria, alimentado desde CMS.

(El buscador inteligente y la IA sobre datos verificados son la evolución natural — F5/F6 — y ya están soportados por esta estructura: entidades + claims + FAQs son exactamente el corpus que un buscador semántico necesita.)

**Buscador por fases:** F1: search nativo de Webflow (incluido en plan CMS) con página de resultados a medida → F2: índice JSON desde la API + Fuse.js (instantáneo, tolerante a typos, gratis) → F3+: Algolia/Typesense con facetas e intents de pregunta mapeados a entidades/FAQs.

---

## 7. AdSense — construir para ser aprobables

**Ya alineado:** contenido original, autores, fuentes, navegación clara, mobile-first, sin prácticas engañosas.

**Checklist a completar antes de solicitar (F3):** About · Contact · Privacy Policy · Cookie Policy (+ **CMP con Google Consent Mode v2** si hay tráfico UE, aunque el target sea EE. UU.) · Terms · disclaimer de no afiliación y de afiliados · Corrections policy · 30–50 páginas de calidad indexadas · dominio propio con varias semanas de historial · tráfico orgánico inicial.

**Riesgos que vigilaré cuando toque:** densidad de anuncios sobre contenido (especialmente móvil) · anuncios sobre herramientas (mapa/tracker) que rompan UX · fichas thin publicadas por error (la barrera del §4 lo previene) · cualquier contenido derivado de filtraciones (política anti-leaks: también protege AdSense) · CLS por slots sin altura reservada (ya resuelto por diseño de AdSlot).

**No solicitar todavía.** Con esqueleto se deniega y las re-solicitudes penalizan tiempo.

---

## 8. Marca — ronda final y recomendación firme

Tras 3 rondas (~90 dominios verificados), finalistas reales:

| Criterio | **Sixpedia** | SixLore | SixCodex |
|---|---|---|---|
| Memorabilidad y escritura | 9.5 | 9 | 8 |
| Facilidad de búsqueda | 9 | 9 | 8.5 |
| Relación con GTA VI | 7.5 | 7.5 | 7 |
| Asociación "todo el conocimiento" | 10 | 8.5 | 8 |
| Potencial de marca enorme | 9 | 9 | 9 |
| Encaje con posicionamiento "verificado" | 9 | 7 | 8.5 |
| Dominio .com | libre* | libre* | libre* |
| **TOTAL** | **9.0** | **8.4** | **8.2** |

- **Sixpedia** — recomendación final. "-pedia" comunica *knowledge base* de forma universal e instantánea (el posicionamiento exacto), máximo recuerdo, precedente Investopedia.
- **SixLore** (sixlore.com, hallazgo de esta ronda) — la alternativa premium gaming-native: "lore" es lenguaje nativo del público gamer, 2 sílabas, gran marca. Contra: "lore" connota *universo/historia* más que *hechos verificados/noticias*, que es nuestro diferencial.
- **SixCodex** — autoridad editorial, tercero digno.

**Decisión de producto: hay que cerrar YA.** Cada semana sin marca es una semana sin dominio indexándose, sin búsquedas de marca acumulándose y sin handles. Con 91 días de ventana, seguir iterando naming tiene coste real y retorno decreciente. Pido decisión en esta ronda.

---

## 9. Roadmap v2 (calibrado al 19-11-2026)

**F1 — "Credibilidad + Núcleo" (ya → ~2 semanas)**
Cerrar marca + comprar dominio + handles · contratar plan CMS · renombrar sitio · fuentes al head · News completo (plantilla de artículo con NewsArticle schema, bloque de fuentes, Article Type, related) · **Claims + Timeline (colecciones) y /tracker + /timeline v1** · pilares: /release-date, /editions, /platforms · páginas legales y de credibilidad completas · **Home v2 cinematográfica** · favicon/OG/404 · GA4 + Search Console · 15–20 claims semilla + 10 noticias/piezas fundacionales.
*Salida: el sitio ya es distinto a todo lo que existe.*

**F2 — "El grafo" (→ ~6 semanas)**
Characters, Locations/Regions, Vehicles/Classes, Weapons, Media/Trailers, Guides, FAQs · plantillas de ficha con FactBox + claims + appearances · /map v1 con capas de veracidad · buscador v1→v2 · análisis de trailers con timestamps · 50–100 páginas de calidad · backups automatizados del CMS.
*Salida: la base de conocimiento navegable y conectada.*

**F3 — "Pre-lanzamiento" (octubre → 18-11)**
Plantillas de guías y Missions listas · páginas Tier 2 (preload, file size…) · newsletter operativa (form → Resend vía Worker) · afiliación en /editions con disclosure · **solicitud AdSense** (checklist §7 completo) · CMP consent · hardening de rendimiento.
*Salida: máquina lista para la semana del lanzamiento.*

**F4 — "Launch sprint" (19-11 → +4 semanas)**
Guías y misiones a máxima cadencia · mapa real del juego · tracker de descubrimientos · progreso v1 (localStorage).
*Salida: capturar el gold rush.*

**F5+ — comunidad, Supabase (progreso sync), buscador avanzado, IA sobre datos verificados.**

### Qué NO hacer todavía
No comprar plan Business (el CMS basta hasta F3+) · no montar Supabase/Workers (nada lo necesita hasta F3) · no autogenerar fichas vacías · no solicitar AdSense ni poner código de anuncios · no atacar keywords de otros GTA · no publicar /system-requirements sin datos oficiales · no más rondas de naming después de esta.

---

## 10. Decisiones que necesito ahora

1. **Marca final:** Sixpedia (recomendada) / SixLore / SixCodex → compra de .com + handles.
2. **Plan CMS de Webflow** (~23–29 $/mes): es el desbloqueador físico de F1 (el plan free limita a 2 páginas y ya están usadas). Lo contratas tú; te indico el momento exacto: ahora.
3. **OK al alcance de F1 v2** (§9) incluida la reconstrucción de la Home según el blueprint (§5).

\* Disponibilidad por delegación DNS; confirmar en registrador antes de comprar.

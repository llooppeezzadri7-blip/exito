# Sixpedia — Build Log

## 2026-08-20 · F0–F1 fundaciones (sitio Webflow `gtaiv`, id 6a86bdf0669c6a997ae3993c)

**Publicado en staging:** https://gtaiv-9fa8e1.webflow.io/ y /style-guide

- CMS (4 colecciones): News Categories (descripción, color), Authors (bio, foto, rol, X URL), Sources (URL, tipo Official/Media/Insider/Community, fiabilidad, fecha), News Articles (excerpt, body, hero image, fecha, featured, ref→Category, ref→Author, multiref→Sources).
- Tokens: colección de variables "Sixpedia Tokens" — 14 colores (fondos, textos, marca magenta/aqua/sunset, 5 estados de veracidad), 3 fuentes (Archivo Black / Public Sans / IBM Plex Mono), 3 tamaños (radios, container 1280).
- Design system (clases): page-dark, u-container, eyebrow, heading-display/1/2/3, text-lead/body/mono, badge + 5 variantes de estado, btn primary/secondary, card + news/entity/fact, chip, grid-3, navbar-*, footer-*, responsive móvil.
- Páginas: Style Guide (/style-guide) con muestrario completo; Home v1 (navbar + hero + CTA + footer con disclaimer de no afiliación).
- Componentes: Navbar y Footer (grupo Global).
- SEO Home: "Sixpedia — The GTA 6 Wiki & Database" + OG.
- Fuentes: Google Fonts vía elemento Embed por página (el custom code de sitio y la autoinstalación de fuentes están bloqueados en plan free — migrar al head del sitio al contratar plan CMS).

**Pendiente usuario:** renombrar sitio a "Sixpedia" (Site Settings), comprar sixpedia.com + handles, plan CMS al ampliar.
**Siguiente hito (con aprobación):** plantilla de artículo de News, listados con filtros, páginas de credibilidad, contenido semilla.

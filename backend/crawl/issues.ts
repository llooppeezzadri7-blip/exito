import { differsOnlyByTrailingSlash } from "./url-normalize";
import type { CrawledPage, SiteModel, Verification } from "./site-model";

/**
 * W2 — turning the site model into findings.
 *
 * Kept separate from the crawl on purpose: the model describes what was
 * observed, this decides what is wrong with it. Changing a judgement here
 * never invalidates a crawl, and a crawl can be re-analysed with better rules
 * without re-fetching anything.
 *
 * Every finding carries a verification level. A conclusion drawn from a
 * partial crawl is not the same claim as one drawn from a complete one, and
 * saying "12 páginas huérfanas" after stopping at the page limit would be
 * a fabrication dressed as a count.
 */

export type IssueSeverity = "critical" | "serious" | "moderate" | "minor";

export type IssueCode =
  | "BROKEN_LINK"
  | "CLIENT_ERROR"
  | "SERVER_ERROR"
  | "REDIRECT"
  | "REDIRECT_CHAIN"
  | "REDIRECT_LOOP"
  | "ORPHAN_PAGE"
  | "DUPLICATE_TITLE"
  | "DUPLICATE_H1"
  | "DUPLICATE_META_DESCRIPTION"
  | "DUPLICATE_URL"
  | "DUPLICATE_CONTENT"
  | "CANONICAL_CONFLICT"
  | "CANONICAL_TO_NON_INDEXABLE"
  | "TOO_DEEP"
  | "MISSING_FROM_SITEMAP"
  | "SITEMAP_URL_NOT_INDEXABLE"
  | "SITEMAP_URL_ERROR"
  | "NOT_INDEXABLE"
  | "BLOCKED_BY_ROBOTS"
  | "NO_SITEMAP"
  | "NO_ROBOTS"
  | "THIN_INTERNAL_LINKING";

export interface SiteIssue {
  code: IssueCode;
  severity: IssueSeverity;
  title: string;
  /** What was actually observed. Never a recommendation dressed as a fact. */
  evidence: string;
  /** URLs affected. Capped in the text, complete here. */
  urls: string[];
  verification: Verification;
  fix: string;
}

/** Depth beyond which a page is hard for both users and crawlers to reach. */
export const MAX_REASONABLE_DEPTH = 3;

function issue(
  code: IssueCode,
  severity: IssueSeverity,
  title: string,
  evidence: string,
  urls: string[],
  fix: string,
  verification: Verification = "VERIFIED"
): SiteIssue {
  return { code, severity, title, evidence, urls, verification, fix };
}

/** Groups pages by a field, returning only the groups with more than one. */
function duplicatesBy<T>(
  pages: CrawledPage[],
  extract: (page: CrawledPage) => T | null
): Map<T, CrawledPage[]> {
  const groups = new Map<T, CrawledPage[]>();

  for (const page of pages) {
    const value = extract(page);
    if (value === null || value === undefined || value === "") continue;
    groups.set(value, [...(groups.get(value) ?? []), page]);
  }

  for (const [value, group] of groups) {
    if (group.length < 2) groups.delete(value);
  }

  return groups;
}

export function findIssues(model: SiteModel): SiteIssue[] {
  const issues: SiteIssue[] = [];
  const pages = model.pages;
  const byUrl = new Map(pages.map((page) => [page.url, page]));
  const fetched = pages.filter((page) => page.state === "OK" || page.state === "REDIRECT");

  // A crawl that hit a ceiling saw only part of the site. Every conclusion
  // that depends on completeness is downgraded accordingly.
  const complete = model.stats.stoppedBy === "completed";
  const completeness: Verification = complete ? "VERIFIED" : "PROBABLE";
  const partialNote = complete
    ? ""
    : ` (el crawl paró por ${model.stats.stoppedBy}, así que puede haber más)`;

  // ---- HTTP status -------------------------------------------------------
  const clientErrors = pages.filter((page) => page.state === "CLIENT_ERROR");
  if (clientErrors.length > 0) {
    issues.push(
      issue(
        "CLIENT_ERROR",
        "critical",
        "Páginas que devuelven error 4xx",
        `${clientErrors.length} URL(s) devuelven un error de cliente: ${clientErrors
          .slice(0, 5)
          .map((page) => `${page.url} (${page.status})`)
          .join(", ")}${partialNote}.`,
        clientErrors.map((page) => page.url),
        "Redirige esas URLs a su equivalente actual, o devuélvelas como 410 si el contenido ya no existe."
      )
    );
  }

  const serverErrors = pages.filter((page) => page.state === "SERVER_ERROR");
  if (serverErrors.length > 0) {
    issues.push(
      issue(
        "SERVER_ERROR",
        "critical",
        "Páginas que devuelven error 5xx",
        `${serverErrors.length} URL(s) fallan en el servidor: ${serverErrors
          .slice(0, 5)
          .map((page) => `${page.url} (${page.status})`)
          .join(", ")}.`,
        serverErrors.map((page) => page.url),
        "Un 5xx hace que Google deje de rastrear el sitio. Es lo primero que hay que arreglar."
      )
    );
  }

  // ---- Broken internal links --------------------------------------------
  // Reported from the linking page's side: what matters operationally is
  // which page contains the bad link, not just that a URL is dead.
  const brokenLinks: { from: string; to: string; status: number | null }[] = [];
  for (const page of pages) {
    for (const link of page.outboundLinks) {
      if (!link.internal) continue;
      const target = byUrl.get(link.to);
      if (!target) continue;
      if (target.state === "CLIENT_ERROR" || target.state === "SERVER_ERROR") {
        brokenLinks.push({ from: page.url, to: link.to, status: target.status });
      }
    }
  }

  if (brokenLinks.length > 0) {
    issues.push(
      issue(
        "BROKEN_LINK",
        "serious",
        "Enlaces internos rotos",
        `${brokenLinks.length} enlace(s) internos apuntan a URLs con error: ${brokenLinks
          .slice(0, 5)
          .map((link) => `${link.from} → ${link.to} (${link.status})`)
          .join("; ")}.`,
        [...new Set(brokenLinks.map((link) => link.from))],
        "Corrige o elimina esos enlaces: cada uno envía a usuarios y a Google a una página que no existe."
      )
    );
  }

  // ---- Redirects ---------------------------------------------------------
  const redirected = pages.filter((page) => page.redirects.length > 0);
  const chains = redirected.filter((page) => page.redirects.length > 1);
  const loops = pages.filter((page) => page.error?.includes("Bucle de redirecciones"));

  if (loops.length > 0) {
    issues.push(
      issue(
        "REDIRECT_LOOP",
        "critical",
        "Bucles de redirección",
        `${loops.length} URL(s) redirigen en círculo y nunca llegan a una página: ${loops
          .map((page) => page.url)
          .slice(0, 5)
          .join(", ")}.`,
        loops.map((page) => page.url),
        "Rompe el ciclo: una URL debe llegar a un 200 en un salto, dos como mucho."
      )
    );
  }

  if (chains.length > 0) {
    issues.push(
      issue(
        "REDIRECT_CHAIN",
        "moderate",
        "Cadenas de redirecciones",
        `${chains.length} URL(s) pasan por más de un salto: ${chains
          .slice(0, 3)
          .map((page) => `${page.url} (${page.redirects.length} saltos)`)
          .join(", ")}.`,
        chains.map((page) => page.url),
        "Apunta la primera redirección directamente al destino final: cada salto pierde tiempo y algo de señal."
      )
    );
  }

  const internalLinksToRedirects = pages.flatMap((page) =>
    page.outboundLinks
      .filter((link) => link.internal && byUrl.get(link.to)?.redirects.length)
      .map((link) => ({ from: page.url, to: link.to }))
  );

  if (internalLinksToRedirects.length > 0) {
    issues.push(
      issue(
        "REDIRECT",
        "minor",
        "Enlaces internos que apuntan a una redirección",
        `${internalLinksToRedirects.length} enlace(s) internos van a una URL que redirige.`,
        [...new Set(internalLinksToRedirects.map((link) => link.from))],
        "Actualiza los enlaces internos para que apunten a la URL final."
      )
    );
  }

  // ---- Orphans and depth -------------------------------------------------
  if (model.architecture.orphans.length > 0) {
    issues.push(
      issue(
        "ORPHAN_PAGE",
        "serious",
        "Páginas huérfanas",
        `${model.architecture.orphans.length} página(s) existen pero ningún enlace interno lleva hasta ellas${partialNote}: ${model.architecture.orphans
          .slice(0, 5)
          .join(", ")}.`,
        model.architecture.orphans,
        "Enlázalas desde donde tengan sentido. Una página a la que no se llega navegando casi no posiciona.",
        completeness
      )
    );
  }

  const tooDeep = fetched.filter((page) => (page.depth ?? 0) > MAX_REASONABLE_DEPTH);
  if (tooDeep.length > 0) {
    issues.push(
      issue(
        "TOO_DEEP",
        "moderate",
        "Páginas demasiado profundas",
        `${tooDeep.length} página(s) están a más de ${MAX_REASONABLE_DEPTH} clics de la portada: ${tooDeep
          .slice(0, 5)
          .map((page) => `${page.url} (${page.depth})`)
          .join(", ")}.`,
        tooDeep.map((page) => page.url),
        "Acerca esas páginas a la portada con enlaces desde secciones intermedias."
      )
    );
  }

  // ---- Duplicates --------------------------------------------------------
  for (const [code, severity, label, extract, fix] of [
    [
      "DUPLICATE_TITLE",
      "serious",
      "títulos",
      (page: CrawledPage) => page.title,
      "Escribe un title único por página: si dos compiten por lo mismo, Google elige una y descarta la otra.",
    ],
    [
      "DUPLICATE_H1",
      "moderate",
      "encabezados H1",
      (page: CrawledPage) => page.h1[0] ?? null,
      "Da a cada página un H1 que describa su contenido concreto.",
    ],
    [
      "DUPLICATE_META_DESCRIPTION",
      "minor",
      "meta descriptions",
      (page: CrawledPage) => page.metaDescription,
      "Escribe una meta description propia por página.",
    ],
  ] as const) {
    const groups = duplicatesBy(fetched, extract);
    if (groups.size === 0) continue;

    const affected = [...groups.values()].flat().map((page) => page.url);
    const example = [...groups.entries()][0];

    issues.push(
      issue(
        code,
        severity,
        `Hay ${label} duplicados`,
        `${groups.size} ${label} se repiten en ${affected.length} páginas. Por ejemplo "${String(example[0]).slice(0, 60)}" aparece en ${example[1].length}: ${example[1].map((p) => p.url).slice(0, 3).join(", ")}.`,
        affected,
        fix
      )
    );
  }

  // ---- Duplicate URLs ----------------------------------------------------
  const trailingSlashPairs: string[] = [];
  const urls = fetched.map((page) => page.url);
  for (let i = 0; i < urls.length; i++) {
    for (let j = i + 1; j < urls.length; j++) {
      if (differsOnlyByTrailingSlash(urls[i], urls[j])) {
        trailingSlashPairs.push(`${urls[i]} / ${urls[j]}`);
      }
    }
  }

  if (trailingSlashPairs.length > 0) {
    issues.push(
      issue(
        "DUPLICATE_URL",
        "moderate",
        "La misma página responde con y sin barra final",
        `${trailingSlashPairs.length} par(es) de URLs difieren solo en la barra final: ${trailingSlashPairs.slice(0, 3).join("; ")}.`,
        trailingSlashPairs,
        "Elige una forma, redirige la otra con un 301 y usa la elegida en todos los enlaces internos."
      )
    );
  }

  // ---- Duplicate content -------------------------------------------------
  // Only exact matches of normalised text. Near-duplicate detection needs
  // shingling and a similarity threshold; claiming it from a hash comparison
  // would be overstating what was measured.
  const contentGroups = duplicatesBy(fetched, (page) => page.contentHash);
  if (contentGroups.size > 0) {
    const affected = [...contentGroups.values()].flat().map((page) => page.url);
    issues.push(
      issue(
        "DUPLICATE_CONTENT",
        "serious",
        "Páginas con contenido idéntico",
        `${contentGroups.size} grupo(s) de páginas sirven exactamente el mismo texto: ${[...contentGroups.values()][0].map((p) => p.url).slice(0, 3).join(", ")}.`,
        affected,
        "Unifícalas con un 301, o diferéncialas de verdad. Si ambas deben existir, marca la principal con canonical."
      )
    );
  }

  // ---- Canonicals --------------------------------------------------------
  const canonicalToMissing = fetched.filter((page) => {
    if (!page.canonicalPointsElsewhere || !page.canonical) return false;
    const target = byUrl.get(page.canonical);
    return target ? target.state === "CLIENT_ERROR" || target.state === "SERVER_ERROR" || !target.indexable : false;
  });

  if (canonicalToMissing.length > 0) {
    issues.push(
      issue(
        "CANONICAL_TO_NON_INDEXABLE",
        "serious",
        "Canonicals que apuntan a páginas no indexables",
        `${canonicalToMissing.length} página(s) ceden su indexación a una URL que no puede indexarse: ${canonicalToMissing
          .slice(0, 3)
          .map((page) => `${page.url} → ${page.canonical}`)
          .join("; ")}.`,
        canonicalToMissing.map((page) => page.url),
        "Apunta el canonical a una URL que devuelva 200 y sea indexable, o quítalo."
      )
    );
  }

  // Two pages claiming to be canonical for each other: nobody wins.
  const conflicts = fetched.filter((page) => {
    if (!page.canonical || !page.canonicalPointsElsewhere) return false;
    const target = byUrl.get(page.canonical);
    return Boolean(target?.canonical && target.canonical === page.url);
  });

  if (conflicts.length > 0) {
    issues.push(
      issue(
        "CANONICAL_CONFLICT",
        "serious",
        "Canonicals cruzados",
        `${conflicts.length} página(s) se declaran canónicas la una de la otra, así que Google no puede resolver cuál es la buena: ${conflicts
          .slice(0, 3)
          .map((page) => `${page.url} ↔ ${page.canonical}`)
          .join("; ")}.`,
        conflicts.map((page) => page.url),
        "Decide cuál es la URL principal y haz que ambas apunten a ella."
      )
    );
  }

  // ---- Indexability ------------------------------------------------------
  const nonIndexable = fetched.filter((page) => !page.indexable);
  if (nonIndexable.length > 0) {
    issues.push(
      issue(
        "NOT_INDEXABLE",
        "moderate",
        "Páginas que no pueden indexarse",
        `${nonIndexable.length} página(s) accesibles no son indexables: ${nonIndexable
          .slice(0, 5)
          .map((page) => `${page.url} — ${page.indexabilityReason}`)
          .join("; ")}.`,
        nonIndexable.map((page) => page.url),
        "Comprueba que sea intencionado. Una página que debe posicionar y lleva noindex no aparecerá jamás.",
        // Canonical-based non-indexability is a hint, not a guarantee.
        nonIndexable.every((page) => page.indexabilityVerification === "VERIFIED") ? "VERIFIED" : "PROBABLE"
      )
    );
  }

  const blocked = pages.filter((page) => page.state === "BLOCKED_BY_ROBOTS");
  if (blocked.length > 0) {
    issues.push(
      issue(
        "BLOCKED_BY_ROBOTS",
        "moderate",
        "URLs bloqueadas por robots.txt",
        `${blocked.length} URL(s) están bloqueadas: ${blocked.slice(0, 5).map((page) => page.url).join(", ")}.`,
        blocked.map((page) => page.url),
        "Comprueba que el bloqueo es deliberado: robots.txt impide rastrear, no impide indexar."
      )
    );
  }

  // ---- Sitemap -----------------------------------------------------------
  if (model.sitemap.status === "NOT_FOUND") {
    issues.push(
      issue(
        "NO_SITEMAP",
        "serious",
        "El sitio no tiene sitemap",
        "No se encontró sitemap ni declarado en robots.txt ni en /sitemap.xml.",
        [model.origin],
        "Genera un sitemap.xml con las URLs indexables, decláralo en robots.txt y súbelo a Search Console."
      )
    );
  }

  if (model.robots.status === "NOT_FOUND") {
    issues.push(
      issue(
        "NO_ROBOTS",
        "minor",
        "El sitio no tiene robots.txt",
        "No se encontró /robots.txt.",
        [model.origin],
        "Publica un robots.txt, aunque solo sea para declarar el sitemap."
      )
    );
  }

  if (model.sitemap.status === "VERIFIED") {
    const sitemapUrls = new Set(model.sitemap.urls.map((entry) => entry.url));

    const indexableNotInSitemap = fetched.filter((page) => page.indexable && !sitemapUrls.has(page.url));
    if (indexableNotInSitemap.length > 0) {
      issues.push(
        issue(
          "MISSING_FROM_SITEMAP",
          "moderate",
          "Páginas indexables ausentes del sitemap",
          `${indexableNotInSitemap.length} página(s) indexables no están en el sitemap${partialNote}: ${indexableNotInSitemap
            .slice(0, 5)
            .map((page) => page.url)
            .join(", ")}.`,
          indexableNotInSitemap.map((page) => page.url),
          "Añádelas al sitemap: es la forma más directa de decirle a Google que existen.",
          completeness
        )
      );
    }

    const sitemapNotIndexable = model.sitemap.urls
      .map((entry) => byUrl.get(entry.url))
      .filter((page): page is CrawledPage => Boolean(page))
      .filter((page) => (page.state === "OK" || page.state === "REDIRECT") && !page.indexable);

    if (sitemapNotIndexable.length > 0) {
      issues.push(
        issue(
          "SITEMAP_URL_NOT_INDEXABLE",
          "serious",
          "URLs del sitemap que no deberían estar ahí",
          `${sitemapNotIndexable.length} URL(s) del sitemap no son indexables: ${sitemapNotIndexable
            .slice(0, 5)
            .map((page) => `${page.url} — ${page.indexabilityReason}`)
            .join("; ")}.`,
          sitemapNotIndexable.map((page) => page.url),
          "Un sitemap debe listar solo lo que quieres indexado. Quita las demás: contradecirse confunde al rastreador."
        )
      );
    }

    const sitemapErrors = model.sitemap.urls
      .map((entry) => byUrl.get(entry.url))
      .filter((page): page is CrawledPage => Boolean(page))
      .filter((page) => page.state === "CLIENT_ERROR" || page.state === "SERVER_ERROR");

    if (sitemapErrors.length > 0) {
      issues.push(
        issue(
          "SITEMAP_URL_ERROR",
          "serious",
          "URLs del sitemap que devuelven error",
          `${sitemapErrors.length} URL(s) listadas en el sitemap fallan: ${sitemapErrors
            .slice(0, 5)
            .map((page) => `${page.url} (${page.status})`)
            .join(", ")}.`,
          sitemapErrors.map((page) => page.url),
          "Quítalas del sitemap o arregla las páginas: un sitemap con errores baja la confianza en todo el archivo."
        )
      );
    }
  }

  // ---- Internal linking --------------------------------------------------
  const poorlyLinked = fetched.filter(
    (page) => page.url !== model.entryUrl && page.inboundLinks.length === 1
  );
  if (poorlyLinked.length > 0 && fetched.length > 3) {
    issues.push(
      issue(
        "THIN_INTERNAL_LINKING",
        "minor",
        "Páginas con un solo enlace entrante",
        `${poorlyLinked.length} página(s) reciben un único enlace interno${partialNote}.`,
        poorlyLinked.map((page) => page.url),
        "Enlázalas desde más sitios relevantes: el enlazado interno reparte autoridad y guía al usuario.",
        completeness
      )
    );
  }

  const order: Record<IssueSeverity, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}

export interface SiteIssueSummary {
  total: number;
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  /** True when nothing critical was found. Not the same as "the site is good". */
  noCriticalIssues: boolean;
}

export function summarizeIssues(issues: SiteIssue[]): SiteIssueSummary {
  const count = (severity: IssueSeverity) => issues.filter((entry) => entry.severity === severity).length;

  return {
    total: issues.length,
    critical: count("critical"),
    serious: count("serious"),
    moderate: count("moderate"),
    minor: count("minor"),
    noCriticalIssues: count("critical") === 0,
  };
}

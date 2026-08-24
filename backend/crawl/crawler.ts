import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { fetchSafely, UnsafeUrlError, type SafetyOptions } from "@/lib/security/ssrf-guard";
import { fetchRobotsTxt, isAllowed, type RobotsTxt } from "./robots";
import { discoverSitemaps, type SitemapReport } from "./sitemap";
import {
  looksLikePage,
  normalizeUrl,
  pathDepth,
  sameSite,
  type NormalizedUrl,
} from "./url-normalize";
import {
  stateFromStatus,
  type CrawledPage,
  type CrawlStats,
  type PageLink,
  type SiteArchitecture,
  type SiteModel,
} from "./site-model";

/**
 * W2 — the crawler.
 *
 * Breadth-first from the entry point, so depth means what people think it
 * means: the fewest clicks from the homepage. A depth-first crawl would
 * assign a page whatever depth it happened to be found at, and every
 * architecture conclusion drawn from it would be wrong.
 *
 * Three ceilings, all enforced here and none negotiable by anything the crawl
 * discovers: page count, wall-clock time and depth. A crawler without hard
 * stops pointed at a site with faceted navigation will happily fetch a
 * million URLs.
 */

export interface CrawlOptions extends SafetyOptions {
  maxPages?: number;
  maxDepth?: number;
  maxDurationMs?: number;
  /** Politeness gap between requests, in ms. robots.txt can raise it. */
  delayMs?: number;
  /** Obey robots.txt. Turning this off is a deliberate, logged choice. */
  respectRobots?: boolean;
  /** Pull URLs from the sitemap as well as from links. */
  useSitemap?: boolean;
  now?: () => Date;
  onProgress?: (progress: { fetched: number; queued: number; current: string }) => void;
}

export const CRAWL_DEFAULTS = {
  maxPages: 50,
  maxDepth: 5,
  maxDurationMs: 5 * 60 * 1000,
  delayMs: 250,
} as const;

interface QueueItem {
  normalized: NormalizedUrl;
  depth: number;
  discoveredVia: CrawledPage["discoveredVia"];
}

function hashContent(text: string): string {
  // Normalising whitespace and case first means "same content, different
  // formatting" hashes the same, which is what duplicate detection needs.
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha1").update(normalized).digest("hex");
}

function extractLinks($: cheerio.CheerioAPI, baseUrl: string): PageLink[] {
  const links: PageLink[] = [];

  $("a[href]").each((_, element) => {
    const rawHref = $(element).attr("href") ?? "";
    if (!rawHref || rawHref.startsWith("#")) return;
    if (/^(mailto:|tel:|javascript:|data:|sms:|whatsapp:)/i.test(rawHref)) return;

    const normalized = normalizeUrl(rawHref, baseUrl);
    if (!normalized) return;

    links.push({
      to: normalized.key,
      rawHref,
      anchorText: $(element).text().replace(/\s+/g, " ").trim(),
      rel: $(element).attr("rel") ?? null,
      internal: sameSite(normalized.key, baseUrl),
    });
  });

  return links;
}

function readIndexability(
  $: cheerio.CheerioAPI,
  url: string,
  canonical: string | null,
  status: number
): Pick<CrawledPage, "indexable" | "indexabilityReason" | "indexabilityVerification"> {
  const robotsMeta = $('meta[name="robots"]').attr("content")?.toLowerCase() ?? "";
  const googlebotMeta = $('meta[name="googlebot"]').attr("content")?.toLowerCase() ?? "";
  const directives = `${robotsMeta} ${googlebotMeta}`;

  if (status >= 400) {
    return {
      indexable: false,
      indexabilityReason: `Devuelve HTTP ${status}.`,
      indexabilityVerification: "VERIFIED",
    };
  }

  if (directives.includes("noindex")) {
    return {
      indexable: false,
      indexabilityReason: `Meta robots contiene noindex ("${robotsMeta || googlebotMeta}").`,
      indexabilityVerification: "VERIFIED",
    };
  }

  if (canonical) {
    const canonicalNormalized = normalizeUrl(canonical, url);
    if (canonicalNormalized && canonicalNormalized.key !== url) {
      return {
        indexable: false,
        indexabilityReason: `El canonical apunta a ${canonicalNormalized.key}, así que esta URL cede su indexación.`,
        // PROBABLE, not VERIFIED: a canonical is a hint Google may ignore.
        // Reporting it as a fact would overstate what was observed.
        indexabilityVerification: "PROBABLE",
      };
    }
  }

  return {
    indexable: true,
    indexabilityReason: "Sin noindex y con canonical propio o ausente.",
    indexabilityVerification: "VERIFIED",
  };
}

function emptyPage(url: string, overrides: Partial<CrawledPage>): CrawledPage {
  return {
    url,
    finalUrl: url,
    state: "NOT_FETCHED",
    status: null,
    depth: null,
    discoveredVia: "link",
    redirects: [],
    title: null,
    metaDescription: null,
    h1: [],
    canonical: null,
    canonicalPointsElsewhere: false,
    robotsMeta: null,
    indexable: false,
    indexabilityReason: "No se ha comprobado.",
    indexabilityVerification: "NO_EVALUABLE",
    wordCount: 0,
    contentHash: null,
    outboundLinks: [],
    inboundLinks: [],
    inSitemap: false,
    allowedByRobots: true,
    robotsReason: "No comprobado.",
    contentType: null,
    bytes: 0,
    elapsedMs: null,
    fetchedAt: null,
    error: null,
    audit: null,
    ...overrides,
  };
}

export async function crawlSite(entryUrl: string, options: CrawlOptions = {}): Promise<SiteModel> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const maxPages = options.maxPages ?? CRAWL_DEFAULTS.maxPages;
  const maxDepth = options.maxDepth ?? CRAWL_DEFAULTS.maxDepth;
  const maxDurationMs = options.maxDurationMs ?? CRAWL_DEFAULTS.maxDurationMs;
  const respectRobots = options.respectRobots ?? true;
  const useSitemap = options.useSitemap ?? true;
  const limitations: string[] = [];

  const seed = normalizeUrl(entryUrl);
  if (!seed) {
    throw new UnsafeUrlError(`URL de entrada no válida: ${entryUrl}`);
  }

  const origin = seed.origin;

  // ---- robots.txt and sitemaps, before spending anything on pages --------
  const robots: RobotsTxt = respectRobots
    ? await fetchRobotsTxt(origin, options)
    : {
        status: "NOT_VERIFIED",
        url: `${origin}/robots.txt`,
        rules: [],
        sitemaps: [],
        crawlDelaySeconds: null,
        reason: "El crawl se lanzó con respectRobots=false: no se leyó robots.txt.",
      };

  if (!respectRobots) {
    limitations.push("Este crawl ignoró robots.txt por configuración explícita.");
  } else if (robots.status === "NOT_VERIFIED") {
    limitations.push(`No se pudo leer robots.txt: ${robots.reason}`);
  }

  const sitemap: SitemapReport = useSitemap
    ? await discoverSitemaps(origin, { ...options, fromRobots: robots.sitemaps })
    : {
        status: "NOT_VERIFIED",
        documents: [],
        urls: [],
        discoveredVia: [],
        reason: "El crawl se lanzó con useSitemap=false.",
      };

  if (useSitemap && sitemap.status !== "VERIFIED") {
    limitations.push(`No se pudo usar el sitemap: ${sitemap.reason}`);
  }

  const sitemapKeys = new Set(sitemap.urls.map((entry) => entry.url));

  // Politeness: robots.txt Crawl-delay wins when it asks for more.
  const delayMs = Math.max(
    options.delayMs ?? CRAWL_DEFAULTS.delayMs,
    (robots.crawlDelaySeconds ?? 0) * 1000
  );

  // ---- The crawl ---------------------------------------------------------
  const pages = new Map<string, CrawledPage>();
  const queued = new Set<string>([seed.key]);
  const queue: QueueItem[] = [{ normalized: seed, depth: 0, discoveredVia: "seed" }];

  // Sitemap URLs are queued after the seed so links still determine depth:
  // a page's depth must reflect how far it is from the homepage, not the
  // order it appeared in an XML file.
  if (useSitemap) {
    for (const entry of sitemap.urls) {
      const normalized = normalizeUrl(entry.url);
      if (!normalized || queued.has(normalized.key)) continue;
      if (!sameSite(normalized.key, origin)) continue;
      queued.add(normalized.key);
      queue.push({ normalized, depth: pathDepth(normalized.key), discoveredVia: "sitemap" });
    }
  }

  let stoppedBy: CrawlStats["stoppedBy"] = "completed";
  let fetched = 0;

  while (queue.length > 0) {
    if (fetched >= maxPages) {
      stoppedBy = "max_pages";
      break;
    }
    if (now().getTime() - startedAt.getTime() >= maxDurationMs) {
      stoppedBy = "max_duration";
      break;
    }

    const item = queue.shift()!;
    const { normalized, depth } = item;

    if (pages.has(normalized.key)) continue;

    if (depth > maxDepth) {
      pages.set(
        normalized.key,
        emptyPage(normalized.key, {
          depth,
          discoveredVia: item.discoveredVia,
          state: "NOT_FETCHED",
          error: `Más allá de la profundidad máxima (${maxDepth}).`,
          inSitemap: sitemapKeys.has(normalized.key),
        })
      );
      stoppedBy = stoppedBy === "completed" ? "max_depth" : stoppedBy;
      continue;
    }

    const decision = isAllowed(robots, normalized.key);
    if (respectRobots && !decision.allowed) {
      pages.set(
        normalized.key,
        emptyPage(normalized.key, {
          depth,
          discoveredVia: item.discoveredVia,
          state: "BLOCKED_BY_ROBOTS",
          allowedByRobots: false,
          robotsReason: decision.reason,
          indexabilityReason: "Bloqueada por robots.txt, así que no se comprobó.",
          inSitemap: sitemapKeys.has(normalized.key),
        })
      );
      continue;
    }

    options.onProgress?.({ fetched, queued: queue.length, current: normalized.key });

    if (fetched > 0 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    let page: CrawledPage;
    try {
      const response = await fetchSafely(normalized.key, {
        timeoutMs: 15_000,
        maxBytes: 3_000_000,
        ...options,
      });
      fetched += 1;

      const contentType = response.headers.get("content-type");
      const isHtml = !contentType || contentType.includes("html");

      if (!isHtml) {
        // A PDF or an image is a real URL, but not a page. Recording it
        // without parsing keeps link graphs honest without pretending it
        // has a title or an H1.
        page = emptyPage(normalized.key, {
          finalUrl: response.finalUrl,
          depth,
          discoveredVia: item.discoveredVia,
          state: stateFromStatus(response.status, response.redirects),
          status: response.status,
          redirects: response.redirects,
          contentType,
          bytes: response.bodyBytes,
          elapsedMs: response.elapsedMs,
          fetchedAt: now().toISOString(),
          allowedByRobots: true,
          robotsReason: decision.reason,
          inSitemap: sitemapKeys.has(normalized.key),
          indexabilityReason: "No es un documento HTML.",
          indexabilityVerification: "NO_EVALUABLE",
        });
        pages.set(normalized.key, page);
        continue;
      }

      const $ = cheerio.load(response.body);
      const canonicalRaw = $('link[rel="canonical"]').attr("href")?.trim() || null;
      const canonicalNormalized = canonicalRaw ? normalizeUrl(canonicalRaw, response.finalUrl) : null;
      const bodyText = $("body").text().replace(/\s+/g, " ").trim();
      const links = extractLinks($, response.finalUrl);

      page = emptyPage(normalized.key, {
        finalUrl: response.finalUrl,
        depth,
        discoveredVia: item.discoveredVia,
        state: stateFromStatus(response.status, response.redirects),
        status: response.status,
        redirects: response.redirects,
        title: $("title").first().text().trim() || null,
        metaDescription: $('meta[name="description"]').attr("content")?.trim() || null,
        h1: $("h1").map((_, el) => $(el).text().replace(/\s+/g, " ").trim()).toArray(),
        canonical: canonicalNormalized?.key ?? canonicalRaw,
        canonicalPointsElsewhere: Boolean(canonicalNormalized && canonicalNormalized.key !== normalized.key),
        robotsMeta: $('meta[name="robots"]').attr("content")?.trim() || null,
        ...readIndexability($, normalized.key, canonicalRaw, response.status),
        wordCount: bodyText.length > 0 ? bodyText.split(" ").length : 0,
        contentHash: bodyText.length > 0 ? hashContent(bodyText) : null,
        outboundLinks: links,
        contentType,
        bytes: response.bodyBytes,
        elapsedMs: response.elapsedMs,
        fetchedAt: now().toISOString(),
        allowedByRobots: true,
        robotsReason: decision.reason,
        inSitemap: sitemapKeys.has(normalized.key),
      });

      // Queue internal links one level deeper. Only pages: a link to a PDF
      // is recorded in the graph but never crawled as HTML.
      if (response.status < 400) {
        for (const link of links) {
          if (!link.internal || queued.has(link.to) || !looksLikePage(link.to)) continue;
          const target = normalizeUrl(link.to);
          if (!target) continue;
          queued.add(link.to);
          queue.push({ normalized: target, depth: depth + 1, discoveredVia: "link" });
        }

        // A canonical pointing at an internal page we have not seen is a real
        // discovery signal: the site is telling us where it thinks the page is.
        if (canonicalNormalized && !queued.has(canonicalNormalized.key) && sameSite(canonicalNormalized.key, origin)) {
          queued.add(canonicalNormalized.key);
          queue.push({ normalized: canonicalNormalized, depth: depth + 1, discoveredVia: "canonical" });
        }

        // The destination of a redirect is a page in its own right — it is
        // the URL that actually gets indexed and that belongs in the sitemap.
        // Knowing it only as someone else's `finalUrl` makes it invisible to
        // every check that reasons about pages.
        const destination = response.redirects.length > 0 ? normalizeUrl(response.finalUrl) : null;
        if (destination && !queued.has(destination.key) && sameSite(destination.key, origin)) {
          queued.add(destination.key);
          // Same depth as the URL that redirected here: a redirect is
          // transparent to the visitor, so it costs no extra click.
          queue.push({ normalized: destination, depth, discoveredVia: "redirect" });
        }
      }
    } catch (err) {
      fetched += 1;
      const message = err instanceof Error ? err.message : "No se pudo acceder a la URL.";
      // "Too many redirects" from the guard is how a redirect loop surfaces.
      const isLoop = /too many redirects/i.test(message);

      page = emptyPage(normalized.key, {
        depth,
        discoveredVia: item.discoveredVia,
        state: "UNREACHABLE",
        error: isLoop ? "Bucle de redirecciones: la URL nunca llega a una página final." : message,
        fetchedAt: now().toISOString(),
        allowedByRobots: true,
        robotsReason: decision.reason,
        inSitemap: sitemapKeys.has(normalized.key),
        indexabilityReason: "No se pudo acceder, así que no se pudo comprobar.",
        indexabilityVerification: "NOT_VERIFIED",
      });
    }

    pages.set(normalized.key, page);
  }

  // Anything still queued when a ceiling hit is recorded as known-but-unfetched
  // rather than dropped: silently forgetting URLs would make coverage look
  // complete when it is not.
  for (const item of queue) {
    if (pages.has(item.normalized.key)) continue;
    pages.set(
      item.normalized.key,
      emptyPage(item.normalized.key, {
        depth: item.depth,
        discoveredVia: item.discoveredVia,
        state: "NOT_FETCHED",
        error: `Descubierta pero no rastreada: el crawl paró por ${stoppedBy}.`,
        inSitemap: sitemapKeys.has(item.normalized.key),
      })
    );
  }

  const pageList = [...pages.values()];
  linkBackwards(pageList);

  if (stoppedBy !== "completed") {
    limitations.push(
      `El crawl se detuvo por ${stoppedBy}: hay ${pageList.filter((p) => p.state === "NOT_FETCHED").length} URL(s) descubiertas sin rastrear.`
    );
  }

  return {
    entryUrl: seed.key,
    origin,
    crawledAt: startedAt.toISOString(),
    pages: pageList,
    architecture: buildArchitecture(pageList, seed.key),
    robots,
    sitemap,
    stats: buildStats(pageList, fetched, now().getTime() - startedAt.getTime(), stoppedBy),
    limitations,
  };
}

/** Fills each page's inbound links from every other page's outbound links. */
function linkBackwards(pages: CrawledPage[]): void {
  const byUrl = new Map(pages.map((page) => [page.url, page]));

  for (const page of pages) {
    for (const link of page.outboundLinks) {
      if (!link.internal) continue;
      const target = byUrl.get(link.to);
      // Self-links are not inbound links: a page does not make itself
      // important by linking to itself.
      if (!target || target.url === page.url) continue;
      if (!target.inboundLinks.includes(page.url)) target.inboundLinks.push(page.url);
    }
  }
}

export function buildArchitecture(pages: CrawledPage[], entryUrl: string): SiteArchitecture {
  const byDepth: Record<number, string[]> = {};
  let maxDepth = 0;

  for (const page of pages) {
    if (page.depth === null) continue;
    byDepth[page.depth] = [...(byDepth[page.depth] ?? []), page.url];
    maxDepth = Math.max(maxDepth, page.depth);
  }

  // Reachability is computed by walking links from the entry point, not by
  // trusting the depth assigned during the crawl: a sitemap-discovered page
  // has a depth but may be reachable by no link at all.
  const byUrl = new Map(pages.map((page) => [page.url, page]));
  const reachable = new Set<string>();
  const stack = [entryUrl];

  while (stack.length > 0) {
    const url = stack.pop()!;
    if (reachable.has(url)) continue;
    reachable.add(url);

    const page = byUrl.get(url);
    if (!page) continue;

    for (const link of page.outboundLinks) {
      if (link.internal && byUrl.has(link.to) && !reachable.has(link.to)) stack.push(link.to);
    }

    // A redirect destination is reached by anyone who follows the linked URL,
    // so it is not orphaned. Counting it as one would tell an owner to add
    // links to a page their visitors already land on.
    if (page.redirects.length > 0 && page.finalUrl !== page.url && byUrl.has(page.finalUrl)) {
      if (!reachable.has(page.finalUrl)) stack.push(page.finalUrl);
    }
  }

  const orphans = pages
    .filter((page) => !reachable.has(page.url))
    // A page nobody links to but that could not be fetched is not an orphan,
    // it is an unknown. Only pages that exist can be orphaned.
    .filter((page) => page.state !== "NOT_FETCHED" && page.state !== "UNREACHABLE")
    .map((page) => page.url);

  const crawled = pages.filter((page) => page.state === "OK" || page.state === "REDIRECT");

  return {
    byDepth,
    maxDepth,
    reachable: [...reachable],
    orphans,
    mostLinked: [...pages]
      .map((page) => ({ url: page.url, inbound: page.inboundLinks.length }))
      .filter((entry) => entry.inbound > 0)
      .sort((a, b) => b.inbound - a.inbound)
      .slice(0, 10),
    hubs: [...pages]
      .map((page) => ({ url: page.url, outbound: page.outboundLinks.filter((l) => l.internal).length }))
      .filter((entry) => entry.outbound > 0)
      .sort((a, b) => b.outbound - a.outbound)
      .slice(0, 10),
    averageOutboundLinks:
      crawled.length === 0
        ? 0
        : crawled.reduce((sum, page) => sum + page.outboundLinks.filter((l) => l.internal).length, 0) /
          crawled.length,
  };
}

function buildStats(
  pages: CrawledPage[],
  fetched: number,
  durationMs: number,
  stoppedBy: CrawlStats["stoppedBy"]
): CrawlStats {
  const count = (state: CrawledPage["state"]) => pages.filter((page) => page.state === state).length;

  return {
    requested: pages.length,
    fetched,
    ok: count("OK"),
    redirects: count("REDIRECT"),
    clientErrors: count("CLIENT_ERROR"),
    serverErrors: count("SERVER_ERROR"),
    unreachable: count("UNREACHABLE"),
    blockedByRobots: count("BLOCKED_BY_ROBOTS"),
    notFetched: count("NOT_FETCHED"),
    durationMs,
    stoppedBy,
  };
}

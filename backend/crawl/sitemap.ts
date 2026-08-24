import { fetchSafely, type SafetyOptions } from "@/lib/security/ssrf-guard";
import { normalizeUrl } from "./url-normalize";

/**
 * W2 — sitemap discovery and parsing.
 *
 * Handles both shapes of the protocol: a `<urlset>` of pages and a
 * `<sitemapindex>` pointing at more sitemaps, which is how any site above a
 * few thousand URLs is actually organised. Index files are followed one level
 * deep by default, because that is what the protocol allows — an index of
 * indexes is invalid, and following one anyway would be inventing support for
 * something no search engine honours.
 *
 * Reference: https://www.sitemaps.org/protocol.html
 *
 * Parsing is done with regex rather than a full XML parser on purpose: the
 * only thing needed is `<loc>` and `<lastmod>` inside two known elements, and
 * pulling in an XML dependency to read two tags would be the kind of
 * dependency the project's own rules tell it to avoid.
 */

export type SitemapStatus = "VERIFIED" | "NOT_FOUND" | "NOT_VERIFIED";

export interface SitemapEntry {
  url: string;
  lastModified: string | null;
  /** Which sitemap file declared it, so a bad entry can be traced back. */
  source: string;
}

export interface SitemapDocument {
  url: string;
  status: SitemapStatus;
  kind: "urlset" | "sitemapindex" | "unknown";
  entries: SitemapEntry[];
  /** Child sitemaps, when this document is an index. */
  children: string[];
  reason?: string;
}

export interface SitemapReport {
  status: SitemapStatus;
  /** Every sitemap document actually fetched. */
  documents: SitemapDocument[];
  /** All page URLs across every document, deduplicated by normalised key. */
  urls: SitemapEntry[];
  /** Where the sitemaps were found: robots.txt, the well-known path, or both. */
  discoveredVia: string[];
  reason?: string;
}

const LOC_PATTERN = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
const LASTMOD_PATTERN = /<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i;

function decodeXmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    // Ampersand last: decoding it first would corrupt the other entities.
    .replace(/&amp;/g, "&");
}

export function parseSitemap(xml: string, sourceUrl: string): SitemapDocument {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const isUrlset = /<urlset[\s>]/i.test(xml);

  if (!isIndex && !isUrlset) {
    return {
      url: sourceUrl,
      status: "NOT_VERIFIED",
      kind: "unknown",
      entries: [],
      children: [],
      reason: "El documento no contiene <urlset> ni <sitemapindex>: no es un sitemap válido.",
    };
  }

  // Split into records so <lastmod> is attributed to its own <loc> rather
  // than to whichever one happens to be nearest in the raw string.
  const recordPattern = isIndex ? /<sitemap[\s>][\s\S]*?<\/sitemap>/gi : /<url[\s>][\s\S]*?<\/url>/gi;
  const records = xml.match(recordPattern) ?? [];

  const entries: SitemapEntry[] = [];
  const children: string[] = [];

  for (const record of records) {
    LOC_PATTERN.lastIndex = 0;
    const locMatch = LOC_PATTERN.exec(record);
    if (!locMatch) continue;

    const loc = decodeXmlEntities(locMatch[1]).trim();
    if (!loc) continue;

    if (isIndex) {
      children.push(loc);
      continue;
    }

    const lastmodMatch = LASTMOD_PATTERN.exec(record);
    entries.push({
      url: loc,
      lastModified: lastmodMatch ? decodeXmlEntities(lastmodMatch[1]).trim() : null,
      source: sourceUrl,
    });
  }

  return {
    url: sourceUrl,
    status: "VERIFIED",
    kind: isIndex ? "sitemapindex" : "urlset",
    entries,
    children,
  };
}

async function fetchSitemapDocument(url: string, options: SafetyOptions): Promise<SitemapDocument> {
  try {
    const response = await fetchSafely(url, { timeoutMs: 12_000, maxBytes: 10_000_000, ...options });

    if (response.status === 404 || response.status === 410) {
      return { url, status: "NOT_FOUND", kind: "unknown", entries: [], children: [], reason: `HTTP ${response.status}` };
    }
    if (response.status >= 400) {
      return {
        url,
        status: "NOT_VERIFIED",
        kind: "unknown",
        entries: [],
        children: [],
        reason: `El sitemap devolvió HTTP ${response.status}.`,
      };
    }

    return parseSitemap(response.body, url);
  } catch (err) {
    return {
      url,
      status: "NOT_VERIFIED",
      kind: "unknown",
      entries: [],
      children: [],
      reason: err instanceof Error ? err.message : "No se pudo leer el sitemap.",
    };
  }
}

export interface DiscoverSitemapsOptions extends SafetyOptions {
  /** Sitemaps declared in robots.txt, which take precedence over guessing. */
  fromRobots?: string[];
  /** How many child sitemaps of an index to follow. */
  maxChildren?: number;
}

/**
 * Finds and reads the site's sitemaps. Tries what robots.txt declares first —
 * that is the authoritative location — and falls back to /sitemap.xml, which
 * is only a convention.
 */
export async function discoverSitemaps(
  origin: string,
  options: DiscoverSitemapsOptions = {}
): Promise<SitemapReport> {
  const maxChildren = options.maxChildren ?? 20;
  const discoveredVia: string[] = [];

  const candidates: string[] = [];
  for (const declared of options.fromRobots ?? []) {
    candidates.push(declared);
  }
  if (candidates.length > 0) discoveredVia.push("robots.txt");

  const wellKnown = `${origin}/sitemap.xml`;
  if (!candidates.includes(wellKnown)) candidates.push(wellKnown);

  const documents: SitemapDocument[] = [];
  const seen = new Set<string>();
  const queue = [...candidates];
  let childrenFollowed = 0;

  while (queue.length > 0) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);

    const document = await fetchSitemapDocument(url, options);
    documents.push(document);

    if (document.status === "VERIFIED" && url === wellKnown && !discoveredVia.includes("/sitemap.xml")) {
      discoveredVia.push("/sitemap.xml");
    }

    for (const child of document.children) {
      if (childrenFollowed >= maxChildren) break;
      if (seen.has(child)) continue;
      childrenFollowed += 1;
      queue.push(child);
    }
  }

  // Deduplicate across documents by normalised key: the same URL listed in
  // two sitemaps is one page, and counting it twice would inflate coverage.
  const byKey = new Map<string, SitemapEntry>();
  for (const document of documents) {
    for (const entry of document.entries) {
      const normalized = normalizeUrl(entry.url);
      if (!normalized) continue;
      if (!byKey.has(normalized.key)) byKey.set(normalized.key, { ...entry, url: normalized.key });
    }
  }

  const anyVerified = documents.some((document) => document.status === "VERIFIED");
  const allNotFound = documents.every((document) => document.status === "NOT_FOUND");

  return {
    status: anyVerified ? "VERIFIED" : allNotFound ? "NOT_FOUND" : "NOT_VERIFIED",
    documents,
    urls: [...byKey.values()],
    discoveredVia,
    ...(anyVerified
      ? {}
      : {
          reason: allNotFound
            ? "No se encontró ningún sitemap ni en robots.txt ni en /sitemap.xml."
            : documents.map((document) => document.reason).filter(Boolean).join(" "),
        }),
  };
}

/**
 * W2 — URL identity.
 *
 * Everything downstream depends on answering one question consistently: are
 * these two strings the same page? Get it wrong in one direction and the
 * crawler loops forever re-fetching the same thing; get it wrong in the other
 * and it reports duplicate content that does not exist.
 *
 * The line drawn here: normalisation only collapses differences that are
 * *unambiguously* the same resource by specification — the fragment, the
 * default port, the case of scheme and host, and tracking parameters that no
 * server uses for routing.
 *
 * Trailing slashes and ordinary query parameters are deliberately NOT
 * collapsed. `/servicios` and `/servicios/` really can be two different pages,
 * and merging them would hide the duplicate-content problem the crawler
 * exists to find. They are crawled separately and reported as duplicates only
 * if they actually serve the same content — an observation, not an assumption.
 */

/**
 * Parameters that identify a campaign, not a resource. Stripping them is safe
 * because no server routes on them; keeping them would make every shared link
 * look like a separate page.
 */
export const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "ref",
  "referrer",
];

export interface NormalizedUrl {
  /** The canonical identity used as a map key across the whole crawl. */
  key: string;
  /** The URL to actually request: identity plus anything routing depends on. */
  url: string;
  origin: string;
  path: string;
  /** Query parameters that survived normalisation, sorted. */
  params: string[];
  /** Tracking parameters that were stripped, so the report can say so. */
  strippedParams: string[];
  hadFragment: boolean;
}

export function normalizeUrl(raw: string, base?: string): NormalizedUrl | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const hadFragment = url.hash.length > 0;
  url.hash = "";

  // Case is insignificant in scheme and host, significant in the path.
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  // The default port for the scheme carries no information.
  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
    url.port = "";
  }

  const strippedParams: string[] = [];
  for (const param of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.includes(param.toLowerCase())) {
      strippedParams.push(param);
      url.searchParams.delete(param);
    }
  }

  // Sorting makes ?a=1&b=2 and ?b=2&a=1 the same key. Order is not
  // significant to any server that parses query strings correctly.
  url.searchParams.sort();

  const params = [...url.searchParams.keys()];

  return {
    key: url.toString(),
    url: url.toString(),
    origin: url.origin,
    path: url.pathname,
    params,
    strippedParams,
    hadFragment,
  };
}

/** Same registrable site, so the crawl stays inside the site it was given. */
export function sameSite(a: string, b: string): boolean {
  try {
    const first = new URL(a);
    const second = new URL(b);
    // www and the apex are the same site in practice; treating them as
    // different would make every www-canonical site look half-orphaned.
    return stripWww(first.hostname) === stripWww(second.hostname);
  } catch {
    return false;
  }
}

export function stripWww(hostname: string): string {
  return hostname.replace(/^www\./i, "");
}

/**
 * Whether two URLs differ only by a trailing slash. Used to *report* the
 * duplicate, never to silently merge the two.
 */
export function differsOnlyByTrailingSlash(a: string, b: string): boolean {
  const strip = (value: string) => value.replace(/\/+$/, "");
  return a !== b && strip(a) === strip(b);
}

/** Path depth from the root. `/` is 0, `/a` is 1, `/a/b` is 2. */
export function pathDepth(rawUrl: string): number {
  try {
    const { pathname } = new URL(rawUrl);
    return pathname.split("/").filter(Boolean).length;
  } catch {
    return 0;
  }
}

/** Extensions that are not pages, so the crawler does not fetch a PDF as HTML. */
const NON_PAGE_EXTENSIONS = [
  ".pdf", ".zip", ".rar", ".7z", ".gz", ".tar",
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".svg", ".ico", ".bmp",
  ".mp4", ".webm", ".mov", ".avi", ".mp3", ".wav", ".ogg",
  ".css", ".js", ".mjs", ".map", ".json", ".xml", ".rss",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
];

export function looksLikePage(rawUrl: string): boolean {
  try {
    const { pathname } = new URL(rawUrl);
    const lower = pathname.toLowerCase();
    return !NON_PAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
  } catch {
    return false;
  }
}

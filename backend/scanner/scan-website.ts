import * as cheerio from "cheerio";
import { fetchSafely, UnsafeUrlError, type SafetyOptions } from "@/lib/security/ssrf-guard";
import { PageSpeedProvider } from "@/lib/integrations/pagespeed/provider";
import {
  detectAnalytics,
  detectBooking,
  detectCms,
  detectConsent,
  detectEcommerce,
  extractSocialLinks,
} from "./detectors";

export interface WebsiteScanOutput {
  status: "completed" | "partial" | "failed";
  technical: Record<string, unknown>;
  seo: Record<string, unknown>;
  conversion: Record<string, unknown>;
  design: Record<string, unknown>;
  performance: Record<string, unknown>;
  /** Social profiles linked from the site itself — owner-attested (§12). */
  socialLinks: Record<string, string>;
  unavailableMetrics: string[];
  error?: string;
}

export interface ScanOptions extends SafetyOptions {
  /** How many internal links to probe for 404s. 0 disables the check. */
  brokenLinkSampleSize?: number;
}

const CTA_KEYWORDS = ["reserva", "reservar", "book", "contacta", "contactar", "llama", "call", "pide cita", "comprar", "presupuesto"];
const TESTIMONIAL_KEYWORDS = ["testimonio", "opinion", "opinión", "reseña", "review", "lo que dicen"];

function absoluteHost(url: string): string {
  return new URL(url).origin;
}

async function checkExists(url: string, options?: SafetyOptions): Promise<boolean> {
  try {
    const res = await fetchSafely(url, { timeoutMs: 6000, maxBytes: 200_000, ...options });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

/**
 * Probes a bounded sample of internal links for 404s. Deliberately a sample
 * and not a crawl: a full site crawl is a different, much heavier job, and
 * reporting "no broken links" after checking 10 of 400 pages would be a
 * claim we cannot support — hence the returned `checked` count.
 */
async function checkBrokenLinks(
  urls: string[],
  sampleSize: number,
  options?: SafetyOptions
): Promise<{ checked: number; broken: string[] }> {
  const sample = urls.slice(0, sampleSize);
  const broken: string[] = [];

  for (const url of sample) {
    try {
      const res = await fetchSafely(url, { timeoutMs: 5000, maxBytes: 100_000, ...options });
      if (res.status >= 400) broken.push(`${url} → ${res.status}`);
    } catch {
      broken.push(`${url} → sin respuesta`);
    }
  }

  return { checked: sample.length, broken };
}

/**
 * Scans a business's website for technical/SEO/conversion signals. Only
 * reports what was actually observed — anything that can't be determined
 * without a real browser (rendered mobile screenshot, full Core Web
 * Vitals field data, exhaustive broken-link crawl) is listed in
 * `unavailableMetrics` rather than guessed. See ARCHITECTURE.md §4/§8.
 */
export async function scanWebsite(
  websiteUrl: string,
  options?: ScanOptions
): Promise<WebsiteScanOutput> {
  const unavailableMetrics: string[] = [
    "mobile_rendering_screenshot",
    "full_site_broken_link_crawl",
    "field_core_web_vitals",
  ];
  const safety: SafetyOptions = { allowLoopbackForTesting: options?.allowLoopbackForTesting };

  let page;
  try {
    page = await fetchSafely(websiteUrl, { timeoutMs: 12_000, ...safety });
  } catch (err) {
    return {
      status: "failed",
      technical: {},
      seo: {},
      conversion: {},
      design: {},
      performance: {},
      socialLinks: {},
      unavailableMetrics,
      error: err instanceof UnsafeUrlError ? err.message : "No se pudo acceder a la web",
    };
  }

  const $ = cheerio.load(page.body);
  const host = absoluteHost(page.finalUrl);

  const [robotsTxtPresent, sitemapPresent] = await Promise.all([
    checkExists(`${host}/robots.txt`, safety),
    checkExists(`${host}/sitemap.xml`, safety),
  ]);

  const images = $("img");
  const imagesMissingAlt = images.filter((_, el) => !$(el).attr("alt")?.trim()).length;

  const links = $("a[href]");
  let internalLinks = 0;
  let externalLinks = 0;
  const internalUrls = new Set<string>();
  links.each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    try {
      const resolved = new URL(href, page.finalUrl);
      if (resolved.origin === host) {
        internalLinks++;
        resolved.hash = "";
        if (resolved.toString() !== page.finalUrl) internalUrls.add(resolved.toString());
      } else externalLinks++;
    } catch {
      /* ignore malformed hrefs */
    }
  });

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText.length > 0 ? bodyText.split(" ").length : 0;
  const bodyTextLower = bodyText.toLowerCase();

  const title = $("title").first().text().trim() || null;
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() || null;
  const canonical = $('link[rel="canonical"]').attr("href") || null;
  const viewportMeta = $('meta[name="viewport"]').attr("content") || null;
  const hasSchemaMarkup = $('script[type="application/ld+json"]').length > 0;

  const hasTelLink = $('a[href^="tel:"]').length > 0;
  const hasWhatsappLink = $('a[href*="wa.me"], a[href*="api.whatsapp.com"]').length > 0;
  const hasContactForm = $("form").length > 0;
  const hasEmailLink = $('a[href^="mailto:"]').length > 0;

  const htmlLang = $("html").attr("lang")?.trim() || null;
  const hreflangs = $('link[rel="alternate"][hreflang]')
    .map((_, el) => $(el).attr("hreflang"))
    .toArray()
    .filter(Boolean) as string[];

  const openGraph = {
    title: $('meta[property="og:title"]').attr("content")?.trim() || null,
    description: $('meta[property="og:description"]').attr("content")?.trim() || null,
    image: $('meta[property="og:image"]').attr("content")?.trim() || null,
  };

  // Structured-data @type values, so the audit can say "tiene schema de
  // Restaurant" instead of the useless "tiene schema".
  const structuredDataTypes: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).text());
      for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
        const type = node?.["@type"];
        if (typeof type === "string") structuredDataTypes.push(type);
        else if (Array.isArray(type)) structuredDataTypes.push(...type.filter((t) => typeof t === "string"));
      }
    } catch {
      /* malformed JSON-LD is itself reported below via schema_markup_valid */
    }
  });
  const schemaBlocks = $('script[type="application/ld+json"]').length;

  const cms = detectCms(page.body);
  const booking = detectBooking(page.body);
  const ecommerce = detectEcommerce(page.body);
  const analytics = detectAnalytics(page.body);
  const consent = detectConsent(page.body);
  const socialLinks = extractSocialLinks($, page.finalUrl);

  const brokenLinks = await checkBrokenLinks(
    [...internalUrls],
    options?.brokenLinkSampleSize ?? 8,
    safety
  );
  const ctaMatches = links
    .toArray()
    .concat($("button").toArray())
    .filter((el) => {
      const text = $(el).text().toLowerCase();
      return CTA_KEYWORDS.some((kw) => text.includes(kw));
    }).length;
  const hasTestimonialsSection = TESTIMONIAL_KEYWORDS.some((kw) => bodyTextLower.includes(kw));

  const technical: Record<string, unknown> = {
    https: new URL(page.finalUrl).protocol === "https:",
    http_status: page.status,
    html_size_bytes: page.bodyBytes,
    has_viewport_meta: Boolean(viewportMeta),
    image_count: images.length,
    images_missing_alt: imagesMissingAlt,
    schema_markup_present: hasSchemaMarkup,
    robots_txt_present: robotsTxtPresent,
    sitemap_present: sitemapPresent,
    canonical_present: Boolean(canonical),
    final_url: page.finalUrl,
    redirect_chain: page.redirects,
    redirect_count: page.redirects.length,
    upgrades_http_to_https: page.redirects.some(
      (hop) => hop.from.startsWith("http://") && hop.to.startsWith("https://")
    ),
    cms_detected: cms.map((c) => c.name),
    cms_markers: cms.map((c) => c.marker),
    analytics_detected: analytics.map((a) => a.name),
    consent_banner_detected: consent.map((c) => c.name),
    broken_links_checked: brokenLinks.checked,
    broken_links_found: brokenLinks.broken,
  };

  const seo: Record<string, unknown> = {
    title,
    title_length: title?.length ?? 0,
    meta_description: metaDescription,
    meta_description_length: metaDescription?.length ?? 0,
    h1_count: $("h1").length,
    h1_text: $("h1").first().text().trim() || null,
    h2_count: $("h2").length,
    word_count_estimate: wordCount,
    internal_link_count: internalLinks,
    external_link_count: externalLinks,
    html_lang: htmlLang,
    hreflang_locales: hreflangs,
    is_multilingual: hreflangs.length > 1,
    open_graph: openGraph,
    open_graph_complete: Boolean(openGraph.title && openGraph.description && openGraph.image),
    structured_data_types: structuredDataTypes,
    // A JSON-LD block that fails to parse is worse than none: Google ignores
    // it and the owner believes it is working.
    schema_markup_valid: schemaBlocks === 0 ? null : structuredDataTypes.length > 0,
    canonical_url: canonical,
  };

  const conversion: Record<string, unknown> = {
    has_phone_link: hasTelLink,
    has_whatsapp_link: hasWhatsappLink,
    has_contact_form: hasContactForm,
    cta_mentions_count: ctaMatches,
    has_testimonials_section: hasTestimonialsSection,
    has_email_link: hasEmailLink,
    form_count: $("form").length,
    booking_systems: booking.map((b) => b.name),
    has_booking_system: booking.length > 0,
    ecommerce_platforms: ecommerce.map((e) => e.name),
    has_ecommerce: ecommerce.length > 0,
    // Depending on a third-party booking platform is a commercial fact worth
    // surfacing on its own (§38), not just a technical one.
    depends_on_third_party_booking: booking.length > 0,
  };

  const design: Record<string, unknown> = {
    has_responsive_meta: Boolean(viewportMeta),
    // Visual design quality (jerarquía, legibilidad, antigüedad aparente)
    // requires a rendered screenshot + AI vision — not implemented; see
    // unavailableMetrics.
  };

  const pageSpeed = new PageSpeedProvider();
  let performance: Record<string, unknown> = {
    // Measured across the actual document fetch (including redirects), not
    // the follow-up robots/sitemap probes as it was before.
    server_response_time_ms: page.elapsedMs,
    _note: "server_response_time_ms es el tiempo real de descarga del documento, no son Core Web Vitals",
  };

  if (pageSpeed.isActive) {
    try {
      const result = await pageSpeed.analyze(page.finalUrl, "mobile");
      performance = { ...performance, lighthouse_performance_score: result.performanceScore, core_web_vitals: result.coreWebVitals };
    } catch {
      unavailableMetrics.push("pagespeed_lighthouse_score");
    }
  } else {
    unavailableMetrics.push("lighthouse_performance_score");
  }

  return {
    status: "completed",
    technical,
    seo,
    conversion,
    design,
    performance,
    socialLinks,
    unavailableMetrics,
  };
}

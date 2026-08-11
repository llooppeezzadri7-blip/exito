import * as cheerio from "cheerio";
import { fetchSafely, UnsafeUrlError } from "@/lib/security/ssrf-guard";
import { PageSpeedProvider } from "@/lib/integrations/pagespeed/provider";

export interface WebsiteScanOutput {
  status: "completed" | "partial" | "failed";
  technical: Record<string, unknown>;
  seo: Record<string, unknown>;
  conversion: Record<string, unknown>;
  design: Record<string, unknown>;
  performance: Record<string, unknown>;
  unavailableMetrics: string[];
  error?: string;
}

const CTA_KEYWORDS = ["reserva", "reservar", "book", "contacta", "contactar", "llama", "call", "pide cita", "comprar", "presupuesto"];
const TESTIMONIAL_KEYWORDS = ["testimonio", "opinion", "opinión", "reseña", "review", "lo que dicen"];

function absoluteHost(url: string): string {
  return new URL(url).origin;
}

async function checkExists(url: string): Promise<boolean> {
  try {
    const res = await fetchSafely(url, { timeoutMs: 6000, maxBytes: 200_000 });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

/**
 * Scans a business's website for technical/SEO/conversion signals. Only
 * reports what was actually observed — anything that can't be determined
 * without a real browser (rendered mobile screenshot, full Core Web
 * Vitals field data, exhaustive broken-link crawl) is listed in
 * `unavailableMetrics` rather than guessed. See ARCHITECTURE.md §4/§8.
 */
export async function scanWebsite(websiteUrl: string): Promise<WebsiteScanOutput> {
  const unavailableMetrics: string[] = [
    "mobile_rendering_screenshot",
    "full_site_broken_link_crawl",
    "field_core_web_vitals",
  ];

  let page;
  try {
    page = await fetchSafely(websiteUrl, { timeoutMs: 12_000 });
  } catch (err) {
    return {
      status: "failed",
      technical: {},
      seo: {},
      conversion: {},
      design: {},
      performance: {},
      unavailableMetrics,
      error: err instanceof UnsafeUrlError ? err.message : "No se pudo acceder a la web",
    };
  }

  const $ = cheerio.load(page.body);
  const host = absoluteHost(page.finalUrl);
  const startedAt = Date.now();

  const [robotsTxtPresent, sitemapPresent] = await Promise.all([
    checkExists(`${host}/robots.txt`),
    checkExists(`${host}/sitemap.xml`),
  ]);

  const images = $("img");
  const imagesMissingAlt = images.filter((_, el) => !$(el).attr("alt")?.trim()).length;

  const links = $("a[href]");
  let internalLinks = 0;
  let externalLinks = 0;
  links.each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    try {
      const resolved = new URL(href, page.finalUrl);
      if (resolved.origin === host) internalLinks++;
      else externalLinks++;
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
    html_size_bytes: Buffer.byteLength(page.body, "utf-8"),
    has_viewport_meta: Boolean(viewportMeta),
    image_count: images.length,
    images_missing_alt: imagesMissingAlt,
    schema_markup_present: hasSchemaMarkup,
    robots_txt_present: robotsTxtPresent,
    sitemap_present: sitemapPresent,
    canonical_present: Boolean(canonical),
  };

  const seo: Record<string, unknown> = {
    title,
    title_length: title?.length ?? 0,
    meta_description: metaDescription,
    meta_description_length: metaDescription?.length ?? 0,
    h1_count: $("h1").length,
    h2_count: $("h2").length,
    word_count_estimate: wordCount,
    internal_link_count: internalLinks,
    external_link_count: externalLinks,
  };

  const conversion: Record<string, unknown> = {
    has_phone_link: hasTelLink,
    has_whatsapp_link: hasWhatsappLink,
    has_contact_form: hasContactForm,
    cta_mentions_count: ctaMatches,
    has_testimonials_section: hasTestimonialsSection,
  };

  const design: Record<string, unknown> = {
    has_responsive_meta: Boolean(viewportMeta),
    // Visual design quality (jerarquía, legibilidad, antigüedad aparente)
    // requires a rendered screenshot + AI vision — not implemented; see
    // unavailableMetrics.
  };

  const pageSpeed = new PageSpeedProvider();
  let performance: Record<string, unknown> = {
    server_response_time_ms: Date.now() - startedAt,
    _note: "server_response_time_ms es un proxy aproximado, no son Core Web Vitals reales",
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
    unavailableMetrics,
  };
}

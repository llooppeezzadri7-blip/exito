import type { CheerioAPI } from "cheerio";

/**
 * Signature-based detection of the platforms and third-party systems a site
 * uses (brief §6). Every detector reports only what it actually matched, and
 * the matched marker is kept so the finding can be cited as evidence rather
 * than asserted.
 */

export interface DetectionHit {
  name: string;
  /** The literal marker found in the HTML — the proof for §17. */
  marker: string;
}

interface Signature {
  name: string;
  patterns: RegExp[];
}

const CMS_SIGNATURES: Signature[] = [
  { name: "WordPress", patterns: [/wp-content\//i, /wp-includes\//i, /name="generator" content="WordPress/i] },
  { name: "Wix", patterns: [/static\.wixstatic\.com/i, /X-Wix-/i, /wix-code/i] },
  { name: "Squarespace", patterns: [/squarespace\.com/i, /static1\.squarespace/i] },
  { name: "Webflow", patterns: [/assets\.website-files\.com/i, /assets-global\.website-files\.com/i, /data-wf-site=/i] },
  { name: "Shopify", patterns: [/cdn\.shopify\.com/i, /Shopify\.theme/i] },
  { name: "PrestaShop", patterns: [/prestashop/i] },
  { name: "Joomla", patterns: [/name="generator" content="Joomla/i, /\/media\/jui\//i] },
  { name: "Drupal", patterns: [/name="generator" content="Drupal/i, /\/sites\/default\/files\//i] },
  { name: "Elementor", patterns: [/elementor-page/i, /elementor-frontend/i] },
];

const BOOKING_SIGNATURES: Signature[] = [
  { name: "TheFork", patterns: [/thefork\.(com|es)/i, /lafourchette/i] },
  { name: "OpenTable", patterns: [/opentable\.(com|es)/i] },
  { name: "Myrestoo", patterns: [/myrestoo\.net/i] },
  { name: "CoverManager", patterns: [/covermanager\.com/i] },
  { name: "Booking.com", patterns: [/booking\.com/i] },
  { name: "Fresha", patterns: [/fresha\.com/i] },
  { name: "Treatwell", patterns: [/treatwell\.(es|com)/i] },
  { name: "Booksy", patterns: [/booksy\.com/i] },
  { name: "Mindbody", patterns: [/mindbodyonline\.com/i] },
  { name: "Calendly", patterns: [/calendly\.com/i] },
  { name: "Doctoralia", patterns: [/doctoralia\.es/i] },
];

const ECOMMERCE_SIGNATURES: Signature[] = [
  { name: "WooCommerce", patterns: [/woocommerce/i] },
  { name: "Shopify", patterns: [/cdn\.shopify\.com/i] },
  { name: "PrestaShop", patterns: [/prestashop/i] },
  { name: "Magento", patterns: [/mage\/|magento/i] },
];

const ANALYTICS_SIGNATURES: Signature[] = [
  { name: "Google Analytics 4", patterns: [/gtag\/js\?id=G-/i, /googletagmanager\.com\/gtag/i] },
  { name: "Google Tag Manager", patterns: [/googletagmanager\.com\/gtm\.js/i, /GTM-[A-Z0-9]+/] },
  { name: "Universal Analytics (obsoleto)", patterns: [/google-analytics\.com\/analytics\.js/i, /\bUA-\d{4,}-\d+/] },
  { name: "Meta Pixel", patterns: [/connect\.facebook\.net\/.*fbevents\.js/i, /fbq\(\s*['"]init['"]/i] },
  { name: "TikTok Pixel", patterns: [/analytics\.tiktok\.com/i] },
];

const CONSENT_SIGNATURES: Signature[] = [
  { name: "Cookiebot", patterns: [/cookiebot/i] },
  { name: "Complianz", patterns: [/complianz/i] },
  { name: "CookieYes", patterns: [/cookieyes/i] },
  { name: "OneTrust", patterns: [/onetrust/i] },
  { name: "Banner genérico", patterns: [/id="cookie|class="[^"]*cookie-(banner|notice|consent)/i] },
];

function detect(html: string, signatures: Signature[]): DetectionHit[] {
  const hits: DetectionHit[] = [];
  for (const signature of signatures) {
    for (const pattern of signature.patterns) {
      const match = html.match(pattern);
      if (match) {
        hits.push({ name: signature.name, marker: match[0].slice(0, 120) });
        break;
      }
    }
  }
  return hits;
}

export const detectCms = (html: string) => detect(html, CMS_SIGNATURES);
export const detectBooking = (html: string) => detect(html, BOOKING_SIGNATURES);
export const detectEcommerce = (html: string) => detect(html, ECOMMERCE_SIGNATURES);
export const detectAnalytics = (html: string) => detect(html, ANALYTICS_SIGNATURES);
export const detectConsent = (html: string) => detect(html, CONSENT_SIGNATURES);

const SOCIAL_HOSTS: { platform: string; pattern: RegExp }[] = [
  { platform: "instagram", pattern: /^(www\.)?instagram\.com$/i },
  { platform: "facebook", pattern: /^(www\.|[a-z]{2}-[a-z]{2}\.)?facebook\.com$/i },
  { platform: "tiktok", pattern: /^(www\.)?tiktok\.com$/i },
  { platform: "linkedin", pattern: /^([a-z]{2}\.|www\.)?linkedin\.com$/i },
  { platform: "youtube", pattern: /^(www\.)?youtube\.com$/i },
  { platform: "x", pattern: /^(www\.)?(twitter|x)\.com$/i },
];

/**
 * Social profiles linked *from the business's own website*. This is the only
 * high-confidence way to attribute a profile to a business (§12): the owner
 * put the link there. Search-result guesses are not equivalent and must not
 * be merged into this.
 */
export function extractSocialLinks($: CheerioAPI, baseUrl: string): Record<string, string> {
  const found: Record<string, string> = {};

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let url: URL;
    try {
      url = new URL(href, baseUrl);
    } catch {
      return;
    }

    for (const { platform, pattern } of SOCIAL_HOSTS) {
      if (!pattern.test(url.hostname)) continue;
      // Skip bare platform links and share/intent widgets — a share button is
      // not the business's profile.
      const path = url.pathname.replace(/\/+$/, "");
      if (path === "" || /\/(sharer|share|intent)/i.test(path)) continue;
      if (!found[platform]) found[platform] = url.toString();
    }
  });

  return found;
}

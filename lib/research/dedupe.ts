/**
 * Duplicate detection (brief §2). Two records are the same business when
 * they share a strong identifier (place_id, phone, registrable domain) or
 * when a weaker combination agrees (normalised name + street number in the
 * same city). Name alone is never enough — "Bar Nou" exists in every town on
 * the Costa Brava, and merging two of them silently corrupts the pipeline.
 */

export interface DedupeCandidate {
  gbp_place_id?: string | null;
  name: string;
  phone?: string | null;
  website_url?: string | null;
  address?: string | null;
  city?: string | null;
}

export type MatchReason =
  | "place_id"
  | "phone"
  | "domain"
  | "name_and_address"
  | "name_and_city_exact";

export interface DuplicateMatch<T> {
  existing: T;
  reason: MatchReason;
  /** Strong matches are safe to merge automatically; weak ones need review. */
  confidence: "strong" | "weak";
}

/** Spanish numbers written a dozen ways all reduce to the same digits. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (digits.length < 6) return null;
  // Drop the Spanish country code so +34972373401, 0034972373401 and
  // 972373401 collapse to one key.
  const withoutCc = digits.startsWith("34") && digits.length > 9 ? digits.slice(2) : digits;
  const withoutIntlPrefix = withoutCc.startsWith("0034") ? withoutCc.slice(4) : withoutCc;
  return withoutIntlPrefix;
}

const MULTI_PART_TLDS = new Set(["co.uk", "com.es", "org.es", "gob.es", "com.br", "co.jp"]);

/**
 * The registrable domain, so https://www.ejemplo.es/menu and
 * http://ejemplo.es both key to "ejemplo.es". Subdomains are dropped
 * deliberately: a business on shop.ejemplo.es is the same business.
 */
export function registrableDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let host: string;
  try {
    host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "");
  const parts = host.split(".");
  if (parts.length <= 2) return host;

  const lastTwo = parts.slice(-2).join(".");
  return MULTI_PART_TLDS.has(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

/**
 * Hosts where the registrable domain identifies the *platform*, not the
 * business: two different companies can sit on wixsite.com or wordpress.com
 * and be told apart only by their path. Treating those as an identity would
 * merge unrelated prospects into one — so for identity purposes they count
 * as no domain at all. Bare IPs are included for the same reason.
 */
const MULTI_TENANT_HOSTS = new Set([
  "wixsite.com",
  "wordpress.com",
  "blogspot.com",
  "weebly.com",
  "squarespace.com",
  "myshopify.com",
  "webnode.es",
  "jimdosite.com",
  "github.io",
  "netlify.app",
  "vercel.app",
  "sites.google.com",
  "business.site",
  "negocio.site",
  "facebook.com",
  "instagram.com",
  "linktr.ee",
]);

/**
 * The domain only when it actually identifies one business. Returns null for
 * shared platforms and IP literals, so `findDuplicate` never merges on them.
 */
export function identityDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let hostname: string;
  try {
    hostname = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return null;
  }

  // An IP address is a server, not a brand.
  if (/^[\d.]+$/.test(hostname) || hostname.includes(":")) return null;

  const domain = registrableDomain(raw);
  if (!domain) return null;
  return MULTI_TENANT_HOSTS.has(domain) ? null : domain;
}

const BUSINESS_NOISE = [
  "restaurant",
  "restaurante",
  "bar",
  "cafeteria",
  "cafeteria",
  "hotel",
  "taller",
  "clinica",
  "clinica dental",
  "peluqueria",
  "perruqueria",
  "sl",
  "s l",
  "sa",
  "s a",
  "scp",
  "s c p",
  "cb",
  "c b",
];

export function normalizeName(raw: string): string {
  const base = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = base.split(" ").filter((w) => w && !BUSINESS_NOISE.includes(w));
  // If stripping generic words leaves nothing ("Restaurant Bar"), keep the
  // original: an empty key would match every other emptied name.
  return words.length > 0 ? words.join(" ") : base;
}

/** Street name + number, normalised. Postal codes and floors are ignored. */
export function normalizeAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(carrer|calle|c|avinguda|avenida|av|placa|plaza|pl|passeig|paseo)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 0 ? normalized : null;
}

function streetNumber(address: string | null | undefined): string | null {
  if (!address) return null;
  const match = address.match(/\b(\d{1,4})\b/);
  return match ? match[1] : null;
}

/**
 * Finds an existing record that is the same business as `candidate`.
 * Returns the first strong match if there is one, otherwise the best weak
 * match, so callers can choose to merge automatically or queue for review.
 */
export function findDuplicate<T extends DedupeCandidate>(
  candidate: DedupeCandidate,
  existing: T[]
): DuplicateMatch<T> | null {
  const candidatePhone = normalizePhone(candidate.phone);
  const candidateDomain = identityDomain(candidate.website_url);
  const candidateName = normalizeName(candidate.name);
  const candidateNumber = streetNumber(candidate.address);
  const candidateStreet = normalizeAddress(candidate.address);
  const candidateCity = candidate.city ? normalizeName(candidate.city) : null;

  let weak: DuplicateMatch<T> | null = null;

  for (const item of existing) {
    if (candidate.gbp_place_id && item.gbp_place_id && candidate.gbp_place_id === item.gbp_place_id) {
      return { existing: item, reason: "place_id", confidence: "strong" };
    }

    const itemPhone = normalizePhone(item.phone);
    if (candidatePhone && itemPhone && candidatePhone === itemPhone) {
      return { existing: item, reason: "phone", confidence: "strong" };
    }

    const itemDomain = identityDomain(item.website_url);
    if (candidateDomain && itemDomain && candidateDomain === itemDomain) {
      return { existing: item, reason: "domain", confidence: "strong" };
    }

    if (weak) continue;

    const itemName = normalizeName(item.name);
    if (candidateName !== itemName) continue;

    const itemNumber = streetNumber(item.address);
    const itemStreet = normalizeAddress(item.address);

    if (candidateNumber && itemNumber && candidateNumber === itemNumber && candidateStreet === itemStreet) {
      weak = { existing: item, reason: "name_and_address", confidence: "weak" };
      continue;
    }

    const itemCity = item.city ? normalizeName(item.city) : null;
    if (candidateCity && itemCity && candidateCity === itemCity) {
      weak = { existing: item, reason: "name_and_city_exact", confidence: "weak" };
    }
  }

  return weak;
}

/**
 * Removes duplicates within a freshly discovered batch, before anything
 * touches the database. Returns the kept records and what was dropped, so
 * the discovery job can report it instead of silently shrinking.
 */
export function dedupeBatch<T extends DedupeCandidate>(
  records: T[]
): { unique: T[]; duplicates: { record: T; reason: MatchReason }[] } {
  const unique: T[] = [];
  const duplicates: { record: T; reason: MatchReason }[] = [];

  for (const record of records) {
    const match = findDuplicate(record, unique);
    if (match) duplicates.push({ record, reason: match.reason });
    else unique.push(record);
  }

  return { unique, duplicates };
}

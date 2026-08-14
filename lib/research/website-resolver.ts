import * as cheerio from "cheerio";
import { fetchSafely, type SafetyOptions } from "@/lib/security/ssrf-guard";
import { normalizeName, normalizePhone, registrableDomain } from "./dedupe";
import { fact, unverified, verified, type Evidence, type MaybeDataPoint } from "./evidence";

/**
 * Official-website resolution (brief §5).
 *
 * This module exists because of a concrete failure: guessing that a business
 * had no website from the absence of search results, twice, wrongly. So the
 * rules here are deliberately conservative:
 *
 *   - A candidate is only accepted when the page itself corroborates the
 *     business (its phone, its name, or its address appears on it).
 *   - Several corroborated candidates means NO_VERIFICADO, not "pick the
 *     first" — a restaurant whose site lives under a different brand name is
 *     exactly the case that must not be resolved by guessing.
 *   - Not finding a website is never reported as "has no website". It is
 *     reported as not found, with the checks that were run.
 */

export type CandidateOrigin =
  | "google_places"
  | "social_profile_link"
  | "search_result"
  | "manual";

export interface WebsiteCandidate {
  url: string;
  origin: CandidateOrigin;
}

export interface BusinessIdentity {
  name: string;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
}

export interface CandidateAssessment {
  url: string;
  origin: CandidateOrigin;
  reachable: boolean;
  httpStatus: number | null;
  /** Which identity signals the page corroborated. */
  matchedSignals: ("phone" | "name" | "address" | "city")[];
  /** 0-4 — how many independent identity signals agreed. */
  matchScore: number;
  error?: string;
}

export interface WebsiteResolution {
  website: MaybeDataPoint<string>;
  assessments: CandidateAssessment[];
  evidence: Evidence[];
}

function textOf(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  return $("body").text().replace(/\s+/g, " ").toLowerCase();
}

/** Every phone-shaped string on the page, normalised for comparison. */
function phonesIn(html: string): Set<string> {
  const found = new Set<string>();
  const $ = cheerio.load(html);

  $('a[href^="tel:"]').each((_, el) => {
    const normalized = normalizePhone($(el).attr("href")?.replace("tel:", ""));
    if (normalized) found.add(normalized);
  });

  // Loose match over visible text for numbers not wired as tel: links.
  const text = $("body").text();
  for (const match of text.matchAll(/(?:\+?\d[\d\s.\-()]{7,})/g)) {
    const normalized = normalizePhone(match[0]);
    if (normalized) found.add(normalized);
  }

  return found;
}

async function assessCandidate(
  candidate: WebsiteCandidate,
  identity: BusinessIdentity,
  options?: SafetyOptions
): Promise<CandidateAssessment> {
  const base: CandidateAssessment = {
    url: candidate.url,
    origin: candidate.origin,
    reachable: false,
    httpStatus: null,
    matchedSignals: [],
    matchScore: 0,
  };

  let page;
  try {
    page = await fetchSafely(candidate.url, { timeoutMs: 10_000, maxBytes: 2_000_000, ...options });
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : "No se pudo acceder" };
  }

  if (page.status >= 400) {
    return { ...base, httpStatus: page.status, error: `HTTP ${page.status}` };
  }

  const text = textOf(page.body);
  const matched: CandidateAssessment["matchedSignals"] = [];

  const identityPhone = normalizePhone(identity.phone);
  if (identityPhone && phonesIn(page.body).has(identityPhone)) matched.push("phone");

  const nameKey = normalizeName(identity.name);
  if (nameKey.length >= 3 && text.includes(nameKey)) matched.push("name");

  if (identity.address) {
    // Match on the distinctive part of the street, not the whole formatted
    // address: street-type words ("carrer", "avinguda") appear in every
    // Catalan address and would match any local site at all.
    const streetTypes = new Set([
      "carrer",
      "calle",
      "avinguda",
      "avenida",
      "placa",
      "plaza",
      "passeig",
      "paseo",
      "camino",
      "cami",
    ]);
    const streetWords = identity.address
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[\s,]+/)
      .filter((w) => w.length > 3 && !streetTypes.has(w));
    if (streetWords.length > 0 && streetWords.some((w) => text.includes(w))) matched.push("address");
  }

  if (identity.city && text.includes(identity.city.toLowerCase())) matched.push("city");

  return {
    ...base,
    reachable: true,
    httpStatus: page.status,
    matchedSignals: matched,
    matchScore: matched.length,
  };
}

/**
 * How strongly a page proves it belongs to this business.
 *
 * The name alone is explicitly not enough. "Restaurante El Gaucho" exists in
 * more than one town on this coast, and accepting a name match would attribute
 * a homonym's website to our prospect — the precise error this module exists
 * to prevent. Only phone and street address are unique enough to stand alone;
 * name counts only when the town agrees too.
 */
type CorroborationLevel = "strong" | "moderate" | "none";

function corroborationLevel(assessment: CandidateAssessment): CorroborationLevel {
  if (!assessment.reachable) return "none";

  const signals = assessment.matchedSignals;
  const hardSignals = signals.filter((s) => s === "phone" || s === "address").length;
  const hasName = signals.includes("name");
  const hasCity = signals.includes("city");

  if (hardSignals >= 2 || (hardSignals === 1 && hasName)) return "strong";
  if (hardSignals === 1) return "moderate";
  if (hasName && hasCity) return "moderate";
  return "none";
}

function isCorroborated(assessment: CandidateAssessment): boolean {
  return corroborationLevel(assessment) !== "none";
}

export async function resolveOfficialWebsite(
  identity: BusinessIdentity,
  candidates: WebsiteCandidate[],
  options?: SafetyOptions & { now?: Date }
): Promise<WebsiteResolution> {
  const now = options?.now;
  const evidence: Evidence[] = [];

  if (candidates.length === 0) {
    return {
      website: unverified(
        "No se ha probado ningún candidato: buscar el negocio en Google y en sus redes antes de concluir que no tiene web.",
        now
      ),
      assessments: [],
      evidence,
    };
  }

  const assessments: CandidateAssessment[] = [];
  for (const candidate of candidates) {
    assessments.push(await assessCandidate(candidate, identity, options));
  }

  const corroborated = assessments.filter(isCorroborated);

  // Distinct sites, not distinct URLs: http/https and www variants of the
  // same domain are one candidate, not a conflict.
  const distinctDomains = new Set(corroborated.map((a) => registrableDomain(a.url)));

  if (corroborated.length === 0) {
    const tried = assessments.map((a) => `${a.url} (${a.error ?? `sin coincidencias`})`).join("; ");
    return {
      website: unverified(
        `Ningún candidato acredita pertenecer al negocio. Comprobados: ${tried}.`,
        now
      ),
      assessments,
      evidence,
    };
  }

  if (distinctDomains.size > 1) {
    const list = corroborated.map((a) => `${a.url} [${a.matchedSignals.join("+")}]`).join("; ");
    evidence.push(
      fact({
        statement: `Varias webs distintas acreditan pertenecer al negocio: ${list}. Sin confirmación manual no se puede designar la oficial.`,
        source: "internal_database",
        method: "cross_reference",
        now,
      })
    );
    return {
      website: unverified(
        `Varios dominios candidatos corroborados (${[...distinctDomains].join(", ")}): confirmar cuál es el oficial.`,
        now
      ),
      assessments,
      evidence,
    };
  }

  // One domain, corroborated. Prefer the Places-supplied URL when present,
  // since it comes from the owner's own Google listing.
  const best = [...corroborated].sort((a, b) => {
    if (a.origin === "google_places" && b.origin !== "google_places") return -1;
    if (b.origin === "google_places" && a.origin !== "google_places") return 1;
    return b.matchScore - a.matchScore;
  })[0];

  evidence.push(
    fact({
      statement: `La web ${best.url} corrobora la identidad del negocio (coincide: ${best.matchedSignals.join(", ")}).`,
      source: "official_website",
      method: "cross_reference",
      sourceUrl: best.url,
      now,
    })
  );

  return {
    website: verified({
      value: best.url,
      source: best.origin === "google_places" ? "google_places" : "official_website",
      method: "cross_reference",
      sourceUrl: best.url,
      status: corroborationLevel(best) === "strong" ? "VERIFICADO" : "PROBABLE",
      now,
    }),
    assessments,
    evidence,
  };
}

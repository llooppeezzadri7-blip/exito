import type { Settings } from "@/lib/database/types";
import type { RawBusinessRecord } from "@/lib/integrations/business-sources/types";
import { analyzeBusiness, type BusinessAnalysis } from "./analyze-business";
import type { Recommendation } from "./recommend";
import type { BusinessProblem } from "./diagnose";

/**
 * Processing a portfolio rather than one business.
 *
 * This is what turns the analyser into something an agency can run on a
 * Monday morning: give it the businesses it found, get back a ranked list of
 * who to call first and what to say.
 *
 * Two properties matter more than throughput. First, one business failing
 * must never take down the batch — a dead website is a normal outcome, not an
 * error. Second, the ranking has to be honest: a business analysed with half
 * the model measured cannot outrank one measured completely just because its
 * raw numbers looked worse.
 */

export type OpportunityConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface OpportunityRecord {
  /** Input, carried through untouched. */
  business: {
    name: string;
    website: string | null;
    city: string | null;
    sector: string | null;
    phone: string | null;
    rating: number | null;
    reviewCount: number | null;
  };
  /** 0–100. Null when nothing could be measured. */
  opportunityScore: number | null;
  confidence: OpportunityConfidence;
  /** Share of the audit model that actually produced a measurement. */
  evidenceCoverage: number;
  status: OpportunityStatus;
  problems: BusinessProblem[];
  recommendation: Recommendation | null;
  /** Money the recommended work is worth, from the real catalogue. */
  estimatedValueEur: number | null;
  /** Why this score. Every line is an observation, never a guess. */
  reasons: string[];
  analysis: BusinessAnalysis | null;
  error: string | null;
}

export type OpportunityStatus =
  | "ALTA_OPORTUNIDAD"
  | "OPORTUNIDAD_MEDIA"
  | "SIN_OPORTUNIDAD_CLARA"
  | "EVIDENCIA_INSUFICIENTE"
  | "SIN_WEB"
  | "NO_ANALIZADO";

/**
 * How much a business is worth pursuing.
 *
 * Deliberately NOT the same as "how broken is the website". A terrible site
 * belonging to a business nobody visits is worth less than a mediocre site
 * belonging to one with four hundred reviews — the second has customers to
 * lose and money to spend. That asymmetry is the whole point of §2 of the
 * brief: we are not looking for ugly websites.
 */
export interface OpportunityWeights {
  /** How much is broken, and how badly. */
  problemSeverity: number;
  /** How much the business appears able to pay, from public signals. */
  businessQuality: number;
  /** What the recommended work is worth to us. */
  projectValue: number;
  /** Whether we can actually reach them. */
  contactability: number;
}

export const DEFAULT_OPPORTUNITY_WEIGHTS: OpportunityWeights = {
  problemSeverity: 40,
  businessQuality: 30,
  projectValue: 20,
  contactability: 10,
};

/**
 * Business quality from public signals only. Returns null when there are no
 * signals at all — which is different from "a bad business", and the caller
 * has to be able to tell the two apart.
 */
export function businessQualityScore(
  rating: number | null,
  reviewCount: number | null
): { score: number | null; reason: string } {
  if (rating === null && reviewCount === null) {
    return {
      score: null,
      reason: "Sin valoración ni número de reseñas: no hay señal pública de la calidad del negocio.",
    };
  }

  // Reviews carry more weight than the rating itself: a 5.0 from three
  // reviews says far less about a business than a 4.3 from four hundred.
  const volume = reviewCount === null ? null : Math.min(reviewCount / 200, 1);
  const quality = rating === null ? null : Math.max(0, (rating - 3) / 2);

  if (volume === null) {
    return {
      score: Math.round((quality ?? 0) * 60),
      reason: `Valoración ${rating} sin número de reseñas conocido: la señal es débil.`,
    };
  }
  if (quality === null) {
    return {
      score: Math.round(volume * 60),
      reason: `${reviewCount} reseñas sin valoración conocida.`,
    };
  }

  return {
    score: Math.round((volume * 0.6 + quality * 0.4) * 100),
    reason: `${rating}★ con ${reviewCount} reseñas: negocio con clientela y reputación establecida.`,
  };
}

function severityScore(problems: BusinessProblem[]): { score: number; reason: string } {
  if (problems.length === 0) {
    return { score: 0, reason: "No se detectó ningún problema de negocio." };
  }

  const weights = { critical: 25, serious: 12, moderate: 5 };
  const raw = problems.reduce((sum, problem) => sum + weights[problem.severity], 0);
  const critical = problems.filter((problem) => problem.severity === "critical").length;

  return {
    score: Math.min(raw, 100),
    reason:
      critical > 0
        ? `${problems.length} problemas, ${critical} de ellos críticos: hay pérdidas ocurriendo hoy.`
        : `${problems.length} problemas, ninguno crítico: margen de mejora sin urgencia.`,
  };
}

function valueScore(estimatedValueEur: number | null): { score: number; reason: string } {
  if (estimatedValueEur === null) {
    return { score: 0, reason: "El trabajo recomendado no tiene precio en el catálogo." };
  }
  // 3.000 € is treated as a full-value project for a local business.
  return {
    score: Math.min(Math.round((estimatedValueEur / 3000) * 100), 100),
    reason: `El trabajo recomendado vale ${estimatedValueEur} € según el catálogo actual.`,
  };
}

function contactabilityScore(phone: string | null, website: string | null): { score: number; reason: string } {
  if (phone && website) return { score: 100, reason: "Teléfono y web públicos: contactable directamente." };
  if (phone) return { score: 70, reason: "Teléfono público, sin web conocida." };
  if (website) return { score: 40, reason: "Solo web: habrá que buscar la vía de contacto en ella." };
  return { score: 0, reason: "Sin teléfono ni web conocidos: no hay por dónde contactar." };
}

export function confidenceFrom(coverage: number, hasBusinessSignals: boolean): OpportunityConfidence {
  if (coverage >= 0.85 && hasBusinessSignals) return "HIGH";
  if (coverage >= 0.6) return "MEDIUM";
  return "LOW";
}

export interface ScoreOpportunityInput {
  rating: number | null;
  reviewCount: number | null;
  phone: string | null;
  website: string | null;
  problems: BusinessProblem[];
  recommendation: Recommendation | null;
  weights?: OpportunityWeights;
}

export interface OpportunityScoreResult {
  score: number | null;
  confidence: OpportunityConfidence;
  reasons: string[];
}

export function scoreOpportunity(input: ScoreOpportunityInput): OpportunityScoreResult {
  const weights = input.weights ?? DEFAULT_OPPORTUNITY_WEIGHTS;
  const reasons: string[] = [];

  // Nothing measured means no score. Not a zero — a zero would rank this
  // business below one we know is a bad fit, which is a different claim.
  if (!input.recommendation || input.recommendation.verdict === "evidencia_insuficiente") {
    return {
      score: null,
      confidence: "LOW",
      reasons: ["No se pudo analizar la web, así que no hay puntuación de oportunidad."],
    };
  }

  const severity = severityScore(input.problems);
  const quality = businessQualityScore(input.rating, input.reviewCount);
  const value = valueScore(input.recommendation.totalEur);
  const contact = contactabilityScore(input.phone, input.website);

  reasons.push(severity.reason, quality.reason, value.reason, contact.reason);

  // A factor with no signal contributes no weight rather than zero points,
  // and the total is rescaled over what could be measured — the same rule
  // the audit model runs on.
  const parts: { score: number; weight: number }[] = [
    { score: severity.score, weight: weights.problemSeverity },
    { score: value.score, weight: weights.projectValue },
    { score: contact.score, weight: weights.contactability },
  ];
  if (quality.score !== null) parts.push({ score: quality.score, weight: weights.businessQuality });

  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  const earned = parts.reduce((sum, part) => sum + part.score * part.weight, 0);

  return {
    score: Math.round(earned / totalWeight),
    confidence: confidenceFrom(input.recommendation.evidenceCoverage, quality.score !== null),
    reasons,
  };
}

/** Score at or above which a business can qualify as a high opportunity. */
export const HIGH_OPPORTUNITY_SCORE = 75;

export function opportunityStatus(
  record: Pick<OpportunityRecord, "opportunityScore" | "recommendation" | "problems">
): OpportunityStatus {
  if (!record.recommendation) return "NO_ANALIZADO";
  if (record.recommendation.verdict === "evidencia_insuficiente") return "EVIDENCIA_INSUFICIENTE";
  if (record.recommendation.verdict === "web_nueva") return "SIN_WEB";
  if (record.recommendation.verdict === "sin_oportunidad_clara") return "SIN_OPORTUNIDAD_CLARA";

  // A high opportunity needs more than a good number: it needs something
  // broken that is losing the business customers *today*. A missing
  // certificate hurts trust and is fixed in an afternoon — it does not make
  // someone a priority prospect, and labelling it as one is how a ranking
  // ends up saying "call everybody", which is the same as saying nothing.
  const losingCustomersNow = record.problems.some(
    (problem) => problem.severity === "critical" && problem.impact === "pierde_clientes"
  );

  if ((record.opportunityScore ?? 0) >= HIGH_OPPORTUNITY_SCORE && losingCustomersNow) {
    return "ALTA_OPORTUNIDAD";
  }
  return "OPORTUNIDAD_MEDIA";
}

export interface BatchOptions {
  settings: Settings;
  allowLoopbackForTesting?: boolean;
  maxPagesPerSite?: number;
  skipMobile?: boolean;
  mobileOptions?: { executablePath?: string; allowLoopbackForTesting?: boolean };
  singlePage?: boolean;
  weights?: OpportunityWeights;
  onProgress?: (index: number, total: number, name: string, status: string) => void;
}

export interface BatchResult {
  records: OpportunityRecord[];
  /** Ranked: highest opportunity first. Unscored businesses are excluded. */
  ranking: OpportunityRecord[];
  stats: {
    total: number;
    analyzed: number;
    withoutWebsite: number;
    failed: number;
    highOpportunity: number;
    noOpportunity: number;
    totalPipelineValueEur: number;
  };
  durationMs: number;
}

/**
 * Runs the whole chain over a list of businesses.
 *
 * Sequential on purpose: each analysis crawls a site and may launch a
 * browser, and running ten of those at once is how you get rate-limited by
 * the very sites you are trying to sell to.
 */
export async function analyzePortfolio(
  businesses: RawBusinessRecord[],
  options: BatchOptions
): Promise<BatchResult> {
  const startedAt = Date.now();
  const records: OpportunityRecord[] = [];

  for (const [index, business] of businesses.entries()) {
    const identity: OpportunityRecord["business"] = {
      name: business.name,
      website: business.website_url ?? null,
      city: business.city ?? null,
      sector: business.sector ?? null,
      phone: business.phone ?? null,
      rating: business.rating ?? null,
      reviewCount: business.review_count ?? null,
    };

    // No website is not a failure: it is the clearest opportunity there is,
    // and the recommendation engine already knows what to do with it.
    if (!identity.website) {
      const quality = businessQualityScore(identity.rating, identity.reviewCount);
      options.onProgress?.(index, businesses.length, business.name, "sin web");

      records.push({
        business: identity,
        opportunityScore: quality.score,
        confidence: quality.score === null ? "LOW" : "MEDIUM",
        evidenceCoverage: 0,
        status: "SIN_WEB",
        problems: [],
        recommendation: null,
        estimatedValueEur: null,
        reasons: [
          "No consta web propia en los datos de entrada.",
          quality.reason,
          "La ausencia de web debe corroborarse antes de afirmarla: puede existir y no estar registrada.",
        ],
        analysis: null,
        error: null,
      });
      continue;
    }

    options.onProgress?.(index, businesses.length, business.name, "analizando");

    try {
      const analysis = await analyzeBusiness(identity.website, {
        settings: options.settings,
        businessName: business.name,
        allowLoopbackForTesting: options.allowLoopbackForTesting,
        maxPages: options.maxPagesPerSite ?? 20,
        skipMobile: options.skipMobile,
        mobileOptions: options.mobileOptions,
        singlePage: options.singlePage,
      });

      const scored = scoreOpportunity({
        rating: identity.rating,
        reviewCount: identity.reviewCount,
        phone: identity.phone,
        website: identity.website,
        problems: analysis.problems,
        recommendation: analysis.recommendation,
        weights: options.weights,
      });

      const record: OpportunityRecord = {
        business: identity,
        opportunityScore: scored.score,
        confidence: scored.confidence,
        evidenceCoverage: analysis.recommendation.evidenceCoverage,
        status: "NO_ANALIZADO",
        problems: analysis.problems,
        recommendation: analysis.recommendation,
        estimatedValueEur: analysis.recommendation.totalEur,
        reasons: scored.reasons,
        analysis,
        error: null,
      };
      record.status = opportunityStatus(record);
      records.push(record);
    } catch (err) {
      // One unreachable site must not end the batch.
      records.push({
        business: identity,
        opportunityScore: null,
        confidence: "LOW",
        evidenceCoverage: 0,
        status: "EVIDENCIA_INSUFICIENTE",
        problems: [],
        recommendation: null,
        estimatedValueEur: null,
        reasons: ["El análisis falló, así que no hay nada que puntuar."],
        analysis: null,
        error: err instanceof Error ? err.message : "Fallo desconocido.",
      });
    }
  }

  const ranking = records
    .filter((record) => record.opportunityScore !== null)
    .sort((a, b) => {
      const byScore = (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0);
      if (byScore !== 0) return byScore;
      // Same score: the one we know more about goes first, because it is the
      // one we can actually defend in a phone call.
      return b.evidenceCoverage - a.evidenceCoverage;
    });

  return {
    records,
    ranking,
    stats: {
      total: records.length,
      analyzed: records.filter((record) => record.analysis !== null).length,
      withoutWebsite: records.filter((record) => record.status === "SIN_WEB").length,
      failed: records.filter((record) => record.error !== null).length,
      highOpportunity: records.filter((record) => record.status === "ALTA_OPORTUNIDAD").length,
      noOpportunity: records.filter((record) => record.status === "SIN_OPORTUNIDAD_CLARA").length,
      totalPipelineValueEur: records.reduce((sum, record) => sum + (record.estimatedValueEur ?? 0), 0),
    },
    durationMs: Date.now() - startedAt,
  };
}

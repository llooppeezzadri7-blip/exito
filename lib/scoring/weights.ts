import { z } from "zod";
import type { Settings } from "@/lib/database/types";

export type ScoringWeights = Settings["scoring_weights"];

export const OPPORTUNITY_WEIGHT_KEYS = [
  "website_quality",
  "seo",
  "local_seo",
  "performance",
  "mobile_ux",
  "conversion",
  "competitive_gap",
] as const;

export const LEAD_SCORE_WEIGHT_KEYS = [
  "opportunity",
  "buying_intent",
  "business_value",
  "competitive_gap",
] as const;

export const OPPORTUNITY_WEIGHT_LABELS: Record<(typeof OPPORTUNITY_WEIGHT_KEYS)[number], string> = {
  website_quality: "Calidad de la web",
  seo: "SEO",
  local_seo: "SEO local",
  performance: "Rendimiento",
  mobile_ux: "Experiencia móvil",
  conversion: "Conversión",
  competitive_gap: "Brecha competitiva",
};

export const LEAD_SCORE_WEIGHT_LABELS: Record<(typeof LEAD_SCORE_WEIGHT_KEYS)[number], string> = {
  opportunity: "Oportunidad",
  buying_intent: "Intención de compra",
  business_value: "Valor del negocio",
  competitive_gap: "Brecha competitiva",
};

/** A single weight, as a fraction of 1 (the UI edits it as a percentage). */
const weight = z.number().min(0).max(1);

const opportunityShape = Object.fromEntries(
  OPPORTUNITY_WEIGHT_KEYS.map((key) => [key, weight])
) as Record<(typeof OPPORTUNITY_WEIGHT_KEYS)[number], typeof weight>;

const leadScoreShape = Object.fromEntries(
  LEAD_SCORE_WEIGHT_KEYS.map((key) => [key, weight])
) as Record<(typeof LEAD_SCORE_WEIGHT_KEYS)[number], typeof weight>;

export const scoringWeightsSchema = z.object({
  opportunity: z.object(opportunityShape),
  lead_score: z.object(leadScoreShape),
});

export class InvalidWeightsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWeightsError";
  }
}

/**
 * Scales a weight group so it sums to exactly 1. Both scores are weighted
 * averages of 0-100 sub-scores, so a group summing to anything other than 1
 * silently deflates (or clamps) every score — normalising here keeps the
 * stored weights meaning what the UI shows.
 */
export function normalizeGroup<K extends string>(group: Record<K, number>): Record<K, number> {
  const entries = Object.entries(group) as [K, number][];
  const total = entries.reduce((sum, [, value]) => sum + value, 0);

  if (total <= 0) {
    throw new InvalidWeightsError("Los pesos no pueden sumar 0: al menos un factor debe tener peso.");
  }

  const scaled = entries.map(([key, value]) => [key, value / total] as [K, number]);

  // Round to 4 decimals for storage/readability, then push the rounding
  // remainder into the largest weight so the group still sums to exactly 1.
  const rounded = scaled.map(([key, value]) => [key, Math.round(value * 10_000) / 10_000] as [K, number]);
  const roundedTotal = rounded.reduce((sum, [, value]) => sum + value, 0);
  const drift = Math.round((1 - roundedTotal) * 10_000) / 10_000;

  if (drift !== 0) {
    let largestIndex = 0;
    rounded.forEach(([, value], index) => {
      if (value > rounded[largestIndex][1]) largestIndex = index;
    });
    rounded[largestIndex][1] = Math.round((rounded[largestIndex][1] + drift) * 10_000) / 10_000;
  }

  return Object.fromEntries(rounded) as Record<K, number>;
}

export function normalizeScoringWeights(weights: ScoringWeights): ScoringWeights {
  return {
    opportunity: normalizeGroup(weights.opportunity),
    lead_score: normalizeGroup(weights.lead_score),
  };
}

function readPercent(formData: FormData, field: string): number {
  const raw = formData.get(field);
  const value = Number(typeof raw === "string" ? raw.replace(",", ".") : NaN);

  if (!Number.isFinite(value)) {
    throw new InvalidWeightsError(`Valor no numérico en "${field}".`);
  }
  if (value < 0 || value > 100) {
    throw new InvalidWeightsError(`Cada peso debe estar entre 0% y 100% (recibido ${value} en "${field}").`);
  }

  return value / 100;
}

function readGroup<K extends string>(
  formData: FormData,
  prefix: string,
  keys: readonly K[]
): Record<K, number> {
  return Object.fromEntries(
    keys.map((key) => [key, readPercent(formData, `${prefix}.${key}`)])
  ) as Record<K, number>;
}

/**
 * Reads the settings form (percentages, named `opportunity.<key>` /
 * `lead_score.<key>`) and returns weights normalised to sum 1 per group.
 * Throws InvalidWeightsError on anything the UI shouldn't have submitted.
 */
export function parseScoringWeightsForm(formData: FormData): ScoringWeights {
  const opportunity = readGroup(formData, "opportunity", OPPORTUNITY_WEIGHT_KEYS);
  const leadScore = readGroup(formData, "lead_score", LEAD_SCORE_WEIGHT_KEYS);

  const parsed = scoringWeightsSchema.safeParse({ opportunity, lead_score: leadScore });
  if (!parsed.success) {
    throw new InvalidWeightsError("Pesos fuera de rango. Cada factor debe estar entre 0% y 100%.");
  }

  return normalizeScoringWeights(parsed.data);
}

import type { OutcomeRecord, PredictionRecord, ModelVersionRecord } from "../db/records.js";
import { median, round, clamp } from "../core/stats.js";

export interface FeatureLift {
  feature: string;
  samples: number;
  threshold: number;
  /** P(good outcome | feature >= threshold) - P(good | feature < threshold). */
  lift: number;
  goodRateHigh: number;
  goodRateLow: number;
  badRateHigh: number;
  badRateLow: number;
}

export interface LearningReport {
  samples: number;
  byCategory: Record<string, { n: number; goodRate: number; badRate: number; medianReturn: number | null }>;
  featureLifts: FeatureLift[];
  proposedWeights: Record<string, number> | null;
  notes: string[];
}

const GOOD = new Set(["BIG_UP", "UP"]);
const BAD = new Set(["BIG_DOWN", "RUG", "LIQUIDITY_DRAIN"]);

/** Which positive scoring weights each feature family informs (penalties/gates are never touched). */
const FEATURE_TO_WEIGHT: Record<string, string> = {
  early_momentum: "early_momentum",
  holder_growth_component: "holder_growth",
  holders_growth_15m: "holder_growth",
  liquidity: "liquidity",
  social_momentum: "social_momentum",
  narrative_momentum: "narrative",
  market_quality: "market_quality",
  security: "security",
  deployer_quality: "deployer",
  wallet_quality: "wallet_quality",
};

/**
 * STATISTICAL ENGINE (step 2 of RULE → STATISTICAL → ML). Pure function over resolved predictions.
 * Computes per-feature lift of "good" outcomes at the median split, and proposes bounded adjustments
 * (±30%) to POSITIVE weights only. It never proposes changes to penalties or risk gates.
 */
export function learnFromOutcomes(pairs: { prediction: PredictionRecord; outcome: OutcomeRecord }[], baseWeights: Record<string, number>, minSamples: number, horizonHours?: number): LearningReport {
  const rows = pairs.filter((p) => p.outcome.label !== "UNKNOWN" && (horizonHours === undefined || p.outcome.horizonHours === horizonHours));
  const notes: string[] = [];
  const byCategory: LearningReport["byCategory"] = {};
  for (const r of rows) {
    const c = r.prediction.category;
    const b = (byCategory[c] ??= { n: 0, goodRate: 0, badRate: 0, medianReturn: null });
    b.n++;
    if (GOOD.has(r.outcome.label)) b.goodRate++;
    if (BAD.has(r.outcome.label)) b.badRate++;
  }
  for (const [c, b] of Object.entries(byCategory)) {
    b.goodRate = round(b.goodRate / b.n, 3);
    b.badRate = round(b.badRate / b.n, 3);
    b.medianReturn = median(rows.filter((r) => r.prediction.category === c).map((r) => r.outcome.returnPct).filter((x): x is number => x !== null));
  }
  if (rows.length < minSamples) {
    notes.push(`only ${rows.length} resolved samples (< ${minSamples}); no weight changes proposed`);
    return { samples: rows.length, byCategory, featureLifts: [], proposedWeights: null, notes };
  }
  const featureNames = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.prediction.features)) featureNames.add(k);
  const lifts: FeatureLift[] = [];
  for (const f of featureNames) {
    const vals = rows.map((r) => ({ v: r.prediction.features[f] ?? null, good: GOOD.has(r.outcome.label), bad: BAD.has(r.outcome.label) })).filter((x): x is { v: number; good: boolean; bad: boolean } => typeof x.v === "number");
    if (vals.length < minSamples) continue;
    const th = median(vals.map((x) => x.v));
    if (th === null) continue;
    const hi = vals.filter((x) => x.v >= th);
    const lo = vals.filter((x) => x.v < th);
    if (hi.length < 5 || lo.length < 5) continue;
    const rate = (xs: typeof vals, k: "good" | "bad") => xs.filter((x) => x[k]).length / xs.length;
    lifts.push({ feature: f, samples: vals.length, threshold: round(th, 4), lift: round(rate(hi, "good") - rate(lo, "good"), 3), goodRateHigh: round(rate(hi, "good"), 3), goodRateLow: round(rate(lo, "good"), 3), badRateHigh: round(rate(hi, "bad"), 3), badRateLow: round(rate(lo, "bad"), 3) });
  }
  lifts.sort((a, b) => Math.abs(b.lift) - Math.abs(a.lift));
  // Proposed weights: scale each positive weight by (1 + lift) bounded to ±30%, keep total ≈ constant.
  const proposed: Record<string, number> = { ...baseWeights };
  for (const l of lifts) {
    const w = FEATURE_TO_WEIGHT[l.feature];
    if (!w || !(w in proposed)) continue;
    const factor = clamp(1 + l.lift * 1.5, 0.7, 1.3);
    proposed[w] = round(baseWeights[w]! * factor, 2);
  }
  const baseSum = Object.values(baseWeights).reduce((a, b) => a + b, 0);
  const newSum = Object.values(proposed).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(proposed)) proposed[k] = round(proposed[k]! * (baseSum / newSum), 2);
  notes.push(`proposed weights from ${rows.length} samples; bounded ±30% per weight; penalties and gates untouched`);
  return { samples: rows.length, byCategory, featureLifts: lifts.slice(0, 40), proposedWeights: proposed, notes };
}

export function toModelVersion(report: LearningReport, version: string, now: string): ModelVersionRecord | null {
  if (!report.proposedWeights) return null;
  return { version, kind: "STATISTICAL", weights: report.proposedWeights, metrics: { samples: report.samples, ...Object.fromEntries(Object.entries(report.byCategory).map(([k, v]) => [`good_rate_${k}`, v.goodRate])) }, notes: report.notes.join("; "), active: false, createdAt: now };
}

import type { OutcomeRecord, PredictionRecord } from "../db/records.js";
import { round } from "../core/stats.js";

export interface SimilarPattern {
  mint: string;
  chain: string;
  distance: number;
  ageHoursAtPrediction: number | null;
  outcomeLabel: string;
  returnPct: number | null;
  horizonHours: number;
  matchedOn: string[];
}

const FEATURES: { key: string; log?: boolean; scale: number }[] = [
  { key: "market_cap_usd", log: true, scale: 1 },
  { key: "liquidity_usd", log: true, scale: 1 },
  { key: "holders", log: true, scale: 1 },
  { key: "holders_growth_15m", scale: 100 },
  { key: "volume_acceleration_rolling", scale: 3 },
  { key: "unique_buyer_seller_ratio_h1", scale: 3 },
  { key: "top10_pct", scale: 50 },
  { key: "early_momentum", scale: 50 },
  { key: "social_momentum", scale: 50 },
  { key: "liquidity_to_marketcap", scale: 0.5 },
];

/**
 * TOKEN COMPARISON ENGINE: nearest historical predictions (with resolved outcomes) in normalized
 * feature space. Output is descriptive ("similar characteristics to X in its first N hours"), never predictive.
 */
export function findSimilarPatterns(current: Record<string, number | null>, history: { prediction: PredictionRecord; outcome: OutcomeRecord; tokenAgeHours: number | null }[], k = 5, excludeMint?: string): SimilarPattern[] {
  const out: SimilarPattern[] = [];
  for (const h of history) {
    if (excludeMint && h.prediction.mint === excludeMint) continue;
    let d = 0;
    let n = 0;
    const matched: string[] = [];
    for (const f of FEATURES) {
      const a = current[f.key];
      const b = h.prediction.features[f.key];
      if (a === null || a === undefined || b === null || b === undefined) continue;
      const av = f.log ? Math.log10(Math.max(1, a)) : a / f.scale;
      const bv = f.log ? Math.log10(Math.max(1, b)) : b / f.scale;
      d += (av - bv) ** 2;
      n++;
      matched.push(f.key);
    }
    if (n < 4) continue;
    out.push({ mint: h.prediction.mint, chain: h.prediction.chain, distance: round(Math.sqrt(d / n), 3), ageHoursAtPrediction: h.tokenAgeHours, outcomeLabel: h.outcome.label, returnPct: h.outcome.returnPct, horizonHours: h.outcome.horizonHours, matchedOn: matched });
  }
  return out.sort((a, b) => a.distance - b.distance).slice(0, k);
}

export function describeSimilar(sim: SimilarPattern[]): string[] {
  if (!sim.length) return ["no comparable historical patterns yet"];
  return sim.map((s) => `similar characteristics to ${s.mint.slice(0, 6)}… during its first ${s.ageHoursAtPrediction === null ? "?" : Math.round(s.ageHoursAtPrediction)}h (${s.horizonHours}h outcome: ${s.outcomeLabel}${s.returnPct !== null ? ` ${s.returnPct > 0 ? "+" : ""}${s.returnPct}%` : ""})`);
}

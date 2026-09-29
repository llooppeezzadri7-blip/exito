import type { AnalyzerResult, Evidence, Flag } from "../core/types.js";
import type { TokenSnapshot } from "../core/model.js";
import type { TokenMetrics } from "./metrics.js";
import { ageMinutes } from "../core/time.js";
import { clamp, round } from "../core/stats.js";

/**
 * EARLY_MOMENTUM_SCORE: is *participation* accelerating while the token is still small?
 * Price is one input among many and deliberately capped. Any single 1m signal cannot dominate.
 */
export function analyzeEarlyMomentum(snap: TokenSnapshot, metrics: TokenMetrics, socialScore: number | null): AnalyzerResult {
  const now = new Date().toISOString();
  const flags: Flag[] = [];
  const evidence: Evidence[] = [];
  const out: Record<string, number | null> = {};
  const comps: { name: string; value: number | null; weight: number }[] = [];
  const g = (k: string) => metrics[k] ?? null;

  // holders growth (blend of 5m/15m/1h so no single window dominates)
  const hg = blend([g("holders_growth_5m"), g("holders_growth_15m"), g("holders_growth_1h")], [0.3, 0.4, 0.3]);
  comps.push({ name: "holders_growth", value: hg === null ? null : sat(hg, 50), weight: 0.22 });
  // unique buyers acceleration
  const ub = blend([g("unique_buyers_growth_5m"), g("unique_buyers_growth_15m"), g("unique_buyers_growth_1h")], [0.3, 0.4, 0.3]);
  comps.push({ name: "unique_buyers_growth", value: ub === null ? null : sat(ub, 80), weight: 0.18 });
  // volume acceleration (series-based when available, else rolling pace)
  const va = g("volume_acceleration_15m") ?? g("volume_acceleration_5m");
  const vr = g("volume_acceleration_rolling");
  const vol = va !== null ? sat(va, 150) : vr !== null ? sat((vr - 1) * 100, 150) : null;
  comps.push({ name: "volume_acceleration", value: vol, weight: 0.18 });
  // liquidity increasing
  const lg = blend([g("liquidity_growth_15m"), g("liquidity_growth_1h")], [0.5, 0.5]);
  comps.push({ name: "liquidity_growth", value: lg === null ? null : sat(lg, 40), weight: 0.12 });
  // buyer dominance
  const bs = g("unique_buyer_seller_ratio_h1") ?? g("buy_sell_ratio_h1");
  comps.push({ name: "buyer_dominance", value: bs === null ? null : clamp(((bs - 1) / 1.5) * 100, -100, 100), weight: 0.1 });
  // social momentum (0..100 -> -100..100 centered at 40)
  comps.push({ name: "social", value: socialScore === null ? null : clamp((socialScore - 40) * 2, -100, 100), weight: 0.1 });
  // price: capped contribution
  const pc = g("price_change_h1");
  comps.push({ name: "price", value: pc === null ? null : clamp(sat(pc, 100), -60, 60), weight: 0.1 });

  const known = comps.filter((c) => c.value !== null);
  if (known.length < 2) {
    return { analyzer: "early-momentum", score: null, confidence: "UNKNOWN", flags: [{ code: "INSUFFICIENT_DATA", severity: "INFO", message: "need at least two momentum components (more snapshots)" }], evidence, metrics: out, computedAt: now };
  }
  const wsum = known.reduce((a, c) => a + c.weight, 0);
  let raw = known.reduce((a, c) => a + c.value! * (c.weight / wsum), 0); // -100..100
  // smallness bonus: market cap still small keeps "early" meaningful
  const mc = snap.market?.marketCapUsd.value ?? snap.market?.fdvUsd.value ?? null;
  const age = ageMinutes(snap.createdAt);
  let smallness = 0;
  if (mc !== null) smallness = mc < 250_000 ? 15 : mc < 1_000_000 ? 8 : mc < 5_000_000 ? 0 : -15;
  if (age !== null && age > 24 * 60) smallness -= 10;
  raw += smallness;
  const score = clamp(round(50 + raw / 2, 1), 0, 100);
  for (const c of comps) out[`em_${c.name}`] = c.value === null ? null : round(c.value, 1);
  out.em_components_known = known.length;
  out.early_momentum_score = score;
  if (score >= 70) evidence.push({ kind: "INFERENCE", statement: `participation accelerating: ${known.filter((c) => c.value! > 20).map((c) => c.name).join(", ")}`, source: "early-momentum", observedAt: now });
  if ((g("holders_growth_15m") ?? 0) > 100 && (g("volume_growth_15m") ?? 0) > 200) flags.push({ code: "PARTICIPATION_SURGE", severity: "INFO", message: "holders and volume both surged >100% in 15m" });
  const confidence: AnalyzerResult["confidence"] = known.length >= 5 && (metrics.snapshots_count ?? 0) >= 4 ? "HIGH" : known.length >= 3 ? "MEDIUM" : "LOW";
  return { analyzer: "early-momentum", score, confidence, flags, evidence, metrics: out, computedAt: now };
}

/** saturating map: value/limit clipped to [-100, 100] */
function sat(v: number, limit: number): number {
  return clamp((v / limit) * 100, -100, 100);
}
function blend(vals: (number | null)[], weights: number[]): number | null {
  let s = 0;
  let w = 0;
  vals.forEach((v, i) => {
    if (v !== null) {
      s += v * weights[i]!;
      w += weights[i]!;
    }
  });
  return w > 0 ? s / w : null;
}

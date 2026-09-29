import type { ThesisStatus } from "../core/types.js";
import type { OpportunityRecord } from "../db/records.js";
import type { TokenMetrics } from "../analyzers/metrics.js";

/**
 * EXIT / RISK ENGINE: compares the current evaluation with the previous one and the live metrics.
 * Produces THESIS_INTACT / THESIS_WEAKENING / THESIS_INVALIDATED / RISK_ESCALATING.
 * This runs for every monitored token, alert-worthy transitions are emitted by the alert engine.
 */
export function assessThesis(prev: OpportunityRecord | null, current: { score: number | null; rugRisk: number | null; category: string; flags: string[] }, metrics: TokenMetrics): { status: ThesisStatus; reasons: string[] } {
  const reasons: string[] = [];
  const g = (k: string): number | null => metrics[k] ?? null;
  const had = prev && (prev.category === "WATCHLIST" || prev.category === "HIGH_CONVICTION_SETUP");
  const hard = ["LIQUIDITY_DROP", "REPORTED_RUGGED", "WHALE_DISTRIBUTION", "FREEZE_AUTHORITY_ACTIVE", "MINT_AUTHORITY_ACTIVE", "DEPLOYER_PREVIOUS_RUGS"];
  const hardHits = current.flags.filter((f) => hard.includes(f));
  if (hardHits.length) reasons.push(...hardHits.map((h) => h.toLowerCase().replace(/_/g, " ")));
  const lg = g("liquidity_growth_15m") ?? g("liquidity_growth_1h");
  if (lg !== null && lg <= -30) reasons.push(`liquidity ${lg.toFixed(0)}%`);
  const hg = g("holders_growth_15m");
  if (hg !== null && hg <= -10) reasons.push(`holders ${hg.toFixed(0)}% / 15m`);
  const vg = g("volume_growth_1h");
  if (vg !== null && vg <= -70) reasons.push(`volume ${vg.toFixed(0)}% / 1h`);
  const dd = g("ath_drawdown_pct");
  if (dd !== null && dd <= -50) reasons.push(`price ${dd.toFixed(0)}% from high`);

  if (!had) return { status: "NO_THESIS", reasons };
  const prevScore = prev!.score ?? 0;
  const score = current.score ?? 0;
  const prevRug = prev!.rugRisk ?? 0;
  const rug = current.rugRisk ?? 0;
  if (hardHits.length || (lg !== null && lg <= -30) || current.category === "REJECTED" || current.category === "EXTREME_RISK") return { status: "THESIS_INVALIDATED", reasons };
  if (rug - prevRug >= 15 && rug >= 30) {
    reasons.push(`rug risk ${prevRug} → ${rug}`);
    return { status: "RISK_ESCALATING", reasons };
  }
  if (score < prevScore - 20 || (hg !== null && hg <= -10) || (vg !== null && vg <= -70) || (dd !== null && dd <= -50)) {
    if (score < prevScore - 10) reasons.push(`score ${prevScore} → ${score}`);
    return { status: reasons.length >= 2 || score < prevScore - 30 ? "THESIS_INVALIDATED" : "THESIS_WEAKENING", reasons };
  }
  if (score < prevScore - 10) {
    reasons.push(`score ${prevScore} → ${score}`);
    return { status: "THESIS_WEAKENING", reasons };
  }
  return { status: "THESIS_INTACT", reasons };
}

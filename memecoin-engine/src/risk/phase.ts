import type { MarketPhase } from "../core/types.js";
import type { TokenMetrics } from "../analyzers/metrics.js";
import type { EngineConfig } from "../config/schema.js";

export interface PhaseAssessment {
  phase: MarketPhase;
  reasons: string[];
  /** 0..1 strength of the "too late" signal, used for scoring penalties. */
  latePenalty: number;
}

/**
 * NO FOMO ENGINE: classifies EARLY / LATE / EXHAUSTED from participation + price structure.
 * A token can keep rising and still be LATE: price alone never makes something EARLY.
 */
export function assessPhase(metrics: TokenMetrics, cfg: EngineConfig["no_fomo"], insidersSelling: boolean): PhaseAssessment {
  const g = (k: string): number | null => metrics[k] ?? null;
  const reasons: string[] = [];
  let late = 0;
  let exhausted = 0;
  const pc1h = g("price_change_h1");
  const pc24 = g("price_change_h24");
  const pc5 = g("price_change_m5");
  if (pc1h !== null && pc1h >= cfg.late_if_price_change_h1_pct) { late += 0.5; reasons.push(`price already +${pc1h.toFixed(0)}% in 1h`); }
  if (pc24 !== null && pc24 >= cfg.late_if_price_change_h24_pct) { late += 0.5; reasons.push(`price already +${pc24.toFixed(0)}% in 24h`); }
  if (pc5 !== null && pc5 >= cfg.vertical_pump_m5_pct) { late += 0.6; reasons.push(`vertical pump +${pc5.toFixed(0)}% in 5m`); }
  const vAcc = g("volume_acceleration_15m") ?? g("volume_acceleration_5m");
  const vg1h = g("volume_growth_1h");
  const v16 = g("volume_h1_vs_h6_avg");
  if (vg1h !== null && vg1h <= -cfg.exhausted_if_volume_drop_pct) { exhausted += 0.6; reasons.push(`volume down ${Math.abs(vg1h).toFixed(0)}% vs an hour ago`); }
  else if (v16 !== null && v16 < 0.4 && (pc24 ?? 0) > 50) { exhausted += 0.4; reasons.push("last-hour volume far below the 6h average after a run-up"); }
  if (vAcc !== null && vAcc < -100 && (pc1h ?? 0) > 30) { exhausted += 0.3; reasons.push("volume decelerating while price extended"); }
  const dd = g("ath_drawdown_pct");
  if (dd !== null && dd <= cfg.exhausted_if_price_from_ath_pct) { exhausted += 0.5; reasons.push(`price ${dd.toFixed(0)}% from observed high`); }
  if (insidersSelling) { exhausted += 0.4; reasons.push("insiders/whales distributing"); }
  const lg = g("liquidity_growth_1h");
  if (lg !== null && lg < 0 && (pc1h ?? 0) > 50) { late += 0.3; reasons.push("price up but liquidity not following"); }
  const hg = g("holders_growth_15m");
  if (hg !== null && hg <= 0 && (pc1h ?? 0) > 50) { late += 0.3; reasons.push("price up without new holders"); }

  let phase: MarketPhase = "UNKNOWN";
  if (exhausted >= 0.6) phase = "EXHAUSTED";
  else if (late >= 0.5) phase = "LATE";
  else if (pc1h !== null || hg !== null || vg1h !== null) phase = "EARLY";
  return { phase, reasons, latePenalty: Math.min(1, phase === "EXHAUSTED" ? Math.max(exhausted, late) : late) };
}

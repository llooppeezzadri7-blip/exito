import type { AnalyzerResult, Flag } from "../core/types.js";
import type { TokenMetrics } from "./metrics.js";
import { robustZ, round } from "../core/stats.js";

export interface AnomalyBaselines {
  volumeH1Usd: number[];
  liquidityUsd: number[];
  holders: number[];
  buysH1: number[];
  /** Per-token own history of volume_h1 (for self-anomaly). */
  ownVolumeH1: number[];
  ownHolders: number[];
}

/**
 * ANOMALY DETECTOR: robust z-scores (median/MAD) against (a) the cross-token population the engine has
 * seen recently and (b) the token's own history. Flags, never blocks: anomalies feed the scorer and alerts.
 */
export function detectAnomalies(metrics: TokenMetrics, base: AnomalyBaselines, cfg: { spikeZ: number }): AnalyzerResult {
  const now = new Date().toISOString();
  const flags: Flag[] = [];
  const out: Record<string, number | null> = {};
  const m = (k: string): number | null => metrics[k] ?? null;
  const check = (name: string, value: number | null, sample: number[], code: string, label: string) => {
    if (value === null) return;
    const z = robustZ(Math.log10(Math.max(1, value)), sample.map((x) => Math.log10(Math.max(1, x))));
    out[`z_${name}`] = z === null ? null : round(z, 2);
    if (z !== null && Math.abs(z) >= cfg.spikeZ) flags.push({ code, severity: Math.abs(z) >= cfg.spikeZ * 2 ? "HIGH" : "MEDIUM", message: `${label} is ${z > 0 ? "far above" : "far below"} normal (z=${z.toFixed(1)})` });
  };
  check("volume_h1_population", m("volume_h1_usd"), base.volumeH1Usd, "ABNORMAL_VOLUME", "1h volume vs population");
  check("liquidity_population", m("liquidity_usd"), base.liquidityUsd, "ABNORMAL_LIQUIDITY", "liquidity vs population");
  check("holders_population", m("holders"), base.holders, "ABNORMAL_HOLDERS", "holder count vs population");
  check("buys_population", m("txns_h1"), base.buysH1, "ABNORMAL_TX_PATTERN", "tx count vs population");
  check("volume_h1_own", m("volume_h1_usd"), base.ownVolumeH1, "VOLUME_SPIKE", "1h volume vs own history");
  check("holders_own", m("holders"), base.ownHolders, "HOLDER_GROWTH_ABNORMAL", "holders vs own history");
  const anomalies = flags.length;
  out.anomaly_count = anomalies;
  const known = Object.values(out).filter((v) => v !== null).length;
  const score = known === 0 ? null : Math.max(0, 100 - anomalies * 20);
  return { analyzer: "anomaly", score, confidence: known >= 3 ? "MEDIUM" : known > 0 ? "LOW" : "UNKNOWN", flags, evidence: [], metrics: out, computedAt: now };
}

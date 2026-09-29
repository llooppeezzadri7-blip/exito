import type { AnalyzerResult, Evidence, Flag } from "../core/types.js";
import { isKnown } from "../core/types.js";
import type { TokenSnapshot } from "../core/model.js";
import type { TokenMetrics } from "./metrics.js";
import type { EngineConfig } from "../config/schema.js";
import { clamp, round, scale } from "../core/stats.js";

/**
 * LIQUIDITY ANALYZER → LIQUIDITY_SCORE (0..100) and EXIT_RISK (0..100, higher = harder to get out).
 * Answers "could I get out?" not just "could it go up?".
 */
export function analyzeLiquidity(snap: TokenSnapshot, metrics: TokenMetrics, cfg: EngineConfig): AnalyzerResult {
  const now = new Date().toISOString();
  const flags: Flag[] = [];
  const evidence: Evidence[] = [];
  const out: Record<string, number | null> = {};
  const market = snap.market;
  if (!market || !isKnown(market.liquidityUsd)) {
    return { analyzer: "liquidity", score: null, confidence: "UNKNOWN", flags: [{ code: "INSUFFICIENT_DATA", severity: "INFO", message: "liquidity unknown" }], evidence, metrics: out, computedAt: now };
  }
  const liq = market.liquidityUsd.value;
  const mc = market.marketCapUsd.value ?? market.fdvUsd.value ?? null;
  const fact = (statement: string, data?: Record<string, unknown>) => evidence.push({ kind: "FACT", statement, source: market.source, observedAt: market.observedAt, data });
  fact(`total liquidity $${round(liq, 0)} across ${market.pairs.length} pool(s)`, { liquidityUsd: liq, pools: market.pairs.length });

  // 1) absolute depth (log scale: $3k → 0, $300k → 100)
  const depth = liq <= 0 ? 0 : scale(Math.log10(liq), Math.log10(cfg.filters.min_liquidity_usd), Math.log10(300_000));
  // 2) liquidity relative to market cap
  const ratio = mc && mc > 0 ? liq / mc : null;
  let ratioScore = 50;
  if (ratio !== null) {
    if (ratio < cfg.liquidity.healthy_liq_to_mc_min) {
      ratioScore = scale(ratio, 0, cfg.liquidity.healthy_liq_to_mc_min) * 0.6;
      flags.push({ code: "THIN_LIQUIDITY_VS_MC", severity: ratio < cfg.liquidity.healthy_liq_to_mc_min / 2 ? "HIGH" : "MEDIUM", message: `liquidity is only ${(ratio * 100).toFixed(1)}% of market cap` });
    } else if (ratio > cfg.liquidity.healthy_liq_to_mc_max) {
      ratioScore = 70; // very high ratio is fine for exit but often means no demand yet
    } else ratioScore = 100;
  }
  // 3) stability: liquidity change over 15m/1h from the series
  const g15 = metrics.liquidity_growth_15m ?? null;
  const g1h = metrics.liquidity_growth_1h ?? null;
  let stability = 70;
  if (g15 !== null) {
    if (g15 <= -cfg.liquidity.drop_alert_pct) {
      stability = 0;
      flags.push({ code: "LIQUIDITY_DROP", severity: "CRITICAL", message: `liquidity fell ${g15.toFixed(0)}% in 15m` });
    } else if (g15 < -10) {
      stability = 30;
      flags.push({ code: "LIQUIDITY_DECLINING", severity: "MEDIUM", message: `liquidity -${Math.abs(g15).toFixed(0)}% in 15m` });
    } else if (g15 > 0) stability = 90;
  }
  if (g1h !== null && g1h <= -cfg.liquidity.drop_alert_pct && !flags.some((f) => f.code === "LIQUIDITY_DROP")) {
    stability = Math.min(stability, 10);
    flags.push({ code: "LIQUIDITY_DROP", severity: "HIGH", message: `liquidity fell ${g1h.toFixed(0)}% in 1h` });
  }
  // 4) LP concentration/lock (report-based, MEDIUM confidence)
  const lpLocked = snap.securityReport?.lpLockedPct.value ?? snap.holders?.lpLockedPct.value ?? null;
  let lpScore = 50;
  if (lpLocked !== null) {
    lpScore = clamp(lpLocked, 0, 100);
    if (lpLocked < 50) flags.push({ code: "LP_UNLOCKED", severity: lpLocked < 20 ? "HIGH" : "MEDIUM", message: `only ${lpLocked.toFixed(0)}% of LP reported locked/burned` });
    evidence.push({ kind: "INFERENCE", statement: `LP locked/burned ≈ ${lpLocked.toFixed(0)}% (third-party)`, source: snap.securityReport?.source ?? "unknown", observedAt: snap.securityReport?.observedAt ?? now });
  } else flags.push({ code: "LP_LOCK_UNKNOWN", severity: "LOW", message: "LP lock status unknown" });
  // 5) volume vs liquidity sanity: extreme turnover with tiny liquidity is usually wash/bot flow
  const v2l = metrics.volume_to_liquidity_h24 ?? null;
  if (v2l !== null && v2l > cfg.liquidity.suspicious_volume_to_liq_ratio) {
    flags.push({ code: "SUSPICIOUS_VOLUME_VS_LIQUIDITY", severity: "MEDIUM", message: `24h volume is ${v2l.toFixed(0)}x liquidity` });
  }
  // 6) estimated impact of a $1k / $5k sell on a constant-product pool with `liq` total (≈ half in quote)
  const quoteSide = liq / 2;
  const impact = (usd: number) => (quoteSide > 0 ? round((usd / (quoteSide + usd)) * 100, 2) : null);
  out.est_impact_1k_pct = impact(1000);
  out.est_impact_5k_pct = impact(5000);
  out.liquidity_usd = liq;
  out.liquidity_to_mc = ratio;
  out.lp_locked_pct = lpLocked;

  const score = clamp(round(depth * 0.35 + ratioScore * 0.25 + stability * 0.25 + lpScore * 0.15, 1), 0, 100);
  // EXIT_RISK: how likely you cannot exit at a reasonable price.
  let exitRisk = 100 - depth * 0.5 - stability * 0.3 - lpScore * 0.2;
  if (flags.some((f) => f.code === "LIQUIDITY_DROP")) exitRisk = Math.max(exitRisk, 85);
  if (snap.security?.freezeAuthorityActive.value === true) exitRisk = Math.max(exitRisk, 90);
  if ((out.est_impact_5k_pct ?? 0) > 25) exitRisk = Math.max(exitRisk, 70);
  exitRisk = clamp(round(exitRisk, 1), 0, 100);
  out.liquidity_score = score;
  out.exit_risk = exitRisk;
  return { analyzer: "liquidity", score, confidence: lpLocked === null ? "MEDIUM" : "HIGH", flags, evidence, metrics: out, computedAt: now };
}

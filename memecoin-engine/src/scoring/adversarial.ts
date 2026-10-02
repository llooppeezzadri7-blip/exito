import type { AnalyzerResult } from "../core/types.js";
import type { TokenMetrics } from "../analyzers/metrics.js";

export interface AdversarialAnalysis {
  bull: string[];
  bear: string[];
  conflicts: string[];
}

/**
 * ADVERSARIAL / ANTI-BIAS: an independent BULL CASE and BEAR CASE are built from the same facts,
 * then CONFLICT ANALYSIS lists contradictions. Conflicts lower confidence in the scorer.
 * The bear case always asks: what would prove us wrong? what if volume -70%? whales sell? liquidity leaves?
 */
export function adversarialAnalysis(results: AnalyzerResult[], metrics: TokenMetrics): AdversarialAnalysis {
  // token-level metrics first, then analyzer-level metrics (e.g. est_impact_5k_pct lives on the liquidity result)
  const g = (k: string): number | null => metrics[k] ?? results.map((r) => r.metrics[k]).find((v) => v !== null && v !== undefined) ?? null;
  const flags = new Set(results.flatMap((r) => r.flags.filter((f) => f.severity !== "INFO").map((f) => f.code)));
  const score = (name: string) => results.find((r) => r.analyzer === name)?.score ?? null;
  const bull: string[] = [];
  const bear: string[] = [];
  const conflicts: string[] = [];
  const fmt = (v: number | null, d = 0) => (v === null ? "?" : v.toFixed(d));

  // ---- BULL ----
  const hg = g("holders_growth_15m");
  if (hg !== null && hg > 15) bull.push(`holders +${fmt(hg)}% in 15m`);
  const ub = g("unique_buyers_growth_15m") ?? g("unique_buyers_growth_1h");
  if (ub !== null && ub > 20) bull.push(`unique buyers accelerating (+${fmt(ub)}%)`);
  const lg = g("liquidity_growth_1h") ?? g("liquidity_growth_15m");
  if (lg !== null && lg > 5) bull.push(`liquidity growing (+${fmt(lg)}%)`);
  const va = g("volume_acceleration_15m") ?? g("volume_acceleration_5m");
  if (va !== null && va > 50) bull.push("volume accelerating");
  const bs = g("unique_buyer_seller_ratio_h1") ?? g("buy_sell_ratio_h1");
  if (bs !== null && bs > 1.5) bull.push(`buyers dominate sellers (${fmt(bs, 1)}x)`);
  if ((score("security") ?? 0) >= 80) bull.push("authorities revoked, no dangerous extensions");
  if ((score("liquidity") ?? 0) >= 70) bull.push("liquidity depth adequate for the market cap");
  if ((score("holders") ?? 0) >= 70) bull.push("supply reasonably distributed");
  if ((score("social") ?? 0) >= 60) bull.push("social mentions accelerating");
  if ((score("narrative") ?? 0) >= 60) bull.push("narrative currently emerging");
  if ((score("microstructure") ?? 0) >= 70) bull.push("trade tape looks organic");
  const mc = g("market_cap_usd");
  if (mc !== null && mc < 500_000) bull.push(`market cap still small ($${Math.round(mc / 1000)}k)`);

  // ---- BEAR ----
  if (flags.has("MINT_AUTHORITY_ACTIVE")) bear.push("supply can be inflated (mint authority)");
  if (flags.has("FREEZE_AUTHORITY_ACTIVE")) bear.push("accounts can be frozen (freeze authority)");
  if (flags.has("SUPPLY_CONCENTRATION")) bear.push("supply concentrated in few wallets — one seller can crash it");
  if (flags.has("SUSPICIOUS_WALLET_CLUSTER")) bear.push("coordinated wallets detected — 'organic' demand may be one actor");
  if (flags.has("DEPLOYER_PREVIOUS_RUGS") || flags.has("DEPLOYER_SERIAL_LAUNCHER")) bear.push("deployer history is bad");
  if (flags.has("DEPLOYER_UNKNOWN") || flags.has("DEPLOYER_NEW_WALLET")) bear.push("deployer unknown/new: no accountability");
  if (flags.has("LP_UNLOCKED") || flags.has("LP_LOCK_UNKNOWN")) bear.push("LP not verifiably locked — liquidity can be pulled");
  if (flags.has("WASH_TRADING_SUSPECTED") || flags.has("VOLUME_WITHOUT_HOLDERS") || flags.has("ABNORMAL_VOLUME")) bear.push("volume may be artificial");
  if (flags.has("WHALE_DISTRIBUTION")) bear.push("whales are distributing into the demand");
  if (flags.has("LIQUIDITY_DROP") || flags.has("LIQUIDITY_DECLINING")) bear.push("liquidity leaving");
  const pc1 = g("price_change_h1");
  if (pc1 !== null && pc1 > 100) bear.push(`already +${fmt(pc1)}% in 1h — asymmetric downside if momentum stalls`);
  const liq = g("liquidity_usd");
  const impact5k = g("est_impact_5k_pct");
  if (liq !== null && impact5k !== null) bear.push(`a $5k sell into the $${Math.round(liq / 1000)}k pool moves price ~${fmt(impact5k, 1)}%; if volume drops 70% exits get harder`);
  const w = g("whale_count");
  if (w !== null && w > 0) bear.push(`${w} wallet(s) above whale size: a coordinated exit would exceed available liquidity`);
  if ((metrics.snapshots_count ?? 0) < 4) bear.push("limited trading history — behaviour not yet observed across timeframes");
  bear.push("no signal here predicts price; every memecoin can go to zero");

  // ---- CONFLICTS ----
  const vg = g("volume_growth_1h");
  if (vg !== null && vg > 100 && hg !== null && hg <= 0) conflicts.push("volume surging while holders are not growing");
  if (pc1 !== null && pc1 > 50 && lg !== null && lg < 0) conflicts.push("price rising while liquidity declines");
  if ((score("social") ?? 0) >= 60 && (hg ?? 0) <= 0 && (vg ?? 0) <= 0) conflicts.push("social attention without on-chain follow-through");
  if (bs !== null && bs > 1.5 && flags.has("WHALE_DISTRIBUTION")) conflicts.push("retail buying into whale distribution");
  if ((score("early-momentum") ?? 0) >= 65 && flags.has("SUSPICIOUS_WALLET_CLUSTER")) conflicts.push("momentum may be manufactured by a wallet cluster");
  if ((score("security") ?? 0) >= 80 && flags.has("REPORTED_RISK")) conflicts.push("on-chain security clean but third-party report lists risks");
  if ((score("holders") ?? 0) >= 70 && flags.has("SINGLE_WALLET_DOMINATES_VOLUME")) conflicts.push("distributed supply but one wallet drives volume");
  return { bull, bear, conflicts };
}

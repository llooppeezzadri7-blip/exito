import type { AnalyzerResult, Evidence, Flag } from "../core/types.js";
import type { TokenSnapshot, TradeEvent } from "../core/model.js";
import type { TokenMetrics } from "./metrics.js";
import type { EngineConfig } from "../config/schema.js";
import { clamp, median, round } from "../core/stats.js";

/**
 * MARKET MICROSTRUCTURE → MARKET_QUALITY_SCORE.
 * Looks at the trade tape (when available) and at aggregate ratios:
 * wash trading, repetitive small buys from the same wallets (bots), volume that creates no holders,
 * sandwich-like patterns (same wallet buy+sell inside seconds), large single trades, artificial spikes.
 */
export function analyzeMicrostructure(snap: TokenSnapshot, metrics: TokenMetrics, cfg: EngineConfig): AnalyzerResult {
  const now = new Date().toISOString();
  const flags: Flag[] = [];
  const evidence: Evidence[] = [];
  const out: Record<string, number | null> = {};
  const trades = snap.trades;
  let score = 70;
  let confidence: AnalyzerResult["confidence"] = "LOW";
  const g = (k: string): number | null => metrics[k] ?? null;

  // Aggregate-only checks (always available when market data exists)
  const v2l = g("volume_to_liquidity_h24");
  if (v2l !== null && v2l > cfg.liquidity.suspicious_volume_to_liq_ratio) {
    score -= 20;
    flags.push({ code: "ABNORMAL_VOLUME", severity: "MEDIUM", message: `24h volume ${v2l.toFixed(0)}x liquidity — likely wash/bot flow` });
  }
  const nh = g("new_holders_per_10k_volume_h1");
  const vh1 = g("volume_h1_usd");
  if (nh !== null && vh1 !== null && vh1 > 20_000 && nh < 0.5) {
    score -= 20;
    flags.push({ code: "VOLUME_WITHOUT_HOLDERS", severity: "HIGH", message: `$${round(vh1, 0)} volume in 1h created ${round(nh, 2)} holders per $10k` });
  }
  const bpb = g("buys_per_unique_buyer_h1");
  if (bpb !== null && bpb > 4) {
    score -= 15;
    flags.push({ code: "REPETITIVE_BUYS", severity: "MEDIUM", message: `${bpb.toFixed(1)} buys per unique buyer in 1h (bot-like)` });
  }
  const lg = g("liquidity_growth_1h");
  const vg1 = g("volume_growth_1h");
  if (vg1 !== null && vg1 > 200 && lg !== null && lg < 5) {
    score -= 10;
    flags.push({ code: "VOLUME_WITHOUT_LIQUIDITY", severity: "MEDIUM", message: "volume surged but liquidity did not follow" });
  }
  const bsr = g("buy_sell_ratio_h1");
  if (bsr !== null && bsr > 0.9 && bsr < 1.1 && (g("txns_h1") ?? 0) > 200) {
    score -= 10;
    flags.push({ code: "SYMMETRIC_FLOW", severity: "LOW", message: "buys ≈ sells with high tx count (possible wash trading)" });
  }

  if (trades.length >= 10) {
    confidence = trades.length >= 40 ? "MEDIUM" : "LOW";
    const ts = tapeStats(trades);
    Object.assign(out, ts);
    const t = (k: string): number | null => ts[k] ?? null;
    const T = { same_wallet_roundtrip_share: t("same_wallet_roundtrip_share"), top_wallet_volume_share: t("top_wallet_volume_share"), small_repetitive_share: t("small_repetitive_share"), large_sell_count: t("large_sell_count"), large_buy_count: t("large_buy_count"), unique_wallets: t("unique_wallets"), median_trade_usd: t("median_trade_usd") };
    if (T.same_wallet_roundtrip_share !== null && T.same_wallet_roundtrip_share > 0.3) {
      score -= 20;
      flags.push({ code: "WASH_TRADING_SUSPECTED", severity: "HIGH", message: `${Math.round(T.same_wallet_roundtrip_share * 100)}% of trades are buy+sell round-trips by the same wallet within 60s` });
    }
    if (T.top_wallet_volume_share !== null && T.top_wallet_volume_share > 0.5) {
      score -= 15;
      flags.push({ code: "SINGLE_WALLET_DOMINATES_VOLUME", severity: "HIGH", message: `one wallet accounts for ${Math.round(T.top_wallet_volume_share * 100)}% of traded volume` });
    }
    if (T.small_repetitive_share !== null && T.small_repetitive_share > 0.5) {
      score -= 10;
      flags.push({ code: "BOT_PATTERN", severity: "MEDIUM", message: `${Math.round(T.small_repetitive_share * 100)}% of trades are near-identical small buys` });
    }
    if (T.large_sell_count !== null && T.large_sell_count > 0) {
      flags.push({ code: "LARGE_SELLS", severity: "MEDIUM", message: `${T.large_sell_count} sell(s) > 10x median trade size` });
      score -= 5 * Math.min(3, T.large_sell_count);
    }
    if (T.large_buy_count !== null && T.large_buy_count > 0) evidence.push({ kind: "FACT", statement: `${T.large_buy_count} buy(s) > 10x median trade size`, source: trades[0]!.source, observedAt: now });
    if (T.unique_wallets !== null && T.unique_wallets / trades.length > 0.6) score += 10; // healthy: many different participants
    evidence.push({ kind: "FACT", statement: `${trades.length} recent trades from ${T.unique_wallets} wallets; median trade $${T.median_trade_usd ?? "?"}`, source: trades[0]!.source, observedAt: now });
  } else {
    flags.push({ code: "INSUFFICIENT_TAPE", severity: "INFO", message: "not enough trades to analyze the tape" });
    if (vh1 === null) return { analyzer: "microstructure", score: null, confidence: "UNKNOWN", flags, evidence, metrics: out, computedAt: now };
  }
  score = clamp(round(score, 1), 0, 100);
  out.market_quality_score = score;
  return { analyzer: "microstructure", score, confidence, flags, evidence, metrics: out, computedAt: now };
}

export function tapeStats(trades: TradeEvent[]): Record<string, number | null> {
  const sizes = trades.map((t) => t.amountUsd).filter((x): x is number => typeof x === "number" && x > 0);
  const med = median(sizes);
  const wallets = new Map<string, number>();
  for (const t of trades) if (t.wallet) wallets.set(t.wallet, (wallets.get(t.wallet) ?? 0) + (t.amountUsd ?? 0));
  const totalVol = [...wallets.values()].reduce((a, b) => a + b, 0);
  const topShare = totalVol > 0 ? Math.max(...wallets.values()) / totalVol : null;
  // round trips: same wallet buy then sell within 60s
  let roundTrips = 0;
  const sorted = [...trades].sort((a, b) => a.ts.localeCompare(b.ts));
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    if (a.kind !== "buy" || !a.wallet) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (new Date(b.ts).getTime() - new Date(a.ts).getTime() > 60_000) break;
      if (b.kind === "sell" && b.wallet === a.wallet) {
        roundTrips++;
        break;
      }
    }
  }
  const smallRep = med ? sizes.filter((s) => Math.abs(s - med) / med < 0.1).length / Math.max(1, sizes.length) : null;
  const large = (kind: "buy" | "sell") => (med ? trades.filter((t) => t.kind === kind && (t.amountUsd ?? 0) > med * 10).length : null);
  return {
    unique_wallets: wallets.size,
    median_trade_usd: med !== null ? round(med, 2) : null,
    top_wallet_volume_share: topShare !== null ? round(topShare, 3) : null,
    same_wallet_roundtrip_share: round(roundTrips / Math.max(1, trades.length), 3),
    small_repetitive_share: smallRep !== null ? round(smallRep, 3) : null,
    large_buy_count: large("buy"),
    large_sell_count: large("sell"),
    tape_buy_share: round(trades.filter((t) => t.kind === "buy").length / trades.length, 3),
  };
}

import type { SnapshotRecord } from "../db/records.js";
import { TIMEFRAME_MS, type Timeframe } from "../core/types.js";
import { pctChange, round } from "../core/stats.js";

/**
 * Multi-timeframe growth metrics derived from the token's own snapshot series.
 * Pure function: no I/O. Every metric is null when the series cannot support it
 * (e.g. not enough history) — never extrapolated.
 */
export interface TokenMetrics {
  [key: string]: number | null;
}

const GROWTH_WINDOWS: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "24h"];

/** Find the snapshot closest to `targetMs` ago but not newer than 0.6*window (otherwise null). */
export function snapshotAt(series: SnapshotRecord[], nowMs: number, windowMs: number): SnapshotRecord | null {
  const target = nowMs - windowMs;
  let best: SnapshotRecord | null = null;
  let bestDist = Infinity;
  for (const s of series) {
    const t = new Date(s.observedAt).getTime();
    if (t > nowMs) continue;
    const dist = Math.abs(t - target);
    if (dist < bestDist) {
      best = s;
      bestDist = dist;
    }
  }
  if (!best) return null;
  const age = nowMs - new Date(best.observedAt).getTime();
  if (age < windowMs * 0.6 || age > windowMs * 2.5) return null;
  return best;
}

export function computeMetrics(series: SnapshotRecord[], now: Date = new Date()): TokenMetrics {
  const m: TokenMetrics = {};
  const latest = series[series.length - 1];
  if (!latest) return m;
  const nowMs = new Date(latest.observedAt).getTime() || now.getTime();
  const p = latest.payload;
  const market = p.market;

  // --- point-in-time ratios (available from a single snapshot) ---
  const buysH1 = latest.buysH1;
  const sellsH1 = latest.sellsH1;
  m.buy_sell_ratio_h1 = buysH1 !== null && sellsH1 !== null ? (sellsH1 === 0 ? (buysH1 > 0 ? 10 : null) : round(buysH1 / sellsH1, 3)) : null;
  m.buy_sell_ratio_m5 = latest.buysM5 !== null && latest.sellsM5 !== null ? (latest.sellsM5 === 0 ? (latest.buysM5 > 0 ? 10 : null) : round(latest.buysM5 / latest.sellsM5, 3)) : null;
  m.volume_per_holder_h1 = latest.volumeH1Usd !== null && latest.holders ? round(latest.volumeH1Usd / latest.holders, 2) : null;
  m.liquidity_to_marketcap = latest.liquidityUsd !== null && latest.marketCapUsd ? round(latest.liquidityUsd / latest.marketCapUsd, 4) : null;
  m.volume_to_liquidity_h1 = latest.volumeH1Usd !== null && latest.liquidityUsd ? round(latest.volumeH1Usd / latest.liquidityUsd, 3) : null;
  m.volume_to_liquidity_h24 = latest.volumeH24Usd !== null && latest.liquidityUsd ? round(latest.volumeH24Usd / latest.liquidityUsd, 3) : null;
  m.txns_h1 = buysH1 !== null && sellsH1 !== null ? buysH1 + sellsH1 : null;
  m.txns_m5 = latest.buysM5 !== null && latest.sellsM5 !== null ? latest.buysM5 + latest.sellsM5 : null;
  m.tx_frequency_per_min_h1 = m.txns_h1 !== null ? round(m.txns_h1 / 60, 3) : null;
  m.tx_frequency_per_min_m5 = m.txns_m5 !== null ? round(m.txns_m5 / 5, 3) : null;
  m.unique_buyers_h1 = latest.uniqueBuyersH1;
  m.unique_sellers_h1 = latest.uniqueSellersH1;
  m.unique_buyer_seller_ratio_h1 = latest.uniqueBuyersH1 !== null && latest.uniqueSellersH1 !== null ? (latest.uniqueSellersH1 === 0 ? (latest.uniqueBuyersH1 > 0 ? 10 : null) : round(latest.uniqueBuyersH1 / latest.uniqueSellersH1, 3)) : null;
  m.buys_per_unique_buyer_h1 = buysH1 !== null && latest.uniqueBuyersH1 ? round(buysH1 / latest.uniqueBuyersH1, 2) : null;
  m.top10_pct = latest.top10Pct;
  m.holders = latest.holders;
  m.liquidity_usd = latest.liquidityUsd;
  m.market_cap_usd = latest.marketCapUsd;
  m.volume_h1_usd = latest.volumeH1Usd;
  m.volume_m5_usd = latest.volumeM5Usd;

  // provider-reported price changes (rolling windows)
  const pc = market?.priceChangePct;
  m.price_change_m5 = pc?.m5 ?? null;
  m.price_change_h1 = pc?.h1 ?? null;
  m.price_change_h6 = pc?.h6 ?? null;
  m.price_change_h24 = pc?.h24 ?? null;
  // price acceleration: 5m pace vs 1h pace (positive => the last minutes moved faster than the hour average)
  m.price_acceleration = m.price_change_m5 !== null && m.price_change_h1 !== null ? round(m.price_change_m5 * 12 - m.price_change_h1, 2) : null;
  // volume acceleration from rolling windows: 5m pace vs 1h pace
  m.volume_acceleration_rolling = latest.volumeM5Usd !== null && latest.volumeH1Usd ? round((latest.volumeM5Usd * 12) / latest.volumeH1Usd, 3) : null;
  // volume h1 vs h6 average per hour
  const v6 = market?.volumeUsd.h6 ?? null;
  m.volume_h1_vs_h6_avg = latest.volumeH1Usd !== null && v6 ? round(latest.volumeH1Usd / (v6 / 6), 3) : null;

  // --- series-based growth ---
  for (const w of GROWTH_WINDOWS) {
    const old = snapshotAt(series.slice(0, -1), nowMs, TIMEFRAME_MS[w]);
    m[`holders_growth_${w}`] = old ? nz(pctChange(old.holders, latest.holders)) : null;
    m[`liquidity_growth_${w}`] = old ? nz(pctChange(old.liquidityUsd, latest.liquidityUsd)) : null;
    m[`volume_growth_${w}`] = old ? nz(pctChange(old.volumeH1Usd, latest.volumeH1Usd)) : null;
    m[`marketcap_growth_${w}`] = old ? nz(pctChange(old.marketCapUsd, latest.marketCapUsd)) : null;
    m[`price_growth_${w}`] = old ? nz(pctChange(old.priceUsd, latest.priceUsd)) : null;
    m[`unique_buyers_growth_${w}`] = old ? nz(pctChange(old.uniqueBuyersH1, latest.uniqueBuyersH1)) : null;
    m[`unique_sellers_growth_${w}`] = old ? nz(pctChange(old.uniqueSellersH1, latest.uniqueSellersH1)) : null;
    m[`holders_delta_${w}`] = old && old.holders !== null && latest.holders !== null ? latest.holders - old.holders : null;
  }
  // acceleration = growth over the last window vs the previous window of the same size
  for (const w of ["5m", "15m", "1h"] as Timeframe[]) {
    const mid = snapshotAt(series.slice(0, -1), nowMs, TIMEFRAME_MS[w]);
    const old = mid ? snapshotAt(series.slice(0, -1), new Date(mid.observedAt).getTime(), TIMEFRAME_MS[w]) : null;
    if (mid && old) {
      const g1 = pctChange(old.volumeH1Usd, mid.volumeH1Usd);
      const g2 = pctChange(mid.volumeH1Usd, latest.volumeH1Usd);
      m[`volume_acceleration_${w}`] = g1 !== null && g2 !== null ? round(g2 - g1, 2) : null;
      const h1 = pctChange(old.holders, mid.holders);
      const h2 = pctChange(mid.holders, latest.holders);
      m[`holders_acceleration_${w}`] = h1 !== null && h2 !== null ? round(h2 - h1, 2) : null;
    } else {
      m[`volume_acceleration_${w}`] = null;
      m[`holders_acceleration_${w}`] = null;
    }
  }
  // Holders created per $ of volume over the last hour: volume that does not create holders is suspicious.
  const oldH = snapshotAt(series.slice(0, -1), nowMs, TIMEFRAME_MS["1h"]);
  m.new_holders_per_10k_volume_h1 = oldH && oldH.holders !== null && latest.holders !== null && latest.volumeH1Usd ? round(((latest.holders - oldH.holders) / latest.volumeH1Usd) * 10_000, 3) : null;
  m.ath_drawdown_pct = athDrawdown(series);
  m.snapshots_count = series.length;
  m.series_span_minutes = series.length > 1 ? round((nowMs - new Date(series[0]!.observedAt).getTime()) / 60_000, 1) : 0;
  return m;
}

function nz(v: number | null): number | null {
  return v === null ? null : round(v, 2);
}

/** % distance of the latest price from the highest observed price in the series (<= 0). */
export function athDrawdown(series: SnapshotRecord[]): number | null {
  const prices = series.map((s) => s.priceUsd).filter((p): p is number => typeof p === "number" && p > 0);
  if (prices.length < 2) return null;
  const ath = Math.max(...prices);
  const last = prices[prices.length - 1]!;
  return round(((last - ath) / ath) * 100, 2);
}

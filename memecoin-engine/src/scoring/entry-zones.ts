import type { MarketPhase } from "../core/types.js";
import type { TokenMetrics } from "../analyzers/metrics.js";
import type { SnapshotRecord } from "../db/records.js";

/**
 * ENTRY ZONES — descriptive structure only, computed from observed price levels.
 * Never a recommendation; never claims an entry guarantees anything. Returns null when
 * the series is too short to describe structure honestly.
 */
export function describeEntryZones(series: SnapshotRecord[], metrics: TokenMetrics, phase: MarketPhase): Record<string, string> | null {
  const prices = series.map((s) => s.priceUsd).filter((p): p is number => typeof p === "number" && p > 0);
  if (prices.length < 4) return null;
  const last = prices[prices.length - 1]!;
  const recent = prices.slice(-Math.min(prices.length, 12));
  const lo = Math.min(...recent);
  const hi = Math.max(...recent);
  const f = (p: number) => (p < 0.01 ? p.toExponential(3) : p.toFixed(6));
  const pc1 = metrics.price_change_h1 ?? null;
  const zones: Record<string, string> = {};
  if (phase === "EARLY") {
    zones.EARLY_ENTRY_ZONE = `between recent low ${f(lo)} and current ${f(last)} only while holders/liquidity keep growing`;
    zones.CONFIRMATION_ZONE = `sustained trade above recent high ${f(hi)} with rising unique buyers and liquidity`;
  } else if (phase === "LATE") {
    zones.EARLY_ENTRY_ZONE = "passed";
    zones.CONFIRMATION_ZONE = `only a consolidation above ${f(lo)} with liquidity growth would re-open a setup`;
  } else {
    zones.EARLY_ENTRY_ZONE = "n/a";
    zones.CONFIRMATION_ZONE = "n/a — momentum exhausted";
  }
  zones.LATE_FOMO_ZONE = pc1 !== null && pc1 > 0 ? `chasing above ${f(hi)} after +${pc1.toFixed(0)}% in 1h (${phase === "EARLY" ? "would become" : "is"} FOMO)` : `chasing above ${f(hi)}`;
  zones.INVALIDATION_CONDITIONS = `price below ${f(lo)}; liquidity -30%; holders declining 15m; whale distribution; any authority/cluster flag`;
  zones.DISCLAIMER = "descriptive structure from observed data; not advice; no entry guarantees profit";
  return zones;
}

import { describe, it, expect } from "vitest";
import { computeMetrics, snapshotAt } from "../../src/analyzers/metrics.js";
import { makeSeries, at } from "../fixtures/factory.js";

describe("multi-timeframe metrics", () => {
  it("computes holder/volume/liquidity growth per window from the series", () => {
    const series = makeSeries([-60, -15, -5, 0], (i) => ({ holders: [100, 150, 180, 200][i], v1: [1000, 2000, 3000, 4000][i], liq: [10_000, 11_000, 12_000, 13_000][i], price: [0.001, 0.0012, 0.0013, 0.0015][i] }));
    const m = computeMetrics(series, new Date(at(0)));
    expect(m.holders_growth_1h).toBe(100);
    expect(m.holders_growth_15m).toBeCloseTo(33.33, 1);
    expect(m.holders_growth_5m).toBeCloseTo(11.11, 1);
    expect(m.volume_growth_1h).toBe(300);
    expect(m.liquidity_growth_15m).toBeCloseTo(18.18, 1);
    expect(m.price_growth_1h).toBe(50);
    expect(m.snapshots_count).toBe(4);
    expect(m.ath_drawdown_pct).toBe(0);
  });
  it("returns null for windows without a suitable older snapshot (no extrapolation)", () => {
    const series = makeSeries([-2, 0], (i) => ({ holders: [100, 110][i] }));
    const m = computeMetrics(series, new Date(at(0)));
    expect(m.holders_growth_1h).toBeNull();
    expect(m.holders_growth_15m).toBeNull();
    expect(m.holders_growth_1m).toBe(10);
  });
  it("rejects stale snapshots outside the tolerance window", () => {
    const series = makeSeries([-300, 0], (i) => ({ holders: [100, 300][i] }));
    expect(snapshotAt(series.slice(0, 1), new Date(at(0)).getTime(), 60 * 60_000)).toBeNull();
    const m = computeMetrics(series, new Date(at(0)));
    expect(m.holders_growth_1h).toBeNull();
    expect(m.holders_growth_4h).toBe(200);
  });
  it("derives ratios from a single snapshot", () => {
    const series = makeSeries([0], () => ({ holders: 400, v1: 20_000, liq: 50_000, mc: 300_000, b1: 200, s1: 100 }));
    const m = computeMetrics(series, new Date(at(0)));
    expect(m.buy_sell_ratio_h1).toBe(2);
    expect(m.volume_per_holder_h1).toBe(50);
    expect(m.liquidity_to_marketcap).toBeCloseTo(0.1667, 3);
    expect(m.volume_to_liquidity_h1).toBe(0.4);
  });
  it("computes acceleration (growth of growth) and ATH drawdown", () => {
    const series = makeSeries([-30, -15, 0], (i) => ({ v1: [1000, 1500, 4500][i], price: [0.001, 0.002, 0.001][i] }));
    const m = computeMetrics(series, new Date(at(0)));
    expect(m.volume_acceleration_15m).toBe(150); // +200% vs +50%
    expect(m.ath_drawdown_pct).toBe(-50);
  });
});

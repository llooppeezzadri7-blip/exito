import { describe, it, expect } from "vitest";
import { analyzeLiquidity } from "../../src/analyzers/liquidity.js";
import { computeMetrics } from "../../src/analyzers/metrics.js";
import { cfg, makeSnapshot, makeMarket, makeSeries, at, makeReport } from "../fixtures/factory.js";

describe("liquidity analyzer", () => {
  it("returns UNKNOWN without market data", () => {
    const r = analyzeLiquidity(makeSnapshot({ market: null }), {}, cfg);
    expect(r.score).toBeNull();
  });
  it("detects a liquidity drop from the series and raises exit risk", () => {
    const series = makeSeries([-30, -15, 0], (i) => ({ liq: [80_000, 78_000, 30_000][i], holders: 500 }));
    const m = computeMetrics(series, new Date(at(0)));
    const r = analyzeLiquidity(series[2]!.payload, m, cfg);
    expect(r.flags.map((f) => f.code)).toContain("LIQUIDITY_DROP");
    expect(r.metrics.exit_risk!).toBeGreaterThanOrEqual(85);
  });
  it("flags thin liquidity vs market cap and estimates sell impact", () => {
    const snap = makeSnapshot({ market: makeMarket({ liq: 5000, mc: 2_000_000 }) });
    const r = analyzeLiquidity(snap, computeMetrics([]), cfg);
    expect(r.flags.map((f) => f.code)).toContain("THIN_LIQUIDITY_VS_MC");
    expect(r.metrics.est_impact_5k_pct!).toBeGreaterThan(50);
    expect(r.metrics.exit_risk!).toBeGreaterThan(60);
  });
  it("flags unlocked LP with MEDIUM/HIGH severity", () => {
    const snap = makeSnapshot({ securityReport: makeReport({ lpLocked: 10 }) });
    snap.holders!.lpLockedPct = { ...snap.holders!.lpLockedPct, value: 10 };
    const r = analyzeLiquidity(snap, computeMetrics([]), cfg);
    expect(r.flags.find((f) => f.code === "LP_UNLOCKED")?.severity).toBe("HIGH");
  });
  it("gives a healthy pool a good score and low exit risk", () => {
    const snap = makeSnapshot({ market: makeMarket({ liq: 150_000, mc: 600_000 }) });
    const r = analyzeLiquidity(snap, computeMetrics([]), cfg);
    expect(r.score!).toBeGreaterThan(65);
    expect(r.metrics.exit_risk!).toBeLessThan(45);
  });
});

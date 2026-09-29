import { describe, it, expect } from "vitest";
import { analyzeMicrostructure, tapeStats } from "../../src/analyzers/microstructure.js";
import { computeMetrics } from "../../src/analyzers/metrics.js";
import { cfg, makeSnapshot, makeTrade, makeSeries, at, makeMarket } from "../fixtures/factory.js";

describe("market microstructure", () => {
  it("detects wash trading round-trips by the same wallet", () => {
    const trades = [];
    for (let i = 0; i < 20; i++) {
      const t = new Date(at(-30)).getTime() + i * 120_000;
      trades.push(makeTrade({ wallet: "WASHER", kind: "buy", ts: new Date(t).toISOString(), amountUsd: 500 }), makeTrade({ wallet: "WASHER", kind: "sell", ts: new Date(t + 20_000).toISOString(), amountUsd: 500 }));
    }
    const r = analyzeMicrostructure(makeSnapshot({ trades }), computeMetrics([]), cfg);
    expect(r.flags.map((f) => f.code)).toEqual(expect.arrayContaining(["WASH_TRADING_SUSPECTED", "SINGLE_WALLET_DOMINATES_VOLUME"]));
    expect(r.score!).toBeLessThan(40);
  });
  it("rewards an organic tape with many distinct participants", () => {
    const trades = Array.from({ length: 40 }, (_, i) => makeTrade({ wallet: `W${i}`, kind: i % 3 === 0 ? "sell" : "buy", minute: -40 + i, amountUsd: 50 + (i * 37) % 400 }));
    const r = analyzeMicrostructure(makeSnapshot({ trades }), computeMetrics([]), cfg);
    expect(r.score!).toBeGreaterThanOrEqual(70);
    expect(tapeStats(trades).unique_wallets).toBe(40);
  });
  it("flags volume that does not create holders", () => {
    const series = makeSeries([-60, 0], (i) => ({ holders: [500, 501][i], v1: 80_000 }));
    const m = computeMetrics(series, new Date(at(0)));
    const r = analyzeMicrostructure(series[1]!.payload, m, cfg);
    expect(r.flags.map((f) => f.code)).toContain("VOLUME_WITHOUT_HOLDERS");
  });
  it("flags abnormal volume/liquidity turnover", () => {
    const snap = makeSnapshot({ market: makeMarket({ liq: 5000, v24: 500_000 }) });
    const r = analyzeMicrostructure(snap, computeMetrics([{ ...require_record(snap) }]), cfg);
    expect(r.flags.map((f) => f.code)).toContain("ABNORMAL_VOLUME");
  });
});

import { toRecord } from "../fixtures/factory.js";
function require_record(s: ReturnType<typeof makeSnapshot>) {
  return toRecord(s);
}

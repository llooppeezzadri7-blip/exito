import { describe, it, expect } from "vitest";
import { analyzeHolders, holderStats } from "../../src/analyzers/holders.js";
import { computeMetrics } from "../../src/analyzers/metrics.js";
import { cfg, makeSnapshot, makeHolders, makeTrade } from "../fixtures/factory.js";

describe("holder analysis", () => {
  it("excludes LP/pool accounts from concentration", () => {
    const st = holderStats(makeHolders([5, 4, 3], { lpPct: 40 })!.top, 3);
    expect(st.lpPct).toBe(40);
    expect(st.top10Pct).toBe(12);
    expect(st.largestNonLpPct).toBe(5);
  });
  it("flags a single wallet above the max as CRITICAL", () => {
    const r = analyzeHolders(makeSnapshot({ holders: makeHolders([45, 5, 3], { lpPct: 20 }) }), computeMetrics([]), cfg);
    expect(r.flags.find((f) => f.code === "SUPPLY_CONCENTRATION")?.severity).toBe("CRITICAL");
    expect(r.score!).toBeLessThan(45);
  });
  it("does not penalize whales that are accumulating", () => {
    const h = makeHolders([4, 3.5, 3, 2, 1], { lpPct: 20 });
    const whale = h!.top.find((x) => x.pct === 4)!;
    const trades = [makeTrade({ wallet: whale.owner!, kind: "buy", amountUsd: 5000, minute: -10 }), makeTrade({ wallet: whale.owner!, kind: "buy", amountUsd: 3000, minute: -5 })];
    const r = analyzeHolders(makeSnapshot({ holders: h, trades }), computeMetrics([]), cfg);
    expect(r.flags.map((f) => f.code)).not.toContain("WHALE_DISTRIBUTION");
    expect(r.metrics.whale_net_usd_1h).toBe(8000);
  });
  it("flags whale distribution when whales net sell", () => {
    const h = makeHolders([4, 3.5, 3, 2, 1], { lpPct: 20 });
    const whale = h!.top.find((x) => x.pct === 4)!;
    const trades = [makeTrade({ wallet: whale.owner!, kind: "sell", amountUsd: 9000, minute: -10 }), makeTrade({ wallet: whale.owner!, kind: "sell", amountUsd: 3000, minute: -5 })];
    const r = analyzeHolders(makeSnapshot({ holders: h, trades }), computeMetrics([]), cfg);
    expect(r.flags.find((f) => f.code === "WHALE_DISTRIBUTION")?.severity).toBe("HIGH");
  });
  it("flags deployer holding supply", () => {
    const snap = makeSnapshot({ holders: makeHolders([18, 3, 2], { lpPct: 20, owners: ["DEPLOYER1111111111111111111111111111111111"] }) });
    const r = analyzeHolders(snap, computeMetrics([]), cfg);
    expect(r.flags.find((f) => f.code === "DEPLOYER_HOLDS_SUPPLY")?.severity).toBe("HIGH");
  });
  it("returns UNKNOWN without holder data", () => {
    const r = analyzeHolders(makeSnapshot({ holders: null, securityReport: null }), computeMetrics([]), cfg);
    expect(r.score).toBeNull();
  });
});

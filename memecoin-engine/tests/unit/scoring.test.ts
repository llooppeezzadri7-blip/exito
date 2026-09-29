import { describe, it, expect } from "vitest";
import { scoreOpportunity } from "../../src/scoring/opportunity.js";
import { assessRugRisk } from "../../src/risk/rug-detector.js";
import { evaluateGates } from "../../src/risk/gates.js";
import { assessPhase } from "../../src/risk/phase.js";
import { adversarialAnalysis } from "../../src/scoring/adversarial.js";
import type { AnalyzerResult } from "../../src/core/types.js";
import { cfg } from "../fixtures/factory.js";

const res = (analyzer: string, score: number | null, metrics: Record<string, number | null> = {}, flags: AnalyzerResult["flags"] = []): AnalyzerResult => ({ analyzer, score, confidence: score === null ? "UNKNOWN" : "HIGH", flags, evidence: [], metrics, computedAt: new Date().toISOString() });

function goodResults(): AnalyzerResult[] {
  return [res("security", 95), res("liquidity", 80, { exit_risk: 25 }), res("holders", 78, { holder_growth_component: 85, top10_pct: 18 }), res("deployer", 60), res("wallet-cluster", 90), res("microstructure", 75), res("social", 70), res("narrative", 60, { narrative_saturation: 0.2 }), res("early-momentum", 80), res("anomaly", 100, { anomaly_count: 0 })];
}
const goodMetrics = { holders_growth_15m: 40, unique_buyers_growth_15m: 50, liquidity_growth_1h: 12, volume_acceleration_15m: 120, unique_buyer_seller_ratio_h1: 2, price_change_h1: 30, snapshots_count: 10, market_cap_usd: 300_000, liquidity_usd: 60_000, top10_pct: 18 };

function run(results: AnalyzerResult[], metrics: Record<string, number | null>, opts: { dq?: number; sat?: number | null } = {}) {
  const rug = assessRugRisk(results, { extreme: cfg.risk_gates.extreme_risk_rug_threshold });
  const phase = assessPhase(metrics, cfg.no_fomo, false);
  const exitRisk = results.find((r) => r.analyzer === "liquidity")?.metrics.exit_risk ?? null;
  const sec = results.find((r) => r.analyzer === "security");
  const gates = evaluateGates({ rugRisk: rug.rugRisk, exitRisk, dataQuality: opts.dq ?? 0.9, securityScore: sec?.score ?? null, securityUnknown: !sec || sec.score === null, clusterSuspected: results.some((r) => r.flags.some((f) => f.code === "SUSPICIOUS_WALLET_CLUSTER" && f.severity !== "MEDIUM")), mintAuthority: sec?.flags.some((f) => f.code === "MINT_AUTHORITY_ACTIVE") ?? null, freezeAuthority: sec?.flags.some((f) => f.code === "FREEZE_AUTHORITY_ACTIVE") ?? null, liquidityUsd: metrics.liquidity_usd ?? null, holders: 500 }, cfg);
  const adv = adversarialAnalysis(results, metrics);
  return { out: scoreOpportunity({ results, metrics, rug, gates, phase, adversarial: adv, exitRisk, dataQuality: opts.dq ?? 0.9, narrativeSaturation: opts.sat ?? 0.2 }, cfg), rug, gates, phase, adv };
}

describe("opportunity scoring", () => {
  it("produces an explained breakdown with positive and negative factors that sum to the score", () => {
    const results = goodResults();
    results[1] = res("liquidity", 70, { exit_risk: 45 });
    const { out } = run(results, goodMetrics);
    expect(out.score).not.toBeNull();
    const sum = out.breakdown.reduce((a, b) => a + b.points, 0);
    expect(Math.abs(sum - out.score!)).toBeLessThan(0.2);
    expect(out.breakdown.some((b) => b.points > 0)).toBe(true);
    expect(out.breakdown.some((b) => b.points < 0)).toBe(true); // negatives never hidden
    expect(out.whyDetected.length).toBeGreaterThan(0);
  });
  it("classifies a strong early setup as HIGH_CONVICTION_SETUP with >=3 independent signals", () => {
    const { out } = run(goodResults(), goodMetrics);
    expect(out.category).toBe("HIGH_CONVICTION_SETUP");
    expect(out.independentSignals).toBeGreaterThanOrEqual(3);
    expect(out.phase).toBe("EARLY");
    expect(out.statusText).toMatch(/REQUIRES MANUAL VERIFICATION/);
  });
  it("NO FOMO: a vertical pump turns the same setup LATE and reduces the score", () => {
    const early = run(goodResults(), goodMetrics).out;
    const late = run(goodResults(), { ...goodMetrics, price_change_h1: 400, price_change_m5: 80 }).out;
    expect(late.phase).toBe("LATE");
    expect(late.score!).toBeLessThan(early.score! - 10);
    expect(late.category).not.toBe("HIGH_CONVICTION_SETUP");
  });
  it("EXHAUSTED: volume collapse after a run-up is never a setup", () => {
    const { out } = run(goodResults(), { ...goodMetrics, price_change_h24: 500, volume_growth_1h: -75, ath_drawdown_pct: -50 });
    expect(out.phase).toBe("EXHAUSTED");
    expect(["NO_OPPORTUNITY", "WATCHLIST"]).toContain(out.category);
    expect(out.category).not.toBe("HIGH_CONVICTION_SETUP");
  });
  it("RISK GATE: mint authority forces REJECTED regardless of momentum", () => {
    const results = goodResults();
    results[0] = res("security", 55, {}, [{ code: "MINT_AUTHORITY_ACTIVE", severity: "CRITICAL", message: "mint" }]);
    const { out, gates } = run(results, goodMetrics);
    expect(gates.forcedCategory).toBe("REJECTED");
    expect(out.category).toBe("REJECTED");
  });
  it("RISK GATE: unknown security => SECURITY_UNVERIFIED", () => {
    const results = goodResults();
    results[0] = res("security", null);
    expect(run(results, goodMetrics).out.category).toBe("SECURITY_UNVERIFIED");
  });
  it("RISK GATE: low data quality => INSUFFICIENT_DATA", () => {
    expect(run(goodResults(), goodMetrics, { dq: 0.3 }).out.category).toBe("INSUFFICIENT_DATA");
  });
  it("RISK GATE: suspected wallet manipulation => INVESTIGATE", () => {
    const results = goodResults();
    results[4] = res("wallet-cluster", 30, {}, [{ code: "SUSPICIOUS_WALLET_CLUSTER", severity: "CRITICAL", message: "cluster" }]);
    expect(run(results, goodMetrics).out.category).toBe("INVESTIGATE");
  });
  it("RISK GATE: exit risk above threshold blocks opportunity alerts", () => {
    const results = goodResults();
    results[1] = res("liquidity", 30, { exit_risk: 90 });
    const { out } = run(results, goodMetrics);
    expect(out.category).toBe("NO_OPPORTUNITY");
  });
  it("NO_OPPORTUNITY is a valid result when nothing is compelling", () => {
    const weak = [res("security", 90), res("liquidity", 40, { exit_risk: 50 }), res("holders", 40, { holder_growth_component: 40 }), res("deployer", null), res("wallet-cluster", 60), res("microstructure", 45), res("social", null), res("narrative", null), res("early-momentum", 35), res("anomaly", 100)];
    const { out } = run(weak, { snapshots_count: 5, price_change_h1: 2 });
    expect(out.category).toBe("NO_OPPORTUNITY");
    expect(out.breakdown.find((b) => b.factor === "deployer_uncertainty")).toBeDefined();
  });
  it("EXTREME_RISK when rug flags dominate even with momentum", () => {
    const results = goodResults();
    results[2] = res("holders", 10, { holder_growth_component: 90, top10_pct: 75 }, [{ code: "SUPPLY_CONCENTRATION", severity: "CRITICAL", message: "single wallet 40%" }]);
    results[3] = res("deployer", 5, {}, [{ code: "DEPLOYER_PREVIOUS_RUGS", severity: "CRITICAL", message: "rugs" }]);
    results[1] = res("liquidity", 50, { exit_risk: 40 }, [{ code: "LP_UNLOCKED", severity: "HIGH", message: "lp" }]);
    const { out, rug } = run(results, goodMetrics);
    expect(rug.level).toBe("EXTREME_RISK");
    expect(out.category).toBe("EXTREME_RISK");
  });
  it("conflicting signals reduce confidence", () => {
    const base = run(goodResults(), goodMetrics).out;
    const conflicted = run(goodResults(), { ...goodMetrics, holders_growth_15m: -5, volume_growth_1h: 300, liquidity_growth_1h: -10, price_change_h1: 60 }).out;
    const order = ["UNKNOWN", "LOW", "MEDIUM", "HIGH"];
    expect(order.indexOf(conflicted.confidence)).toBeLessThan(order.indexOf(base.confidence));
  });
  it("adversarial analysis always produces a bear case", () => {
    const { adv } = run(goodResults(), goodMetrics);
    expect(adv.bull.length).toBeGreaterThan(0);
    expect(adv.bear.length).toBeGreaterThan(0);
    expect(adv.bear.join(" ")).toMatch(/every memecoin can go to zero/);
  });
  it("saturated narrative is penalized", () => {
    const a = run(goodResults(), goodMetrics, { sat: 0.1 }).out.score!;
    const b = run(goodResults(), goodMetrics, { sat: 0.95 }).out.score!;
    expect(b).toBeLessThan(a);
  });
});

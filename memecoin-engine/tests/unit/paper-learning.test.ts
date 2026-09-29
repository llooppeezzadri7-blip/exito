import { describe, it, expect } from "vitest";
import { PaperTradingEngine, paperStats } from "../../src/paper/engine.js";
import { labelOutcome, resolveOne } from "../../src/learning/outcomes.js";
import { learnFromOutcomes } from "../../src/learning/statistical.js";
import { findSimilarPatterns } from "../../src/learning/comparison.js";
import { MemoryStore } from "../../src/db/memory-store.js";
import { ProviderRegistry } from "../../src/providers/registry.js";
import { logger } from "../../src/core/logger.js";
import type { EngineContext } from "../../src/pipeline/context.js";
import type { AnalysisOutcome } from "../../src/pipeline/analyze-token.js";
import type { OutcomeRecord, PredictionRecord } from "../../src/db/records.js";
import { cfg, makeSnapshot, makeToken, makeMarket, toRecord, at } from "../fixtures/factory.js";

function ctx(store = new MemoryStore()): EngineContext & { setNow: (d: Date) => void } {
  let now = new Date(at(0));
  return { cfg, store, registry: new ProviderRegistry(), log: logger, now: () => now, counters: {}, setNow: (d) => (now = d) };
}
const out = (price: number, o: Partial<AnalysisOutcome["opportunity"]> = {}): AnalysisOutcome => ({ token: makeToken(), snapshot: makeSnapshot({ market: makeMarket({ price }) }), snapshotId: 1, metrics: {}, results: [], opportunity: { chain: "solana", mint: makeToken().mint, score: 80, category: "HIGH_CONVICTION_SETUP", confidence: "MEDIUM", phase: "EARLY", risk: "MEDIUM_RISK", rugRisk: 20, exitRisk: 30, dataQuality: 0.9, thesis: "THESIS_INTACT", breakdown: [], subscores: {}, whyDetected: [], risks: [], flags: [], bullCase: [], bearCase: [], conflicts: [], entryZones: null, statusText: "", gates: [], snapshotId: 1, computedAt: at(0), ...o }, previous: null, newFlags: [], thesisReasons: [], tierBefore: 3, tierAfter: 3 });

describe("paper trading engine", () => {
  it("opens on HIGH_CONVICTION_SETUP (EARLY) with slippage + fee, and closes at take-profit", async () => {
    const c = ctx();
    const eng = new PaperTradingEngine(c);
    const r1 = await eng.onAnalysis(out(0.001));
    expect(r1.opened).toBeDefined();
    expect(r1.opened!.entryFillPriceUsd).toBeCloseTo(0.001 * 1.025, 8);
    expect(r1.opened!.sizeUsd).toBe(20); // 2% of $1000
    expect(r1.opened!.feesUsd).toBeCloseTo(0.12, 4);
    c.setNow(new Date(at(30)));
    const r2 = await eng.onAnalysis(out(0.0025));
    expect(r2.closed?.exitReason).toBe("TAKE_PROFIT");
    expect(r2.closed!.pnlPct!).toBeGreaterThan(100);
    expect(r2.closed!.pnlUsd!).toBeLessThan(20 * 1.5); // fees + slippage subtracted
  });
  it("does not open when the phase is LATE or a gate failed", async () => {
    const eng = new PaperTradingEngine(ctx());
    expect((await eng.onAnalysis(out(0.001, { phase: "LATE" }))).opened).toBeUndefined();
    expect((await eng.onAnalysis(out(0.001, { gates: [{ gate: "x", passed: false, detail: "" }] }))).opened).toBeUndefined();
  });
  it("closes on stop loss with double slippage and on thesis invalidation", async () => {
    const c = ctx();
    const eng = new PaperTradingEngine(c);
    await eng.onAnalysis(out(0.001));
    const r = await eng.onAnalysis(out(0.0006));
    expect(r.closed?.exitReason).toBe("STOP_LOSS");
    expect(r.closed!.exitFillPriceUsd).toBeCloseTo(0.0006 * 0.95, 8);
    const c2 = ctx();
    const eng2 = new PaperTradingEngine(c2);
    await eng2.onAnalysis(out(0.001));
    const r2 = await eng2.onAnalysis(out(0.0011, { thesis: "THESIS_INVALIDATED" }));
    expect(r2.closed?.exitReason).toMatch(/THESIS_EXIT/);
  });
  it("computes honest stats and warns on small samples", async () => {
    const trades = [
      { pnlPct: 50, pnlUsd: 10, status: "CLOSED", exitReason: "TAKE_PROFIT", closedAt: at(1) },
      { pnlPct: -35, pnlUsd: -7, status: "CLOSED", exitReason: "STOP_LOSS", closedAt: at(2) },
      { pnlPct: -20, pnlUsd: -4, status: "CLOSED", exitReason: "THESIS_EXIT:THESIS_INVALIDATED", closedAt: at(3) },
      { pnlPct: null, pnlUsd: null, status: "OPEN", exitReason: null, closedAt: null },
    ] as any;
    const s = paperStats(trades, 1000);
    expect(s.trades).toBe(3);
    expect(s.open).toBe(1);
    expect(s.winRate).toBeCloseTo(0.333, 2);
    expect(s.averageReturnPct).toBeCloseTo(-1.67, 1);
    expect(s.medianReturnPct).toBe(-20);
    expect(s.falsePositiveRate).toBeCloseTo(0.667, 2);
    expect(s.maxDrawdownPct).toBeCloseTo(-1.09, 1);
    expect(s.sampleWarning).toMatch(/only 3/);
  });
});

describe("learning engine", () => {
  it("labels outcomes including liquidity drains and rugs", () => {
    const c = { bigMovePct: 100, bigDropPct: -60 };
    expect(labelOutcome(150, 10000, 12000, c)).toBe("BIG_UP");
    expect(labelOutcome(25, 10000, 12000, c)).toBe("UP");
    expect(labelOutcome(-5, 10000, 12000, c)).toBe("SIDEWAYS");
    expect(labelOutcome(-70, 10000, 9000, c)).toBe("BIG_DOWN");
    expect(labelOutcome(-90, 10000, 500, c)).toBe("RUG");
    expect(labelOutcome(-30, 10000, 500, c)).toBe("LIQUIDITY_DRAIN");
    expect(labelOutcome(null, null, null, c)).toBe("UNKNOWN");
  });
  it("resolves a prediction from stored snapshots only (no lookahead beyond horizon)", async () => {
    const c = ctx();
    const mk = (minute: number, price: number, liq: number) => toRecord(makeSnapshot({ observedAt: at(minute), market: makeMarket({ price, liq, observedAt: at(minute) }) }));
    for (const [m, p, l] of [[0, 0.001, 50000], [30, 0.0015, 52000], [60, 0.002, 55000], [240, 0.01, 90000]] as const) await c.store.insertSnapshot(mk(m, p, l));
    const p: PredictionRecord = { id: "p1", chain: "solana", mint: makeToken().mint, madeAt: at(0), horizonHours: 1, resolveAt: at(60), category: "WATCHLIST", score: 60, confidence: "MEDIUM", features: {}, priceAt: 0.001, marketCapAt: null, liquidityAt: 50000, modelVersion: "rule-v1", resolved: false };
    c.setNow(new Date(at(300)));
    const o = await resolveOne(c, p);
    expect(o.priceAfter).toBe(0.002);
    expect(o.returnPct).toBe(100);
    expect(o.label).toBe("BIG_UP");
    expect(o.maxReturnPct).toBe(100); // the +900% at 4h is outside the 1h horizon
  });
  it("proposes bounded weight changes only with enough samples, never touching penalties", () => {
    const pairs: { prediction: PredictionRecord; outcome: OutcomeRecord }[] = [];
    for (let i = 0; i < 80; i++) {
      const hi = i % 2 === 0;
      const good = hi ? i % 4 === 0 || i % 4 === 2 : i % 8 === 1; // high early_momentum => 100% good, low => 25%
      pairs.push({ prediction: { id: `p${i}`, chain: "solana", mint: `m${i}`, madeAt: at(0), horizonHours: 4, resolveAt: at(240), category: "WATCHLIST", score: 60, confidence: "MEDIUM", features: { early_momentum: hi ? 80 : 20, liquidity: 50 }, priceAt: 1, marketCapAt: null, liquidityAt: null, modelVersion: "rule-v1", resolved: true }, outcome: { predictionId: `p${i}`, chain: "solana", mint: `m${i}`, horizonHours: 4, priceAt: 1, priceAfter: good ? 2 : 0.8, returnPct: good ? 100 : -20, maxReturnPct: null, minReturnPct: null, liquidityAt: null, liquidityAfter: null, label: good ? "BIG_UP" : "DOWN", resolvedAt: at(240) } });
    }
    const small = learnFromOutcomes(pairs.slice(0, 10), cfg.scoring.weights, 30);
    expect(small.proposedWeights).toBeNull();
    const rep = learnFromOutcomes(pairs, cfg.scoring.weights, 30);
    expect(rep.proposedWeights).not.toBeNull();
    const lift = rep.featureLifts.find((f) => f.feature === "early_momentum")!;
    expect(lift.lift).toBeGreaterThan(0.5);
    const ratio = rep.proposedWeights!.early_momentum! / cfg.scoring.weights.early_momentum;
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThanOrEqual(1.31);
    expect(Object.keys(rep.proposedWeights!).sort()).toEqual(Object.keys(cfg.scoring.weights).sort());
  });
  it("finds similar historical patterns descriptively", () => {
    const hist = [1, 2, 3].map((i) => ({ prediction: { id: `h${i}`, chain: "solana", mint: `hist${i}`, madeAt: at(0), horizonHours: 4, resolveAt: at(240), category: "WATCHLIST", score: 60, confidence: "MEDIUM", features: { market_cap_usd: 300_000 * i, liquidity_usd: 50_000 * i, holders: 500 * i, top10_pct: 20, early_momentum: 70 }, priceAt: 1, marketCapAt: null, liquidityAt: null, modelVersion: "rule-v1", resolved: true } as PredictionRecord, outcome: { predictionId: `h${i}`, chain: "solana", mint: `hist${i}`, horizonHours: 4, priceAt: 1, priceAfter: 2, returnPct: 100 * i, maxReturnPct: null, minReturnPct: null, liquidityAt: null, liquidityAfter: null, label: "BIG_UP", resolvedAt: at(240) } as OutcomeRecord, tokenAgeHours: 2 }));
    const sim = findSimilarPatterns({ market_cap_usd: 310_000, liquidity_usd: 52_000, holders: 510, top10_pct: 21, early_momentum: 72 }, hist, 2);
    expect(sim[0]!.mint).toBe("hist1");
    expect(sim).toHaveLength(2);
  });
});

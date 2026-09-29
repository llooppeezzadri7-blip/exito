import { describe, it, expect } from "vitest";
import { AlertEngine } from "../../src/alerts/engine.js";
import { formatOpportunityAlert } from "../../src/alerts/format.js";
import { MemoryStore } from "../../src/db/memory-store.js";
import type { EngineContext } from "../../src/pipeline/context.js";
import type { AnalysisOutcome } from "../../src/pipeline/analyze-token.js";
import type { OpportunityRecord } from "../../src/db/records.js";
import { ProviderRegistry } from "../../src/providers/registry.js";
import { logger } from "../../src/core/logger.js";
import { cfg, makeSnapshot, makeToken, at } from "../fixtures/factory.js";

function ctx(now = new Date(at(0))): EngineContext {
  return { cfg, store: new MemoryStore(), registry: new ProviderRegistry(), log: logger, now: () => now, counters: {} };
}
function opp(o: Partial<OpportunityRecord> = {}): OpportunityRecord {
  return { chain: "solana", mint: makeToken().mint, score: 80, category: "HIGH_CONVICTION_SETUP", confidence: "MEDIUM", phase: "EARLY", risk: "MEDIUM_RISK", rugRisk: 25, exitRisk: 30, dataQuality: 0.9, thesis: "NO_THESIS", breakdown: [], subscores: { early_momentum: 80 }, whyDetected: ["holders +40% / 15m (+12)"], risks: ["deployer unknown (-6)"], flags: [], bullCase: [], bearCase: ["every memecoin can go to zero"], conflicts: [], entryZones: null, statusText: "SETUP DETECTED — EARLY — REQUIRES MANUAL VERIFICATION (confidence MEDIUM)", gates: [{ gate: "rug_risk", passed: true, detail: "25" }], snapshotId: 1, computedAt: at(0), ...o };
}
function outcome(o: Partial<AnalysisOutcome> = {}): AnalysisOutcome {
  return { token: makeToken({ tier: 3 }), snapshot: makeSnapshot(), snapshotId: 1, metrics: { liquidity_growth_15m: -40 }, results: [], opportunity: opp(), previous: null, newFlags: [], thesisReasons: [], tierBefore: 3, tierAfter: 3, ...o };
}

class Recorder { id = "rec"; sent: string[] = []; async send(_t: string, b: string) { this.sent.push(b); } }

describe("alert engine", () => {
  it("emits NEW_HIGH_POTENTIAL for a new high-conviction setup with professional wording (never 'buy')", async () => {
    const rec = new Recorder();
    const eng = new AlertEngine(ctx(), [rec], "http://dash");
    const alerts = await eng.process(outcome());
    expect(alerts.map((a) => a.type)).toEqual(["NEW_HIGH_POTENTIAL"]);
    const body = rec.sent[0]!;
    expect(body).toMatch(/MEMECOIN ALERT/);
    expect(body).toMatch(/REQUIRES MANUAL VERIFICATION/);
    expect(body).toMatch(/RISKS:/);
    expect(body).toMatch(/Sources:/);
    expect(body).toMatch(/Observed:/);
    expect(body.toLowerCase()).not.toMatch(/compra|buy now|guaranteed/);
    expect(body).toMatch(/PAPER TRADE \/ WATCH \/ IGNORE/);
  });
  it("does not alert as opportunity when a risk gate failed", async () => {
    const eng = new AlertEngine(ctx(), [new Recorder()], null);
    const alerts = await eng.process(outcome({ opportunity: opp({ gates: [{ gate: "rug_risk", passed: false, detail: "80" }] }) }));
    expect(alerts.filter((a) => a.type === "NEW_HIGH_POTENTIAL")).toHaveLength(0);
  });
  it("enforces cooldown per token/type", async () => {
    const c = ctx();
    const eng = new AlertEngine(c, [new Recorder()], null);
    expect(await eng.process(outcome())).toHaveLength(1);
    expect(await eng.process(outcome())).toHaveLength(0);
    expect(c.counters.alerts_suppressed_cooldown).toBe(1);
  });
  it("emits LIQUIDITY_DROP and EXIT_WARNING when a watched thesis breaks", async () => {
    const eng = new AlertEngine(ctx(), [new Recorder()], null);
    const alerts = await eng.process(outcome({ previous: opp({ category: "WATCHLIST" }), opportunity: opp({ category: "NO_OPPORTUNITY", thesis: "THESIS_INVALIDATED", score: 30 }), newFlags: ["LIQUIDITY_DROP"], thesisReasons: ["liquidity -40%"] }));
    expect(alerts.map((a) => a.type)).toEqual(["LIQUIDITY_DROP"]);
  });
  it("emits WHALE_EXIT and RISK_ESCALATION for previously interesting tokens", async () => {
    const eng = new AlertEngine(ctx(), [new Recorder()], null);
    const alerts = await eng.process(outcome({ previous: opp({ category: "WATCHLIST", rugRisk: 20 }), opportunity: opp({ category: "WATCHLIST", thesis: "RISK_ESCALATING", rugRisk: 45 }), newFlags: ["WHALE_DISTRIBUTION"], thesisReasons: ["rug risk 20 → 45"] }));
    expect(alerts.map((a) => a.type).sort()).toEqual(["RISK_ESCALATION", "WHALE_EXIT"]);
  });
  it("BREAKOUT_SETUP when a watchlist token upgrades to high conviction", async () => {
    const eng = new AlertEngine(ctx(), [new Recorder()], null);
    const alerts = await eng.process(outcome({ previous: opp({ category: "WATCHLIST" }) }));
    expect(alerts.map((a) => a.type)).toEqual(["BREAKOUT_SETUP"]);
  });
  it("records delivery failures without throwing and keeps the alert persisted", async () => {
    const c = ctx();
    const bad = { id: "bad", send: async () => { throw new Error("telegram 500"); } };
    const eng = new AlertEngine(c, [bad], null);
    const alerts = await eng.process(outcome());
    expect(alerts).toHaveLength(1);
    const stored = await c.store.listAlerts({});
    expect(stored[0]!.error).toMatch(/telegram 500/);
    expect(stored[0]!.deliveredTo).toEqual([]);
  });
  it("formatter shows UNKNOWN fields as unknown, never fabricated", () => {
    const snap = makeSnapshot({ market: null, sources: [] });
    const d = formatOpportunityAlert("NEW_HIGH_POTENTIAL", makeToken(), snap, opp());
    expect(d.body).toMatch(/Market Cap: unknown/);
    expect(d.body).toMatch(/Liquidity: unknown/);
  });
});

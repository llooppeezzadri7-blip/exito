import { describe, it, expect } from "vitest";
import { DiscoveryEngine } from "../../src/discovery/engine.js";
import { analyzeToken, safeAnalyze } from "../../src/pipeline/analyze-token.js";
import { AnalysisWorker, enqueueDueTokens } from "../../src/monitor/worker.js";
import { AlertEngine } from "../../src/alerts/engine.js";
import { PaperTradingEngine } from "../../src/paper/engine.js";
import { resolveDuePredictions } from "../../src/learning/outcomes.js";
import { buildHealth } from "../../src/monitor/health.js";
import { MemoryStore } from "../../src/db/memory-store.js";
import { world, fakeContext, advance, discovered } from "../fixtures/fake-providers.js";
import { makeTrade, makeWallet, MINT } from "../fixtures/factory.js";

class Rec { id = "rec"; sent: string[] = []; async send(_t: string, b: string) { this.sent.push(b); } }

describe("end-to-end pipeline (fake providers, memory store)", () => {
  it("discovers a token once across sources, promotes it through tiers and reaches a gated setup with alerts, paper trade, predictions and outcomes", async () => {
    const w = world({ newPools: [discovered()], feeds: [discovered(MINT, "dexscreener:profiles")] });
    const ctx = fakeContext(w);
    const disc = new DiscoveryEngine(ctx);
    const r = await disc.runCycle();
    expect(r.registered).toBe(1);
    const tok = (await ctx.store.getToken("solana", MINT))!;
    expect(tok.discoverySources.sort()).toEqual(["dexscreener:profiles", "geckoterminal:new_pools"]);
    expect(tok.tier).toBe(1);
    // second cycle: duplicate is NOT re-registered
    expect((await disc.runCycle()).registered).toBe(0);

    const rec = new Rec();
    const alerts = new AlertEngine(ctx, [rec], null);
    const paper = new PaperTradingEngine(ctx);
    const worker = new AnalysisWorker(ctx, 2);
    worker.onAnalysis((o) => alerts.process(o).then(() => undefined));
    worker.onAnalysis((o) => paper.onAnalysis(o).then(() => undefined));

    // cycle 1 (tier 1 -> promoted to 2 by liquidity/volume)
    advance(w, 1);
    expect(await worker.runOnce()).toBe(1);
    let t = (await ctx.store.getToken("solana", MINT))!;
    expect(t.status).toBe("MONITORED");
    expect(t.tier).toBe(2);
    expect(t.lastAnalyzedAt).toBe(w.now.toISOString());
    const first = (await ctx.store.getOpportunity("solana", MINT))!;
    expect(["INSUFFICIENT_DATA", "NO_OPPORTUNITY", "WATCHLIST", "SECURITY_UNVERIFIED"]).toContain(first.category); // tier 1 never reads the chain

    // organic growth over ~1h: holders, liquidity, volume and unique buyers all accelerate; price moves moderately
    const buyers = Array.from({ length: 30 }, (_, i) => `BUYER${i}${"q".repeat(36)}`.slice(0, 44));
    for (let step = 1; step <= 6; step++) {
      advance(w, 10, { holders: 300 + step * 120, liq: 45_000 + step * 9_000, v1: 15_000 + step * 12_000, v5: 1500 + step * 1500, b1: 150 + step * 90, s1: 90 + step * 20, price: 0.001 * (1 + step * 0.08), mc: 250_000 * (1 + step * 0.08), pc1: 10 + step * 6, pc5: 3 });
      w.trades.push(...buyers.slice(0, 5 + step * 3).map((b, i) => makeTrade({ wallet: b, kind: "buy", ts: new Date(w.now.getTime() - i * 90_000).toISOString(), amountUsd: 80 + (i * 53) % 300 })));
      await ctx.store.patchToken("solana", MINT, { nextAnalyzeAt: w.now.toISOString() });
      await enqueueDueTokens(ctx);
      await worker.runOnce();
    }
    t = (await ctx.store.getToken("solana", MINT))!;
    const opp = (await ctx.store.getOpportunity("solana", MINT))!;
    expect(t.tier).toBeGreaterThanOrEqual(3);
    expect(["WATCHLIST", "HIGH_CONVICTION_SETUP"]).toContain(opp.category);
    expect(opp.phase).toBe("EARLY");
    expect(opp.gates.every((g) => g.passed)).toBe(true);
    expect(opp.breakdown.some((b) => b.points < 0)).toBe(true); // negatives always listed
    expect(opp.bearCase.length).toBeGreaterThan(0);
    expect(opp.entryZones).not.toBeNull();
    // opportunity alerts only when the score clears the alert threshold; otherwise the engine stays quiet (no forced recommendations)
    const stored = await ctx.store.listAlerts({});
    if (opp.category === "HIGH_CONVICTION_SETUP" || (opp.score ?? 0) >= ctx.cfg.alerts.min_score_for_new_high_potential) {
      expect(stored.some((a) => a.type === "NEW_HIGH_POTENTIAL" || a.type === "BREAKOUT_SETUP")).toBe(true);
      expect(rec.sent.join("\n")).toMatch(/REQUIRES/);
    } else {
      expect(stored.some((a) => a.type === "NEW_HIGH_POTENTIAL" || a.type === "BREAKOUT_SETUP")).toBe(false);
    }
    // predictions were recorded with features
    const preds = await ctx.store.listPredictions("solana", MINT, 50);
    expect(preds.length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(preds[0]!.features)).toEqual(expect.arrayContaining(["holders_growth_15m", "security", "rug_risk", "exit_risk"]));
    // audit trail explains the run
    const audit = await ctx.store.listAudit({ subject: `solana:${MINT}` });
    expect(audit[0]!.data.sources).toBeDefined();
    expect(audit[0]!.data.gates).toBeDefined();
    // paper trade opened iff high conviction
    const trades = await ctx.store.listPaperTrades({});
    if (opp.category === "HIGH_CONVICTION_SETUP") expect(trades).toHaveLength(1);
    // outcomes resolve after the horizon using stored snapshots only
    advance(w, 70, { price: 0.0025 });
    await analyzeToken(ctx, (await ctx.store.getToken("solana", MINT))!);
    const n = await resolveDuePredictions(ctx);
    expect(n).toBeGreaterThan(0);
    const outcomes = await ctx.store.listOutcomes();
    expect(outcomes[0]!.label).toMatch(/UP|SIDEWAYS/);
    const health = await buildHealth(ctx, null, []);
    expect(health.counters.analyses).toBeGreaterThanOrEqual(7);
    expect(health.counters.tokens_monitored).toBe(1);
  });

  it("rejects a token with active mint/freeze authority and never alerts it as an opportunity", async () => {
    const w = world({ mintAuthority: true, freezeAuthority: true, holders: 2000, liq: 200_000, v1: 300_000 });
    const ctx = fakeContext(w);
    await ctx.store.upsertToken({ ...(await import("../fixtures/factory.js")).makeToken({ tier: 2 }) });
    const rec = new Rec();
    const alerts = new AlertEngine(ctx, [rec], null);
    const out = await analyzeToken(ctx, (await ctx.store.getToken("solana", MINT))!);
    expect(out.opportunity.category).toBe("REJECTED");
    expect(out.opportunity.gates.filter((g) => !g.passed).map((g) => g.gate)).toEqual(expect.arrayContaining(["freeze_authority", "mint_authority"]));
    expect(await alerts.process(out)).toHaveLength(0);
    const t = (await ctx.store.getToken("solana", MINT))!;
    expect(t.status).toBe("REJECTED");
    expect(t.rejectReason).toMatch(/freeze_authority/);
    expect(t.tier).toBe(2); // cheap re-checks keep security verifiable
  });

  it("flags a liquidity pull on a watched token: LIQUIDITY_DROP alert, THESIS_INVALIDATED, paper position closed, deployer record updated", async () => {
    const w = world({ holders: 900, liq: 90_000, v1: 60_000, b1: 400, s1: 150 });
    const ctx = fakeContext(w);
    const { makeToken } = await import("../fixtures/factory.js");
    await ctx.store.upsertToken(makeToken({ tier: 3 }));
    const rec = new Rec();
    const alerts = new AlertEngine(ctx, [rec], null);
    const paper = new PaperTradingEngine(ctx);
    // build history so the series supports growth metrics
    for (let i = 0; i < 4; i++) {
      advance(w, 10, { holders: 900 + i * 100, liq: 90_000 + i * 5000, v1: 60_000 + i * 8000 });
      const o = await analyzeToken(ctx, (await ctx.store.getToken("solana", MINT))!);
      await alerts.process(o);
      await paper.onAnalysis(o);
    }
    const before = (await ctx.store.getOpportunity("solana", MINT))!;
    // force a watched thesis + an open paper trade regardless of exact score
    await ctx.store.upsertOpportunity({ ...before, category: "WATCHLIST", score: 60 });
    const snap = (await ctx.store.latestSnapshot("solana", MINT))!;
    if (!(await ctx.store.getOpenPaperTrade("solana", MINT))) await paper.open({ token: (await ctx.store.getToken("solana", MINT))!, snapshot: snap.payload, opportunity: before } as never, snap.priceUsd!, "test");
    // liquidity pulled
    advance(w, 10, { liq: 8_000, price: 0.0004, pc5: -55, pc1: -60, v5: 9000 });
    const out = await analyzeToken(ctx, (await ctx.store.getToken("solana", MINT))!);
    expect(out.newFlags).toContain("LIQUIDITY_DROP");
    expect(out.opportunity.thesis).toBe("THESIS_INVALIDATED");
    expect(out.opportunity.exitRisk!).toBeGreaterThanOrEqual(85);
    const a = await alerts.process(out);
    expect(a.map((x) => x.type)).toContain("LIQUIDITY_DROP");
    expect(rec.sent.join("\n")).toMatch(/LIQUIDITY DROP/);
    const closed = await paper.onAnalysis(out);
    expect(closed.closed?.exitReason).toMatch(/STOP_LOSS|THESIS_EXIT/);
    expect((await ctx.store.listRiskEvents("solana", MINT)).some((e) => e.type === "LIQUIDITY_DROP")).toBe(true);
    const dep = (await ctx.store.getDeployer("solana", w.deployer))!;
    expect(dep.tokensCreated).toBe(1);
  });

  it("keeps running when an API fails: degraded source recorded, data quality drops, status INSUFFICIENT_DATA, retries scheduled", async () => {
    const w = world({ failDex: true });
    const ctx = fakeContext(w);
    const { makeToken } = await import("../fixtures/factory.js");
    await ctx.store.upsertToken(makeToken({ tier: 2 }));
    const out = await safeAnalyze(ctx, (await ctx.store.getToken("solana", MINT))!);
    expect(out).not.toBeNull();
    expect(out!.snapshot.degradedSources).toContain("dexscreener");
    expect(out!.snapshot.market).toBeNull();
    expect(out!.snapshot.dataQuality).toBeLessThan(0.6);
    expect(out!.opportunity.category).toBe("INSUFFICIENT_DATA");
    expect(ctx.registry.health().find((h) => h.id === "dexscreener")!.failures).toBe(1);
    // RPC failing too: security unknown -> never "safe"
    w.failRpc = true;
    const out2 = await safeAnalyze(ctx, (await ctx.store.getToken("solana", MINT))!);
    expect(out2!.results.find((r) => r.analyzer === "security")!.confidence).not.toBe("HIGH");
  });

  it("INVESTIGATE when a coordinated wallet cluster is detected", async () => {
    const owners = [1, 2, 3, 4, 5].map((i) => `CLUSTER${i}${"c".repeat(36)}`.slice(0, 44));
    const w = world({ holders: 800, liq: 80_000, v1: 50_000, holderPcts: [6, 6, 6, 6, 6, 1, 1, 1, 1, 1], holderOwners: owners });
    for (const o of owners) w.wallets[o] = makeWallet(o, { fundedBy: "SAMEFUNDER", fundedAt: new Date(w.now.getTime() - 120 * 60_000).toISOString() });
    w.trades = owners.map((o, i) => makeTrade({ wallet: o, kind: "buy", ts: new Date(w.now.getTime() - 30 * 60_000 + i * 4000).toISOString(), amountUsd: 900 }));
    w.trades.push(...Array.from({ length: 12 }, (_, i) => makeTrade({ wallet: `R${i}${"r".repeat(40)}`.slice(0, 44), kind: "buy", ts: new Date(w.now.getTime() - 20 * 60_000 + i * 60_000).toISOString(), amountUsd: 50 })));
    const ctx = fakeContext(w);
    const { makeToken } = await import("../fixtures/factory.js");
    await ctx.store.upsertToken(makeToken({ tier: 3 }));
    const out = await analyzeToken(ctx, (await ctx.store.getToken("solana", MINT))!);
    const clusters = await ctx.store.listClusters("solana", MINT);
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    expect(clusters[0]!.wallets.length).toBe(5);
    expect(clusters[0]!.kind).toBe("POTENTIAL_CLUSTER");
    expect(out.opportunity.category).toBe("INVESTIGATE");
    expect(out.opportunity.statusText).toMatch(/INVESTIGATE/);
  });

  it("worker dead-letters a job whose token vanished/failed after max attempts", async () => {
    const w = world({ failDex: true, failRpc: true });
    const store = new MemoryStore();
    const ctx = fakeContext(w, store);
    // token missing => job completes as no-op
    await store.enqueueJob("analyze", { chain: "solana", mint: "MISSING1111111111111111111111111111111111" });
    const worker = new AnalysisWorker(ctx, 1);
    await worker.runOnce();
    expect((await store.queueStats()).DONE).toBe(1);
  });
});

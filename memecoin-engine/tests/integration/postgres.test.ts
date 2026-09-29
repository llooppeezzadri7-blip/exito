import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgresStore } from "../../src/db/postgres-store.js";
import { makeToken, makeSnapshot, toRecord, at } from "../fixtures/factory.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("postgres store (TEST_DATABASE_URL)", () => {
  let store: PostgresStore;
  beforeAll(async () => {
    store = new PostgresStore(url!, { max: 3 });
    await store.init();
    await store.pool.query("TRUNCATE tokens, token_snapshots, liquidity_snapshots, holder_snapshots, pools, holders, transactions, wallets, wallet_clusters, deployers, social_mentions, social_snapshots, narratives, risk_events, alerts, opportunities, predictions, feature_values, outcomes, paper_trades, model_versions, audit_logs, jobs, health_snapshots RESTART IDENTITY CASCADE");
  });
  afterAll(async () => {
    await store.close();
  });
  it("migrations are idempotent", async () => {
    await expect(store.init()).resolves.toBeUndefined();
  });
  it("token upsert/patch/list/due roundtrip", async () => {
    await store.upsertToken(makeToken({ discoverySources: ["a"] }));
    await store.upsertToken(makeToken({ discoverySources: ["b"] }));
    const t = (await store.getToken("solana", makeToken().mint))!;
    expect(t.discoverySources.sort()).toEqual(["a", "b"]);
    await store.patchToken(t.chain, t.mint, { lastScore: 77, category: "WATCHLIST", tier: 3 });
    expect((await store.listTokens({ minScore: 70 }))[0]!.tier).toBe(3);
    expect((await store.listDueTokens(at(1), 10)).length).toBe(1);
    expect((await store.countTokens()).WATCHLIST).toBe(1);
  });
  it("snapshots write the denormalized series and support metric samples + retention", async () => {
    const id = await store.insertSnapshot(toRecord(makeSnapshot()));
    expect(id).toBeGreaterThan(0);
    const l = await store.listSnapshots("solana", makeToken().mint, null, 10);
    expect(l).toHaveLength(1);
    expect(l[0]!.payload.market!.liquidityUsd.value).toBe(50000);
    expect((await store.sampleMetric("liquidityUsd", 10))[0]).toBe(50000);
    const liq = await store.pool.query("SELECT count(*)::int n FROM liquidity_snapshots");
    expect(liq.rows[0].n).toBe(1);
    expect(await store.pruneSnapshots(at(100))).toBe(1);
  });
  it("jobs: claim with SKIP LOCKED, retry, dead-letter", async () => {
    const id = (await store.enqueueJob("analyze", { mint: "x" }, { dedupeKey: "analyze:x", maxAttempts: 1 }))!;
    expect(await store.enqueueJob("analyze", { mint: "x" }, { dedupeKey: "analyze:x" })).toBeNull();
    const c = await store.claimJobs("analyze", new Date().toISOString(), 5);
    expect(c[0]!.id).toBe(id);
    await store.failJob(id, "err", new Date(Date.now() + 1000).toISOString());
    expect((await store.queueStats()).DEAD).toBe(1);
    await store.requeueDeadJob(id);
    expect((await store.queueStats()).PENDING).toBe(1);
  });
  it("predictions + outcomes + feature_values + models", async () => {
    await store.insertPrediction({ id: "p1", chain: "solana", mint: "m", madeAt: at(0), horizonHours: 1, resolveAt: at(60), category: "WATCHLIST", score: 55, confidence: "LOW", features: { a: 1, b: null }, priceAt: 1, marketCapAt: null, liquidityAt: null, modelVersion: "rule-v1", resolved: false });
    expect((await store.listDuePredictions(at(61), 10))).toHaveLength(1);
    await store.insertOutcome({ predictionId: "p1", chain: "solana", mint: "m", horizonHours: 1, priceAt: 1, priceAfter: 2, returnPct: 100, maxReturnPct: 100, minReturnPct: 0, liquidityAt: null, liquidityAfter: null, label: "BIG_UP", resolvedAt: at(61) });
    await store.markPredictionResolved("p1");
    const pw = await store.listPredictionsWithOutcomes(10);
    expect(pw[0]!.prediction.features.a).toBe(1);
    const fv = await store.pool.query("SELECT count(*)::int n FROM feature_values");
    expect(fv.rows[0].n).toBe(2);
    await store.insertModelVersion({ version: "v1", kind: "STATISTICAL", weights: { early_momentum: 20 }, metrics: {}, notes: "", active: true, createdAt: at(0) });
    expect((await store.getActiveModel("STATISTICAL"))!.version).toBe("v1");
  });
  it("alerts, risk events, audit, health, paper trades", async () => {
    await store.insertAlert({ id: "a1", chain: "solana", mint: "m", type: "NEW_HIGH_POTENTIAL", severity: "INFO", title: "t", body: "b", payload: {}, channels: ["telegram"], deliveredTo: [], createdAt: at(0), sentAt: null, error: null });
    await store.patchAlert("a1", { deliveredTo: ["telegram"], sentAt: at(1) });
    expect((await store.lastAlert("solana", "m", "NEW_HIGH_POTENTIAL"))!.deliveredTo).toEqual(["telegram"]);
    await store.insertRiskEvent({ chain: "solana", mint: "m", type: "LIQUIDITY_DROP", severity: "CRITICAL", message: "x", data: {}, at: at(0) });
    expect((await store.listRecentRiskEvents(at(-1)))).toHaveLength(1);
    await store.insertAudit({ at: at(0), actor: "engine", action: "analyze", subject: "solana:m", data: { score: 1 } });
    expect((await store.listAudit({ subject: "solana:m" }))[0]!.data.score).toBe(1);
    await store.saveHealth({ at: at(0), providers: [], queue: {}, counters: {}, workers: {}, dataLatencySec: 1, errorRate: 0 });
    expect((await store.latestHealth())!.dataLatencySec).toBe(1);
    await store.insertPaperTrade({ id: "t1", chain: "solana", mint: "m", symbol: "S", openedAt: at(0), closedAt: null, entryPriceUsd: 1, entryFillPriceUsd: 1.02, sizeUsd: 20, tokens: 19, feesUsd: 0.1, slippagePct: 2, exitPriceUsd: null, exitFillPriceUsd: null, pnlUsd: null, pnlPct: null, peakPriceUsd: 1, troughPriceUsd: 1, maxDrawdownPct: 0, reason: "r", exitReason: null, scoreAtEntry: 80, opportunityCategory: "HIGH_CONVICTION_SETUP", status: "OPEN" });
    expect((await store.getOpenPaperTrade("solana", "m"))!.id).toBe("t1");
    await store.patchPaperTrade("t1", { status: "CLOSED", pnlPct: 10, closedAt: at(5), exitReason: "TAKE_PROFIT" });
    expect((await store.listPaperTrades({ status: "CLOSED" }))[0]!.pnlPct).toBe(10);
  });
});

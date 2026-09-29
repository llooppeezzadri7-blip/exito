import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import type { EngineContext } from "../pipeline/context.js";
import type { Scheduler } from "../monitor/scheduler.js";
import type { AnalysisWorker } from "../monitor/worker.js";
import type { DiscoveryStream } from "../providers/types.js";
import type { PaperTradingEngine } from "../paper/engine.js";
import { buildHealth } from "../monitor/health.js";
import { paperStats, PaperTradingEngine as PaperEngineClass } from "../paper/engine.js";
import { analyzeToken } from "../pipeline/analyze-token.js";
import { findSimilarPatterns, describeSimilar } from "../learning/comparison.js";
import { learnFromOutcomes } from "../learning/statistical.js";
import { env } from "../config/env.js";
import { errMessage } from "../core/errors.js";
import type { Chain } from "../core/types.js";

export interface ApiDeps {
  ctx: EngineContext;
  scheduler: Scheduler | null;
  worker: AnalysisWorker | null;
  streams: DiscoveryStream[];
  paper: PaperTradingEngine | null;
}

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Read-mostly JSON API + static dashboard. Optional bearer token (API_AUTH_TOKEN).
 * Mutations are limited to human-in-the-loop actions: watch / ignore / paper trade / re-analyze / activate model.
 * Nothing here can move funds — there is no wallet in the system.
 */
export async function startApi(deps: ApiDeps, opts: { port: number; host: string }) {
  const { ctx } = deps;
  const app = Fastify({ logger: false, trustProxy: true });
  const here = path.dirname(new URL(import.meta.url).pathname);
  const publicDir = [path.resolve(here, "../dashboard/public"), path.resolve(here, "../../src/dashboard/public")].find((p) => fs.existsSync(p))!;
  await app.register(fastifyStatic, { root: publicDir, prefix: "/" });

  app.addHook("onRequest", async (req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    if (env.API_AUTH_TOKEN && req.url.startsWith("/api/")) {
      const auth = req.headers.authorization ?? "";
      const q = (req.query as Record<string, string>)?.token;
      if (auth !== `Bearer ${env.API_AUTH_TOKEN}` && q !== env.API_AUTH_TOKEN) return reply.code(401).send({ error: "unauthorized" });
    }
  });
  const chainOf = (q: Record<string, string | undefined>): Chain => ((q.chain as Chain) ?? "solana");

  app.get("/api/health", async () => buildHealth(ctx, deps.scheduler, deps.streams, { workerInFlight: deps.worker?.inFlight ?? null }));
  app.get("/api/config", async () => ({ ...ctx.cfg, note: "secrets are never exposed; env-only values omitted" }));
  app.get("/api/providers", async () => ctx.registry.health());
  app.get("/api/stats", async () => {
    const tokens = await ctx.store.countTokens();
    const total = tokens.total ?? 0;
    const high = tokens.HIGH_CONVICTION_SETUP ?? 0;
    const watch = tokens.WATCHLIST ?? 0;
    return { scanning: total, highQuality: high, watchlist: watch, rejected: tokens.REJECTED ?? 0, noTradePct: total ? Math.round(((total - high - watch) / total) * 1000) / 10 : null, ...tokens };
  });
  app.get("/api/tokens", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const cats = q.category ? q.category.split(",") : undefined;
    const statuses = q.status ? q.status.split(",") : undefined;
    const tokens = await ctx.store.listTokens({ chain: q.chain as Chain | undefined, status: statuses as never, category: cats as never, minScore: q.minScore ? Number(q.minScore) : undefined, maxAgeMinutes: q.maxAgeMinutes ? Number(q.maxAgeMinutes) : undefined, limit: Math.min(500, Number(q.limit ?? 100)), orderBy: (q.orderBy as never) ?? "score" });
    const out = [];
    for (const t of tokens) {
      const [snap, opp] = await Promise.all([ctx.store.latestSnapshot(t.chain, t.mint), ctx.store.getOpportunity(t.chain, t.mint)]);
      const minL = q.minLiquidity ? Number(q.minLiquidity) : null;
      if (minL !== null && (snap?.liquidityUsd ?? 0) < minL) continue;
      if (q.risk && opp?.risk !== q.risk) continue;
      if (q.phase && opp?.phase !== q.phase) continue;
      out.push({ ...t, snapshot: snap ? { observedAt: snap.observedAt, priceUsd: snap.priceUsd, marketCapUsd: snap.marketCapUsd, liquidityUsd: snap.liquidityUsd, volumeH1Usd: snap.volumeH1Usd, holders: snap.holders, dataQuality: snap.dataQuality, sources: snap.sources } : null, opportunity: opp ? { score: opp.score, category: opp.category, confidence: opp.confidence, phase: opp.phase, risk: opp.risk, rugRisk: opp.rugRisk, exitRisk: opp.exitRisk, thesis: opp.thesis, statusText: opp.statusText, subscores: opp.subscores } : null });
    }
    return out;
  });
  app.get("/api/opportunities", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const opps = await ctx.store.listOpportunities({ categories: q.category ? q.category.split(",") : ["HIGH_CONVICTION_SETUP", "WATCHLIST", "EXTREME_RISK"], minScore: q.minScore ? Number(q.minScore) : undefined, limit: Number(q.limit ?? 30) });
    const out = [];
    for (const o of opps) {
      const [t, s] = await Promise.all([ctx.store.getToken(o.chain, o.mint), ctx.store.latestSnapshot(o.chain, o.mint)]);
      out.push({ ...o, token: t, snapshot: s ? { observedAt: s.observedAt, priceUsd: s.priceUsd, marketCapUsd: s.marketCapUsd, liquidityUsd: s.liquidityUsd, volumeH1Usd: s.volumeH1Usd, holders: s.holders, dataQuality: s.dataQuality, sources: s.sources } : null });
    }
    return { generatedAt: ctx.now().toISOString(), noOpportunity: out.filter((o) => o.category === "HIGH_CONVICTION_SETUP" || o.category === "WATCHLIST").length === 0, items: out };
  });
  app.get("/api/alerts", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return ctx.store.listAlerts({ chain: q.chain as Chain | undefined, mint: q.mint, sinceIso: q.since, limit: Number(q.limit ?? 100) });
  });
  app.get("/api/risk-events", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return ctx.store.listRecentRiskEvents(q.since ?? new Date(ctx.now().getTime() - 86_400_000).toISOString(), Number(q.limit ?? 100));
  });
  app.get("/api/narratives", async () => ctx.store.listNarratives());
  app.get("/api/paper", async () => {
    const trades = await ctx.store.listPaperTrades({ limit: 1000 });
    return { stats: paperStats(trades, ctx.cfg.paper_trading.bankroll_usd), trades: trades.slice(0, 200) };
  });
  app.get("/api/learning", async () => {
    const pairs = await ctx.store.listPredictionsWithOutcomes(20_000);
    return { report: learnFromOutcomes(pairs, ctx.cfg.scoring.weights, ctx.cfg.learning.min_samples_for_stats), models: await ctx.store.listModelVersions() };
  });
  app.get("/api/audit", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return ctx.store.listAudit({ subject: q.subject, limit: Number(q.limit ?? 100) });
  });
  app.get("/api/queue/dead", async () => ctx.store.listDeadJobs(100));

  app.get("/api/tokens/:mint", async (req, reply) => {
    const { mint } = req.params as { mint: string };
    const q = req.query as Record<string, string | undefined>;
    if (!MINT.test(mint)) return reply.code(400).send({ error: "invalid mint" });
    const chain = chainOf(q);
    const token = await ctx.store.getToken(chain, mint);
    if (!token) return reply.code(404).send({ error: "not found" });
    const since = new Date(ctx.now().getTime() - 48 * 3_600_000).toISOString();
    const [series, holders, clusters, opportunity, alerts, predictions, riskEvents, trades, pools, audit, latest] = await Promise.all([
      ctx.store.listSnapshots(chain, mint, since, 600), ctx.store.listHolders(chain, mint), ctx.store.listClusters(chain, mint), ctx.store.getOpportunity(chain, mint),
      ctx.store.listAlerts({ chain, mint, limit: 50 }), ctx.store.listPredictions(chain, mint, 50), ctx.store.listRiskEvents(chain, mint, 50), ctx.store.listTrades(chain, mint, since, 300), ctx.store.listPools(chain, mint), ctx.store.listAudit({ subject: `${chain}:${mint}`, limit: 30 }), ctx.store.latestSnapshot(chain, mint),
    ]);
    const outcomes = (await ctx.store.listOutcomes(5000)).filter((o) => o.mint === mint);
    const hist = (await ctx.store.listPredictionsWithOutcomes(5000)).map((p) => ({ ...p, tokenAgeHours: null as number | null }));
    const features = latest ? { ...(opportunity?.subscores ?? {}), market_cap_usd: latest.marketCapUsd, liquidity_usd: latest.liquidityUsd, holders: latest.holders, top10_pct: latest.top10Pct, liquidity_to_marketcap: latest.liquidityUsd && latest.marketCapUsd ? latest.liquidityUsd / latest.marketCapUsd : null } : {};
    const similar = findSimilarPatterns(features as Record<string, number | null>, hist, 5, mint);
    const deployer = token.deployer ? await ctx.store.getDeployer(chain, token.deployer) : null;
    const socialSeries = await ctx.store.listSocialSnapshots(chain, mint, since, 200);
    return {
      token, latest, opportunity, deployer, holders, clusters, pools, alerts, predictions, outcomes, riskEvents, trades, audit, socialSeries,
      series: series.map((s) => ({ t: s.observedAt, price: s.priceUsd, mc: s.marketCapUsd, liq: s.liquidityUsd, vol1h: s.volumeH1Usd, holders: s.holders, buys1h: s.buysH1, sells1h: s.sellsH1, dq: s.dataQuality })),
      similar: { items: similar, text: describeSimilar(similar) },
      candles: latest?.payload.candles ?? [],
      security: latest?.payload.security ?? null,
      securityReport: latest?.payload.securityReport ? { ...latest.payload.securityReport, topHolders: undefined } : null,
      social: latest?.payload.social ?? null,
    };
  });

  // ---- human-in-the-loop actions ----
  app.post("/api/tokens/:mint/analyze", async (req, reply) => {
    const { mint } = req.params as { mint: string };
    if (!MINT.test(mint)) return reply.code(400).send({ error: "invalid mint" });
    const chain = chainOf(req.query as Record<string, string | undefined>);
    let token = await ctx.store.getToken(chain, mint);
    if (!token) {
      const now = ctx.now().toISOString();
      token = { chain, mint, symbol: null, name: null, createdAt: null, discoveredAt: now, discoverySources: ["manual"], pairAddress: null, deployer: null, tier: 3, status: "NEW", rejectReason: null, category: null, lastScore: null, lastRisk: null, lastAnalyzedAt: null, nextAnalyzeAt: now, cyclesBelowTier: 0, updatedAt: now };
      await ctx.store.upsertToken(token);
    }
    try {
      const out = await analyzeToken(ctx, { ...token, tier: Math.max(token.tier, 3) as 3 | 4 });
      await ctx.store.insertAudit({ at: ctx.now().toISOString(), actor: "user", action: "manual_analyze", subject: `${chain}:${mint}`, data: { score: out.opportunity.score, category: out.opportunity.category } });
      return { ok: true, opportunity: out.opportunity };
    } catch (e) {
      return reply.code(500).send({ error: errMessage(e) });
    }
  });
  app.post("/api/tokens/:mint/watch", async (req, reply) => {
    const { mint } = req.params as { mint: string };
    if (!MINT.test(mint)) return reply.code(400).send({ error: "invalid mint" });
    const chain = chainOf(req.query as Record<string, string | undefined>);
    await ctx.store.patchToken(chain, mint, { tier: 4, status: "MONITORED", nextAnalyzeAt: ctx.now().toISOString() });
    await ctx.store.insertAudit({ at: ctx.now().toISOString(), actor: "user", action: "watch", subject: `${chain}:${mint}`, data: {} });
    return { ok: true };
  });
  app.post("/api/tokens/:mint/ignore", async (req, reply) => {
    const { mint } = req.params as { mint: string };
    if (!MINT.test(mint)) return reply.code(400).send({ error: "invalid mint" });
    const chain = chainOf(req.query as Record<string, string | undefined>);
    await ctx.store.patchToken(chain, mint, { status: "ARCHIVED", nextAnalyzeAt: null, rejectReason: "ignored by user" });
    await ctx.store.insertAudit({ at: ctx.now().toISOString(), actor: "user", action: "ignore", subject: `${chain}:${mint}`, data: {} });
    return { ok: true };
  });
  app.post("/api/tokens/:mint/paper-trade", async (req, reply) => {
    const { mint } = req.params as { mint: string };
    if (!MINT.test(mint)) return reply.code(400).send({ error: "invalid mint" });
    const chain = chainOf(req.query as Record<string, string | undefined>);
    const token = await ctx.store.getToken(chain, mint);
    const snap = await ctx.store.latestSnapshot(chain, mint);
    const opp = await ctx.store.getOpportunity(chain, mint);
    if (!token || !snap || !opp || snap.priceUsd === null) return reply.code(400).send({ error: "token not analyzed yet" });
    if (await ctx.store.getOpenPaperTrade(chain, mint)) return reply.code(409).send({ error: "paper trade already open" });
    const engine = deps.paper ?? new PaperEngineClass(ctx);
    const t = await engine.open({ token, snapshot: snap.payload, snapshotId: snap.id ?? null, opportunity: opp } as never, snap.priceUsd, "manual paper trade (user)");
    return { ok: true, trade: t };
  });
  app.post("/api/paper/:id/close", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = (await ctx.store.listPaperTrades({ status: "OPEN" })).find((x) => x.id === id);
    if (!t) return reply.code(404).send({ error: "not found" });
    const snap = await ctx.store.latestSnapshot(t.chain, t.mint);
    if (!snap?.priceUsd) return reply.code(400).send({ error: "no price" });
    const engine = deps.paper ?? new PaperEngineClass(ctx);
    return { ok: true, trade: await engine.close(t, snap.priceUsd, "MANUAL") };
  });
  app.post("/api/learning/activate", async (req, reply) => {
    const { version } = (req.body ?? {}) as { version?: string };
    const models = await ctx.store.listModelVersions();
    const m = models.find((x) => x.version === version);
    if (!m) return reply.code(404).send({ error: "model version not found" });
    await ctx.store.insertModelVersion({ ...m, active: true });
    await ctx.store.insertAudit({ at: ctx.now().toISOString(), actor: "user", action: "activate_model", subject: version!, data: { weights: m.weights } });
    return { ok: true, note: "positive weights only; restart workers to load" };
  });
  app.post("/api/queue/dead/:id/requeue", async (req) => {
    await ctx.store.requeueDeadJob(Number((req.params as { id: string }).id));
    return { ok: true };
  });

  await app.listen({ port: opts.port, host: opts.host });
  ctx.log.info({ port: opts.port, host: opts.host }, "API + dashboard listening");
  return app;
}

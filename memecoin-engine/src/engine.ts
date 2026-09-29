import { loadConfig, type EngineConfig } from "./config/index.js";
import { env, has } from "./config/env.js";
import { logger } from "./core/logger.js";
import { createStore, type Store } from "./db/index.js";
import { ProviderRegistry } from "./providers/registry.js";
import { SolanaRpcProvider } from "./providers/solana/rpc-provider.js";
import { DexScreenerProvider } from "./providers/dexscreener/provider.js";
import { GeckoTerminalProvider } from "./providers/geckoterminal/provider.js";
import { RugCheckProvider } from "./providers/rugcheck/provider.js";
import { PumpPortalStream } from "./providers/pumpportal/stream.js";
import { RedditSocialProvider } from "./providers/social/reddit.js";
import { TelegramSocialProvider } from "./providers/social/telegram.js";
import { NullNewsProvider } from "./providers/social/null-providers.js";
import type { EngineContext } from "./pipeline/context.js";
import { DiscoveryEngine } from "./discovery/engine.js";
import { Scheduler } from "./monitor/scheduler.js";
import { AnalysisWorker, enqueueDueTokens } from "./monitor/worker.js";
import { buildHealth } from "./monitor/health.js";
import { AlertEngine } from "./alerts/engine.js";
import { DashboardChannel, DiscordChannel, TelegramChannel, type AlertChannel } from "./alerts/channels.js";
import { PaperTradingEngine } from "./paper/engine.js";
import { resolveDuePredictions } from "./learning/outcomes.js";
import { aggregateNarratives } from "./analyzers/narrative.js";
import { learnFromOutcomes, toModelVersion } from "./learning/statistical.js";
import type { DiscoveryStream } from "./providers/types.js";

export interface Engine {
  ctx: EngineContext;
  scheduler: Scheduler;
  worker: AnalysisWorker;
  discovery: DiscoveryEngine;
  alerts: AlertEngine;
  paper: PaperTradingEngine;
  streams: DiscoveryStream[];
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function buildRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  const rpcUrl = env.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}` : env.SOLANA_RPC_URL;
  // Helius (when configured) is just a faster Solana RPC for the same read-only methods; registered under its own id for the tier lists.
  if (env.HELIUS_API_KEY) registry.register(Object.assign(new SolanaRpcProvider(rpcUrl, { requestsPerSecond: 40 }), { id: "helius" }) as SolanaRpcProvider);
  registry.register(new SolanaRpcProvider(env.SOLANA_RPC_URL, { requestsPerSecond: 8, wsUrl: env.SOLANA_RPC_WS_URL }));
  const dex = new DexScreenerProvider(env.DEXSCREENER_BASE_URL);
  registry.register(dex);
  registry.register(dex.asMarketData() as never);
  registry.register(new GeckoTerminalProvider(env.GECKOTERMINAL_BASE_URL));
  registry.register(new RugCheckProvider(env.RUGCHECK_BASE_URL));
  registry.register(new RedditSocialProvider(env.REDDIT_ENABLED !== "0"));
  registry.register(new TelegramSocialProvider(env.TELEGRAM_BOT_TOKEN));
  registry.register(new NullNewsProvider());
  return registry;
}

export function buildContext(opts: { cfg?: EngineConfig; store?: Store; registry?: ProviderRegistry } = {}): EngineContext {
  return { cfg: opts.cfg ?? loadConfig(), store: opts.store ?? createStore(), registry: opts.registry ?? buildRegistry(), log: logger, now: () => new Date(), counters: {} };
}

export function buildChannels(cfg: EngineConfig): AlertChannel[] {
  const channels: AlertChannel[] = [];
  if (cfg.alerts.channels.telegram && has.telegram) channels.push(new TelegramChannel(env.TELEGRAM_BOT_TOKEN!, env.TELEGRAM_CHAT_ID!));
  if (cfg.alerts.channels.discord && has.discord) channels.push(new DiscordChannel(env.DISCORD_WEBHOOK_URL!));
  if (cfg.alerts.channels.dashboard) channels.push(new DashboardChannel());
  return channels;
}

export function createEngine(ctx: EngineContext = buildContext()): Engine {
  const { cfg, store, log } = ctx;
  const scheduler = new Scheduler();
  const worker = new AnalysisWorker(ctx, cfg.monitor.worker_concurrency);
  const discovery = new DiscoveryEngine(ctx);
  const alerts = new AlertEngine(ctx, buildChannels(cfg), process.env.DASHBOARD_URL ?? null);
  const paper = new PaperTradingEngine(ctx);
  const streams: DiscoveryStream[] = [];
  if (cfg.discovery.sources.pumpportal_ws) streams.push(new PumpPortalStream(env.PUMPPORTAL_WS_URL));

  worker.onAnalysis(async (out) => {
    await alerts.process(out);
  });
  worker.onAnalysis(async (out) => {
    await paper.onAnalysis(out);
  });

  let learnedWeights: Record<string, number> | null = null;

  return {
    ctx, scheduler, worker, discovery, alerts, paper, streams,
    async start() {
      await store.init();
      const active = await store.getActiveModel("STATISTICAL");
      if (active) {
        learnedWeights = active.weights;
        log.info({ version: active.version }, "active statistical model loaded (positive weights only)");
      }
      for (const s of streams) await s.start((t) => discovery.onStreamToken(t));
      scheduler.add("discovery", cfg.discovery.poll_interval_sec * 1000, () => discovery.runCycle().then(() => undefined), { runImmediately: true });
      scheduler.add("enqueue", 15_000, () => enqueueDueTokens(ctx).then(() => undefined), { runImmediately: true });
      scheduler.add("workers", 3_000, () => worker.runOnce().then(() => undefined), { runImmediately: true });
      scheduler.add("outcomes", cfg.monitor.outcome_resolver_interval_sec * 1000, () => resolveDuePredictions(ctx).then(() => undefined));
      scheduler.add("narratives", 10 * 60_000, async () => {
        const tokens = await store.listTokens({ orderBy: "discoveredAt", limit: 5000 });
        const recs = aggregateNarratives(tokens, await store.listNarratives(), ctx.now());
        for (const r of recs) await store.upsertNarrative(r);
      }, { runImmediately: true });
      scheduler.add("learning", 6 * 3_600_000, async () => {
        const pairs = await store.listPredictionsWithOutcomes(20_000);
        const report = learnFromOutcomes(pairs, cfg.scoring.weights, cfg.learning.min_samples_for_stats, 4);
        const mv = toModelVersion(report, `stat-${ctx.now().toISOString().slice(0, 13)}`, ctx.now().toISOString());
        if (mv) {
          await store.insertModelVersion(mv);
          log.info({ version: mv.version, samples: report.samples }, "statistical model proposal stored (inactive until activated via API/tool)");
        }
      });
      scheduler.add("health", cfg.monitor.health_interval_sec * 1000, async () => {
        const h = await buildHealth(ctx, scheduler, streams, { learnedWeights: learnedWeights !== null });
        await store.saveHealth(h);
        const deg = ctx.registry.degradedIds();
        if (deg.length) log.warn({ degraded: deg }, "DATA_SOURCE_DEGRADED");
      }, { runImmediately: true });
      scheduler.add("retention", 6 * 3_600_000, async () => {
        const n = await store.pruneSnapshots(new Date(ctx.now().getTime() - cfg.monitor.snapshot_retention_days * 86_400_000).toISOString());
        if (n) log.info({ pruned: n }, "snapshot retention");
      });
      log.info({ mode: cfg.engine.mode, chains: cfg.engine.chains, providers: ctx.registry.list().map((p) => p.id) }, "MEMECOIN INTELLIGENCE ENGINE started (read-only, paper trading only)");
    },
    async stop() {
      await scheduler.stop();
      for (const s of streams) await s.stop();
      await store.close();
    },
  };
}

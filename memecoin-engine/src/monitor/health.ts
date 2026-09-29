import type { EngineContext } from "../pipeline/context.js";
import type { Scheduler } from "./scheduler.js";
import type { HealthRecord } from "../db/records.js";
import type { DiscoveryStream } from "../providers/types.js";

/** Builds the OBSERVABILITY snapshot: API/RPC/DB/worker/queue status, latency, error rate, counters. */
export async function buildHealth(ctx: EngineContext, scheduler: Scheduler | null, streams: DiscoveryStream[], extra: Record<string, unknown> = {}): Promise<HealthRecord> {
  const providers = ctx.registry.health();
  const queue = await ctx.store.queueStats();
  const tokens = await ctx.store.countTokens();
  const loops = scheduler?.status() ?? [];
  const totalCalls = providers.reduce((a, p) => a + p.successes + p.failures, 0);
  const totalErr = providers.reduce((a, p) => a + p.failures, 0);
  const latest = loops.find((l) => l.name === "workers")?.lastRunAt ?? null;
  const dataLatencySec = latest ? Math.round((ctx.now().getTime() - new Date(latest).getTime()) / 1000) : null;
  let dbOk = true;
  try {
    await ctx.store.countTokens();
  } catch {
    dbOk = false;
  }
  const alerts24h = (await ctx.store.listAlerts({ sinceIso: new Date(ctx.now().getTime() - 86_400_000).toISOString(), limit: 1000 })).length;
  return {
    at: ctx.now().toISOString(),
    providers: providers.map((p) => ({ ...p })),
    queue,
    counters: { ...ctx.counters, tokens_total: tokens.total ?? 0, tokens_monitored: tokens.MONITORED ?? 0, tokens_rejected: tokens.REJECTED ?? 0, tokens_new: tokens.NEW ?? 0, tokens_archived: tokens.ARCHIVED ?? 0, tier1: tokens.tier1 ?? 0, tier2: tokens.tier2 ?? 0, tier3: tokens.tier3 ?? 0, tier4: tokens.tier4 ?? 0, high_conviction: tokens.HIGH_CONVICTION_SETUP ?? 0, watchlist: tokens.WATCHLIST ?? 0, alerts_24h: alerts24h },
    workers: { loops, streams: streams.map((s) => ({ id: s.id, running: s.isRunning() })), db: dbOk ? "OK" : "DOWN", ...extra },
    dataLatencySec,
    errorRate: totalCalls ? Math.round((totalErr / totalCalls) * 1000) / 1000 : null,
  };
}

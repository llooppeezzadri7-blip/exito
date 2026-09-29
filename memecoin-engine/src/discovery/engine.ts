import type { DiscoveredToken } from "../core/model.js";
import type { DEXProvider, MarketDataProvider, SecurityProvider } from "../providers/types.js";
import type { EngineContext } from "../pipeline/context.js";
import { bump } from "../pipeline/context.js";
import type { TokenRecord } from "../db/records.js";
import { errMessage } from "../core/errors.js";
import { ageMinutes } from "../core/time.js";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * DISCOVERY ENGINE: merges candidates from every configured source (polling + streaming),
 * de-duplicates by (chain, mint), applies age filters and registers new tokens as TIER 1 (NEW).
 * Sources are hints only — nothing about a source implies quality.
 */
export class DiscoveryEngine {
  private pendingStream = new Map<string, DiscoveredToken>();
  public lastRunAt: string | null = null;
  public lastFound = 0;

  constructor(private readonly ctx: EngineContext) {}

  /** Called by streaming sources (websocket). Buffered until the next cycle. */
  onStreamToken(t: DiscoveredToken): void {
    if (!BASE58.test(t.mint)) return;
    this.pendingStream.set(`${t.chain}:${t.mint}`, t);
    bump(this.ctx, "discovery_stream_events");
  }

  async runCycle(): Promise<{ found: number; registered: number }> {
    const { registry, cfg, log } = this.ctx;
    const candidates = new Map<string, DiscoveredToken>();
    const add = (t: DiscoveredToken) => {
      if (!BASE58.test(t.mint)) return;
      const key = `${t.chain}:${t.mint}`;
      const prev = candidates.get(key);
      if (!prev) candidates.set(key, { ...t, source: t.source });
      else candidates.set(key, { ...prev, symbol: prev.symbol ?? t.symbol, name: prev.name ?? t.name, pairAddress: prev.pairAddress ?? t.pairAddress, createdAt: prev.createdAt ?? t.createdAt, liquidityUsd: prev.liquidityUsd ?? t.liquidityUsd, volumeH1Usd: prev.volumeH1Usd ?? t.volumeH1Usd, source: `${prev.source},${t.source}`, raw: prev.raw ?? t.raw });
    };
    for (const t of this.pendingStream.values()) add(t);
    this.pendingStream.clear();
    for (const chain of cfg.engine.chains) {
      if (cfg.discovery.sources.geckoterminal_new_pools) {
        const gt = registry.get<DEXProvider>("geckoterminal");
        if (gt) await this.safely("geckoterminal", () => gt.getNewPools(chain), add);
      }
      if (cfg.discovery.sources.dexscreener_profiles || cfg.discovery.sources.dexscreener_boosts) {
        const ds = registry.get<MarketDataProvider>("dexscreener-feeds");
        if (ds) await this.safely("dexscreener-feeds", () => ds.getTrendingFeeds(chain), add);
      }
      if (cfg.discovery.sources.rugcheck_new_tokens) {
        const rc = registry.get<SecurityProvider>("rugcheck");
        if (rc?.getNewTokens) await this.safely("rugcheck", () => rc.getNewTokens!(chain), add);
      }
    }
    let registered = 0;
    const now = this.ctx.now();
    let n = 0;
    for (const t of candidates.values()) {
      if (n++ >= cfg.discovery.max_new_tokens_per_cycle) break;
      const age = ageMinutes(t.createdAt, now);
      if (age !== null && (age < cfg.discovery.min_age_minutes || age > cfg.discovery.max_age_minutes)) continue;
      const existing = await this.ctx.store.getToken(t.chain, t.mint);
      if (existing) {
        const srcs = t.source.split(",").filter((s) => !existing.discoverySources.includes(s));
        if (srcs.length) await this.ctx.store.patchToken(t.chain, t.mint, { discoverySources: [...existing.discoverySources, ...srcs], pairAddress: existing.pairAddress ?? t.pairAddress, createdAt: existing.createdAt ?? t.createdAt });
        continue;
      }
      const rec: TokenRecord = {
        chain: t.chain,
        mint: t.mint,
        symbol: t.symbol,
        name: t.name,
        createdAt: t.createdAt,
        discoveredAt: now.toISOString(),
        discoverySources: t.source.split(","),
        pairAddress: t.pairAddress,
        deployer: (t.raw as { deployer?: string } | undefined)?.deployer ?? null,
        tier: 1,
        status: "NEW",
        rejectReason: null,
        category: null,
        lastScore: null,
        lastRisk: null,
        lastAnalyzedAt: null,
        nextAnalyzeAt: now.toISOString(),
        cyclesBelowTier: 0,
        updatedAt: now.toISOString(),
      };
      await this.ctx.store.upsertToken(rec);
      await this.ctx.store.enqueueJob("analyze", { chain: t.chain, mint: t.mint, raw: t.raw ?? null }, { dedupeKey: `analyze:${t.chain}:${t.mint}`, maxAttempts: cfg.monitor.queue_max_attempts });
      registered++;
    }
    bump(this.ctx, "tokens_discovered", registered);
    this.lastRunAt = now.toISOString();
    this.lastFound = candidates.size;
    log.info({ candidates: candidates.size, registered }, "discovery cycle");
    return { found: candidates.size, registered };
  }

  private async safely(source: string, fn: () => Promise<DiscoveredToken[]>, add: (t: DiscoveredToken) => void): Promise<void> {
    try {
      const list = await fn();
      list.forEach(add);
      bump(this.ctx, `discovery_${source}`, list.length);
    } catch (e) {
      this.ctx.log.warn({ source, err: errMessage(e) }, "discovery source failed (continuing with others)");
      bump(this.ctx, "discovery_source_failures");
    }
  }
}

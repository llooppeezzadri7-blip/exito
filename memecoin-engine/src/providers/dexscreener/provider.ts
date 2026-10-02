import { z } from "zod";
import type { Chain } from "../../core/types.js";
import { dp, unknown } from "../../core/types.js";
import type { DiscoveredToken, MarketSnapshot, PairInfo, Window } from "../../core/model.js";
import { WINDOWS } from "../../core/model.js";
import type { DEXProvider, MarketDataProvider } from "../types.js";
import { httpJson } from "../../core/http.js";
import { TokenBucket } from "../../core/rate-limiter.js";
import { TtlCache } from "../../core/cache.js";

const SRC = "dexscreener";
const CHAIN_IDS: Partial<Record<Chain, string>> = { solana: "solana", ethereum: "ethereum", base: "base", bsc: "bsc", avalanche: "avalanche" };

// Defensive schemas: every field optional, unknown keys allowed. DexScreener responses are not versioned.
const numish = z.union([z.number(), z.string()]).transform((v) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
});
const txn = z.object({ buys: z.number().optional(), sells: z.number().optional() }).partial().passthrough();
const pairSchema = z
  .object({
    chainId: z.string(),
    dexId: z.string().optional(),
    pairAddress: z.string(),
    baseToken: z.object({ address: z.string(), name: z.string().optional(), symbol: z.string().optional() }).passthrough(),
    quoteToken: z.object({ address: z.string().optional(), symbol: z.string().optional() }).passthrough().optional(),
    priceUsd: numish.optional(),
    txns: z.record(z.string(), txn.nullable()).optional(),
    volume: z.record(z.string(), numish.nullable()).optional(),
    priceChange: z.record(z.string(), numish.nullable()).optional(),
    liquidity: z.object({ usd: numish.optional(), base: numish.optional(), quote: numish.optional() }).partial().passthrough().optional(),
    fdv: numish.optional(),
    marketCap: numish.optional(),
    pairCreatedAt: z.number().optional(),
    info: z
      .object({
        imageUrl: z.string().optional(),
        websites: z.array(z.object({ url: z.string() }).passthrough()).optional(),
        socials: z.array(z.object({ type: z.string().optional(), platform: z.string().optional(), url: z.string().optional(), handle: z.string().optional() }).passthrough()).optional(),
      })
      .passthrough()
      .optional(),
    boosts: z.object({ active: z.number().optional() }).passthrough().optional(),
  })
  .passthrough();
type RawPair = z.infer<typeof pairSchema>;

const profileSchema = z
  .object({
    chainId: z.string(),
    tokenAddress: z.string(),
    url: z.string().optional(),
    description: z.string().optional(),
    links: z.array(z.object({ type: z.string().optional(), label: z.string().optional(), url: z.string().optional() }).passthrough()).optional(),
    amount: z.number().optional(),
    totalAmount: z.number().optional(),
  })
  .passthrough();

/**
 * DexScreener public API (no key). Documented endpoints + rate limits:
 *  - GET /latest/dex/tokens/{addresses}  (300 req/min) → { pairs: Pair[] }
 *  - GET /token-profiles/latest/v1        (60 req/min)  → Profile[]
 *  - GET /token-boosts/latest/v1          (60 req/min)  → Profile[] (+amount)
 * Boosts/profiles are PAID promotion by token teams: used only as discovery hints, never as quality.
 */
export class DexScreenerProvider implements DEXProvider {
  readonly id = SRC;
  readonly chains: Chain[] = ["solana", "ethereum", "base", "bsc", "avalanche"];
  readonly capability = "dex" as const;
  private pairsBucket = new TokenBucket(250, 60_000);
  private feedsBucket = new TokenBucket(50, 60_000);
  private cache = new TtlCache<MarketSnapshot | null>(5000);

  constructor(private readonly baseUrl = "https://api.dexscreener.com") {}

  /** MarketDataProvider view of the same instance (registered separately). */
  asMarketData(): MarketDataProvider {
    return {
      id: `${SRC}-feeds`,
      capability: "market",
      chains: this.chains,
      isConfigured: () => true,
      ping: () => this.ping(),
      getTrendingFeeds: (chain) => this.getTrendingFeeds(chain),
    };
  }

  isConfigured(): boolean {
    return true;
  }

  async ping(): Promise<boolean> {
    await this.feedsBucket.acquire();
    const res = await httpJson<unknown[]>(`${this.baseUrl}/token-boosts/latest/v1`, { provider: SRC, retries: 0 });
    return Array.isArray(res);
  }

  async getNewPools(chain: Chain): Promise<DiscoveredToken[]> {
    // DexScreener has no "new pools" endpoint; profiles + boosts are the closest public feeds.
    return this.getTrendingFeeds(chain);
  }

  async getTrendingFeeds(chain: Chain): Promise<DiscoveredToken[]> {
    const chainId = CHAIN_IDS[chain];
    if (!chainId) return [];
    const out: DiscoveredToken[] = [];
    for (const path of ["/token-profiles/latest/v1", "/token-boosts/latest/v1"]) {
      await this.feedsBucket.acquire();
      const raw = await httpJson<unknown>(`${this.baseUrl}${path}`, { provider: SRC });
      const arr = z.array(profileSchema).safeParse(raw);
      if (!arr.success) continue;
      const observedAt = new Date().toISOString();
      for (const p of arr.data) {
        if (p.chainId !== chainId) continue;
        out.push({
          chain,
          mint: p.tokenAddress,
          symbol: null,
          name: null,
          pairAddress: null,
          createdAt: null,
          source: `${SRC}:${path.includes("boosts") ? "boosts" : "profiles"}`,
          observedAt,
          liquidityUsd: null,
          volumeH1Usd: null,
        });
      }
    }
    return out;
  }

  async getMarket(chain: Chain, mint: string): Promise<MarketSnapshot | null> {
    const key = `${chain}:${mint}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    await this.pairsBucket.acquire();
    const raw = await httpJson<{ pairs?: unknown[] | null }>(`${this.baseUrl}/latest/dex/tokens/${mint}`, { provider: SRC });
    const chainId = CHAIN_IDS[chain];
    const pairs = (raw.pairs ?? [])
      .map((p) => pairSchema.safeParse(p))
      .filter((r): r is { success: true; data: RawPair } => r.success)
      .map((r) => r.data)
      .filter((p) => p.chainId === chainId && p.baseToken.address === mint);
    const snap = pairs.length ? toMarketSnapshot(pairs) : null;
    this.cache.set(key, snap, 20_000);
    return snap;
  }
}

/** Pure mapper (unit-tested): aggregates a token's pairs into one MarketSnapshot. */
export function toMarketSnapshot(pairs: RawPair[], observedAt = new Date().toISOString()): MarketSnapshot {
  const mapped: PairInfo[] = pairs.map((p) => ({
    pairAddress: p.pairAddress,
    dexId: p.dexId ?? "unknown",
    quoteSymbol: p.quoteToken?.symbol ?? null,
    priceUsd: p.priceUsd ?? null,
    liquidityUsd: p.liquidity?.usd ?? null,
    volumeUsd: pick(p.volume),
    txns: Object.fromEntries(WINDOWS.map((w) => [w, p.txns?.[w] ? { buys: p.txns[w]?.buys ?? 0, sells: p.txns[w]?.sells ?? 0 } : null])) as Record<Window, { buys: number; sells: number } | null>,
    priceChangePct: pick(p.priceChange),
    pairCreatedAt: p.pairCreatedAt ? new Date(p.pairCreatedAt).toISOString() : null,
    source: SRC,
  }));
  // Primary pair: deepest liquidity.
  const primary = [...mapped].sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))[0] ?? null;
  const primaryRaw = primary ? pairs.find((p) => p.pairAddress === primary.pairAddress)! : pairs[0]!;
  const sumWin = (get: (p: PairInfo) => number | null | undefined): number | null => {
    const vals = mapped.map(get).filter((v): v is number => typeof v === "number");
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const volumeUsd = Object.fromEntries(WINDOWS.map((w) => [w, sumWin((p) => p.volumeUsd[w])])) as Record<Window, number | null>;
  const txns = Object.fromEntries(
    WINDOWS.map((w) => {
      const t = mapped.map((p) => p.txns[w]).filter((x): x is { buys: number; sells: number } => !!x);
      return [w, t.length ? { buys: t.reduce((a, b) => a + b.buys, 0), sells: t.reduce((a, b) => a + b.sells, 0) } : null];
    }),
  ) as Record<Window, { buys: number; sells: number } | null>;
  const priceChangePct = Object.fromEntries(WINDOWS.map((w) => [w, primary?.priceChangePct[w] ?? null])) as Record<Window, number | null>;
  const liquidity = sumWin((p) => p.liquidityUsd);
  const createdAts = mapped.map((p) => p.pairCreatedAt).filter((x): x is string => !!x).sort();
  const websites = (primaryRaw.info?.websites ?? []).map((w) => w.url);
  const socials = (primaryRaw.info?.socials ?? []).flatMap((s) => (s.url ? [{ type: s.type ?? s.platform ?? "unknown", url: s.url }] : []));
  return {
    priceUsd: primary?.priceUsd != null ? dp(primary.priceUsd, SRC, "HIGH", observedAt) : unknown(SRC),
    marketCapUsd: primaryRaw.marketCap != null ? dp(primaryRaw.marketCap, SRC, "MEDIUM", observedAt) : unknown(SRC),
    fdvUsd: primaryRaw.fdv != null ? dp(primaryRaw.fdv, SRC, "MEDIUM", observedAt) : unknown(SRC),
    liquidityUsd: liquidity != null ? dp(liquidity, SRC, "HIGH", observedAt) : unknown(SRC),
    volumeUsd,
    txns,
    priceChangePct,
    pairCreatedAt: createdAts[0] ?? null,
    primaryPair: primary,
    pairs: mapped,
    boostsActive: primaryRaw.boosts?.active ?? null,
    websites,
    socials,
    imageUrl: primaryRaw.info?.imageUrl ?? null,
    baseSymbol: primaryRaw.baseToken.symbol ?? null,
    baseName: primaryRaw.baseToken.name ?? null,
    source: SRC,
    observedAt,
  };
}

function pick(rec: Record<string, number | null> | undefined): Partial<Record<Window, number | null>> {
  const out: Partial<Record<Window, number | null>> = {};
  for (const w of WINDOWS) out[w] = rec?.[w] ?? null;
  return out;
}

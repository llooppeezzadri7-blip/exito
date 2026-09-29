import { z } from "zod";
import type { Chain } from "../../core/types.js";
import { dp, unknown } from "../../core/types.js";
import type { Candle, DiscoveredToken, MarketSnapshot, PairInfo, TradeEvent, Window } from "../../core/model.js";
import { WINDOWS } from "../../core/model.js";
import type { DEXProvider } from "../types.js";
import { httpJson } from "../../core/http.js";
import { TokenBucket } from "../../core/rate-limiter.js";
import { TtlCache } from "../../core/cache.js";

const SRC = "geckoterminal";
const NETWORKS: Partial<Record<Chain, string>> = { solana: "solana", ethereum: "eth", base: "base", bsc: "bsc", avalanche: "avax" };
const HEADERS = { accept: "application/json;version=20230302" };

const numish = z.union([z.number(), z.string(), z.null()]).optional().transform((v) => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
});
const txWin = z.object({ buys: z.number().optional(), sells: z.number().optional(), buyers: z.number().optional(), sellers: z.number().optional() }).partial().passthrough();
export const poolSchema = z
  .object({
    id: z.string(),
    attributes: z
      .object({
        name: z.string().optional(),
        address: z.string(),
        base_token_price_usd: numish,
        pool_created_at: z.string().nullable().optional(),
        reserve_in_usd: numish,
        fdv_usd: numish,
        market_cap_usd: numish,
        price_change_percentage: z.record(z.string(), numish).optional(),
        transactions: z.record(z.string(), txWin.nullable()).optional(),
        volume_usd: z.record(z.string(), numish).optional(),
      })
      .passthrough(),
    relationships: z
      .object({
        base_token: z.object({ data: z.object({ id: z.string() }) }).optional(),
        quote_token: z.object({ data: z.object({ id: z.string() }) }).optional(),
        dex: z.object({ data: z.object({ id: z.string() }) }).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
type RawPool = z.infer<typeof poolSchema>;

const tradeSchema = z
  .object({
    attributes: z
      .object({
        tx_hash: z.string().optional(),
        tx_from_address: z.string().optional(),
        block_timestamp: z.string().optional(),
        kind: z.string().optional(),
        volume_in_usd: numish,
        from_token_amount: numish,
        to_token_amount: numish,
        price_from_in_usd: numish,
        price_to_in_usd: numish,
        from_token_address: z.string().optional(),
        to_token_address: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

/**
 * GeckoTerminal public API v2 (no key, 30 req/min; header Accept version pinned).
 *  - GET /networks/{network}/new_pools?page=N          (pools created in the last 48h, 20/page)
 *  - GET /networks/{network}/tokens/{mint}/pools       (pools for a token)
 *  - GET /networks/{network}/pools/{pool}/ohlcv/{tf}   (candles)
 *  - GET /networks/{network}/pools/{pool}/trades       (last trades, incl. tx_from_address => unique buyers)
 */
export class GeckoTerminalProvider implements DEXProvider {
  readonly id = SRC;
  readonly capability = "dex" as const;
  readonly chains: Chain[] = ["solana", "ethereum", "base", "bsc", "avalanche"];
  private bucket = new TokenBucket(25, 60_000);
  private cache = new TtlCache<unknown>(3000);

  constructor(private readonly baseUrl = "https://api.geckoterminal.com/api/v2") {}

  isConfigured(): boolean {
    return true;
  }

  async ping(): Promise<boolean> {
    await this.bucket.acquire();
    const res = await httpJson<{ data?: unknown }>(`${this.baseUrl}/networks?page=1`, { provider: SRC, headers: HEADERS, retries: 0 });
    return Array.isArray(res.data);
  }

  async getNewPools(chain: Chain, pages = 2): Promise<DiscoveredToken[]> {
    const net = NETWORKS[chain];
    if (!net) return [];
    const out: DiscoveredToken[] = [];
    for (let page = 1; page <= pages; page++) {
      await this.bucket.acquire();
      const raw = await httpJson<{ data?: unknown[] }>(`${this.baseUrl}/networks/${net}/new_pools?page=${page}`, { provider: SRC, headers: HEADERS });
      const observedAt = new Date().toISOString();
      for (const item of raw.data ?? []) {
        const r = poolSchema.safeParse(item);
        if (!r.success) continue;
        const d = discoveredFromPool(chain, r.data, observedAt);
        if (d) out.push(d);
      }
    }
    return out;
  }

  async getMarket(chain: Chain, mint: string): Promise<MarketSnapshot | null> {
    const net = NETWORKS[chain];
    if (!net) return null;
    const key = `market:${chain}:${mint}`;
    const hit = this.cache.get(key) as MarketSnapshot | null | undefined;
    if (hit !== undefined) return hit;
    await this.bucket.acquire();
    const raw = await httpJson<{ data?: unknown[] }>(`${this.baseUrl}/networks/${net}/tokens/${mint}/pools?page=1`, { provider: SRC, headers: HEADERS });
    const pools = (raw.data ?? []).map((p) => poolSchema.safeParse(p)).filter((r): r is { success: true; data: RawPool } => r.success).map((r) => r.data);
    const snap = pools.length ? poolsToMarket(pools) : null;
    this.cache.set(key, snap, 30_000);
    return snap;
  }

  async getOhlcv(chain: Chain, pairAddress: string, timeframe: "minute" | "hour", aggregate: number, limit: number): Promise<Candle[]> {
    const net = NETWORKS[chain];
    if (!net) return [];
    await this.bucket.acquire();
    const raw = await httpJson<{ data?: { attributes?: { ohlcv_list?: unknown[] } } }>(
      `${this.baseUrl}/networks/${net}/pools/${pairAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}`,
      { provider: SRC, headers: HEADERS },
    );
    const list = raw.data?.attributes?.ohlcv_list ?? [];
    return list
      .filter((row): row is number[] => Array.isArray(row) && row.length >= 6)
      .map((row) => ({ ts: new Date(row[0]! * 1000).toISOString(), open: row[1]!, high: row[2]!, low: row[3]!, close: row[4]!, volumeUsd: row[5]! }))
      .sort((a, b) => a.ts.localeCompare(b.ts));
  }

  async getTrades(chain: Chain, pairAddress: string): Promise<TradeEvent[]> {
    const net = NETWORKS[chain];
    if (!net) return [];
    await this.bucket.acquire();
    const raw = await httpJson<{ data?: unknown[] }>(`${this.baseUrl}/networks/${net}/pools/${pairAddress}/trades?trade_volume_in_usd_greater_than=0`, { provider: SRC, headers: HEADERS });
    const out: TradeEvent[] = [];
    for (const item of raw.data ?? []) {
      const r = tradeSchema.safeParse(item);
      if (!r.success) continue;
      const a = r.data.attributes;
      const kind = a.kind === "buy" ? "buy" : a.kind === "sell" ? "sell" : null;
      if (!kind) continue;
      out.push({
        ts: a.block_timestamp ?? new Date().toISOString(),
        kind,
        wallet: a.tx_from_address ?? null,
        amountUsd: a.volume_in_usd,
        amountToken: kind === "buy" ? a.to_token_amount : a.from_token_amount,
        priceUsd: kind === "buy" ? a.price_to_in_usd : a.price_from_in_usd,
        txHash: a.tx_hash ?? null,
        source: SRC,
      });
    }
    return out.sort((x, y) => x.ts.localeCompare(y.ts));
  }
}

function mintFromId(id: string | undefined): string | null {
  if (!id) return null;
  const idx = id.indexOf("_");
  return idx >= 0 ? id.slice(idx + 1) : id;
}

export function discoveredFromPool(chain: Chain, pool: RawPool, observedAt: string): DiscoveredToken | null {
  const mint = mintFromId(pool.relationships?.base_token?.data.id);
  if (!mint) return null;
  const name = pool.attributes.name ?? null;
  const symbol = name ? name.split("/")[0]?.trim() ?? null : null;
  return {
    chain,
    mint,
    symbol,
    name: null,
    pairAddress: pool.attributes.address,
    createdAt: pool.attributes.pool_created_at ?? null,
    source: `${SRC}:new_pools`,
    observedAt,
    liquidityUsd: pool.attributes.reserve_in_usd,
    volumeH1Usd: pool.attributes.volume_usd?.h1 ?? null,
    raw: { transactions: pool.attributes.transactions },
  };
}

export function poolsToMarket(pools: RawPool[], observedAt = new Date().toISOString()): MarketSnapshot {
  const mapped: PairInfo[] = pools.map((p) => ({
    pairAddress: p.attributes.address,
    dexId: p.relationships?.dex?.data.id ?? "unknown",
    quoteSymbol: p.attributes.name?.split("/")[1]?.trim() ?? null,
    priceUsd: p.attributes.base_token_price_usd,
    liquidityUsd: p.attributes.reserve_in_usd,
    volumeUsd: Object.fromEntries(WINDOWS.map((w) => [w, p.attributes.volume_usd?.[w] ?? null])),
    txns: Object.fromEntries(
      WINDOWS.map((w) => {
        const t = p.attributes.transactions?.[w];
        return [w, t ? { buys: t.buys ?? 0, sells: t.sells ?? 0 } : null];
      }),
    ) as Record<Window, { buys: number; sells: number } | null>,
    priceChangePct: Object.fromEntries(WINDOWS.map((w) => [w, p.attributes.price_change_percentage?.[w] ?? null])),
    pairCreatedAt: p.attributes.pool_created_at ?? null,
    source: SRC,
  }));
  const primary = [...mapped].sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))[0]!;
  const primaryRaw = pools.find((p) => p.attributes.address === primary.pairAddress)!;
  const sum = (f: (p: PairInfo) => number | null | undefined) => {
    const v = mapped.map(f).filter((x): x is number => typeof x === "number");
    return v.length ? v.reduce((a, b) => a + b, 0) : null;
  };
  const liq = sum((p) => p.liquidityUsd);
  return {
    priceUsd: primary.priceUsd != null ? dp(primary.priceUsd, SRC, "HIGH", observedAt) : unknown(SRC),
    marketCapUsd: primaryRaw.attributes.market_cap_usd != null ? dp(primaryRaw.attributes.market_cap_usd, SRC, "MEDIUM", observedAt) : unknown(SRC),
    fdvUsd: primaryRaw.attributes.fdv_usd != null ? dp(primaryRaw.attributes.fdv_usd, SRC, "MEDIUM", observedAt) : unknown(SRC),
    liquidityUsd: liq != null ? dp(liq, SRC, "HIGH", observedAt) : unknown(SRC),
    volumeUsd: Object.fromEntries(WINDOWS.map((w) => [w, sum((p) => p.volumeUsd[w])])) as Record<Window, number | null>,
    txns: Object.fromEntries(
      WINDOWS.map((w) => {
        const t = mapped.map((p) => p.txns[w]).filter((x): x is { buys: number; sells: number } => !!x);
        return [w, t.length ? { buys: t.reduce((a, b) => a + b.buys, 0), sells: t.reduce((a, b) => a + b.sells, 0) } : null];
      }),
    ) as Record<Window, { buys: number; sells: number } | null>,
    priceChangePct: Object.fromEntries(WINDOWS.map((w) => [w, primary.priceChangePct[w] ?? null])) as Record<Window, number | null>,
    pairCreatedAt: mapped.map((p) => p.pairCreatedAt).filter((x): x is string => !!x).sort()[0] ?? null,
    primaryPair: primary,
    pairs: mapped,
    boostsActive: null,
    websites: [],
    socials: [],
    imageUrl: null,
    source: SRC,
    observedAt,
  };
}

/** Unique buyers/sellers per window when the provider exposes them (GeckoTerminal does). */
export function uniqueTradersFromRaw(raw: unknown): Partial<Record<Window, { buyers: number | null; sellers: number | null }>> {
  const tx = (raw as { transactions?: Record<string, { buyers?: number; sellers?: number } | null> } | undefined)?.transactions;
  const out: Partial<Record<Window, { buyers: number | null; sellers: number | null }>> = {};
  if (!tx) return out;
  for (const w of WINDOWS) {
    const t = tx[w];
    if (t) out[w] = { buyers: t.buyers ?? null, sellers: t.sellers ?? null };
  }
  return out;
}

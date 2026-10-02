import { z } from "zod";
import type { Chain } from "../../core/types.js";
import { dp, unknown } from "../../core/types.js";
import type { DiscoveredToken, HolderInfo, SecurityReport } from "../../core/model.js";
import type { SecurityProvider } from "../types.js";
import { httpJson } from "../../core/http.js";
import { TokenBucket } from "../../core/rate-limiter.js";
import { TtlCache } from "../../core/cache.js";
import { clamp } from "../../core/stats.js";

const SRC = "rugcheck";

const numish = z.union([z.number(), z.string(), z.null()]).optional().transform((v) => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
});
const reportSchema = z
  .object({
    mint: z.string().optional(),
    creator: z.string().nullable().optional(),
    tokenProgram: z.string().optional(),
    token: z.object({ mintAuthority: z.string().nullable().optional(), freezeAuthority: z.string().nullable().optional(), supply: numish, decimals: z.number().optional() }).passthrough().nullable().optional(),
    tokenMeta: z.object({ name: z.string().optional(), symbol: z.string().optional(), mutable: z.boolean().optional(), updateAuthority: z.string().optional() }).passthrough().nullable().optional(),
    mintAuthority: z.string().nullable().optional(),
    freezeAuthority: z.string().nullable().optional(),
    topHolders: z.array(z.object({ address: z.string(), owner: z.string().optional(), pct: numish, uiAmount: numish, insider: z.boolean().optional() }).passthrough()).nullable().optional(),
    risks: z.array(z.object({ name: z.string(), level: z.string().optional(), description: z.string().optional(), score: numish, value: z.string().optional() }).passthrough()).nullable().optional(),
    score: numish,
    score_normalised: numish,
    rugged: z.boolean().optional(),
    totalHolders: numish,
    totalLPProviders: numish,
    totalMarketLiquidity: numish,
    graphInsidersDetected: numish,
    markets: z.array(z.object({ pubkey: z.string().optional(), marketType: z.string().optional(), lp: z.object({ lpLockedPct: numish, lpTotalSupply: numish, lpLocked: numish, baseUSD: numish, quoteUSD: numish }).passthrough().nullable().optional() }).passthrough()).nullable().optional(),
    knownAccounts: z.record(z.string(), z.object({ name: z.string().optional(), type: z.string().optional() }).passthrough()).nullable().optional(),
  })
  .passthrough();
export type RawRugcheckReport = z.infer<typeof reportSchema>;

const newTokenSchema = z.object({ mint: z.string(), symbol: z.string().nullable().optional(), name: z.string().nullable().optional(), createAt: z.string().nullable().optional(), creator: z.string().nullable().optional() }).passthrough();

/**
 * RugCheck public API (no key for read endpoints):
 *  - GET /v1/tokens/{mint}/report   full report (risks, topHolders, markets/lp lock, insiders, score)
 *  - GET /v1/stats/new_tokens       recently detected tokens (discovery hint)
 * Their score is *higher = riskier*. We cross-check authorities with our own RPC read; the report never
 * replaces on-chain verification (see docs/DATA_SOURCES.md).
 */
export class RugCheckProvider implements SecurityProvider {
  readonly id = SRC;
  readonly capability = "security" as const;
  readonly chains: Chain[] = ["solana"];
  private bucket = new TokenBucket(30, 60_000);
  private cache = new TtlCache<SecurityReport | null>(5000);

  constructor(private readonly baseUrl = "https://api.rugcheck.xyz/v1") {}

  isConfigured(): boolean {
    return true;
  }

  async ping(): Promise<boolean> {
    await this.bucket.acquire();
    const res = await httpJson<unknown>(`${this.baseUrl}/stats/new_tokens`, { provider: SRC, retries: 0 });
    return Array.isArray(res);
  }

  async getReport(chain: Chain, mint: string): Promise<SecurityReport | null> {
    if (chain !== "solana") return null;
    const hit = this.cache.get(mint);
    if (hit !== undefined) return hit;
    await this.bucket.acquire();
    const raw = await httpJson<unknown>(`${this.baseUrl}/tokens/${mint}/report`, { provider: SRC });
    const r = reportSchema.safeParse(raw);
    const report = r.success ? mapRugcheckReport(r.data) : null;
    this.cache.set(mint, report, 3 * 60_000);
    return report;
  }

  async getNewTokens(chain: Chain): Promise<DiscoveredToken[]> {
    if (chain !== "solana") return [];
    await this.bucket.acquire();
    const raw = await httpJson<unknown>(`${this.baseUrl}/stats/new_tokens`, { provider: SRC });
    const arr = z.array(newTokenSchema).safeParse(raw);
    if (!arr.success) return [];
    const observedAt = new Date().toISOString();
    return arr.data.map((t) => ({
      chain,
      mint: t.mint,
      symbol: t.symbol ?? null,
      name: t.name ?? null,
      pairAddress: null,
      createdAt: t.createAt ?? null,
      source: `${SRC}:new_tokens`,
      observedAt,
      liquidityUsd: null,
      volumeH1Usd: null,
    }));
  }
}

/**
 * Share of total pool liquidity whose LP is locked/burned, weighted by each pool's USD liquidity.
 * (A token can have a small burned pool and a large unlocked one: max() would report "100% locked".)
 * Falls back to the unweighted minimum when no pool reports USD values. null when no pool reports a lock %.
 */
export function weightedLpLocked(markets: { lp?: { lpLockedPct?: number | null; baseUSD?: number | null; quoteUSD?: number | null } | null }[]): number | null {
  const withPct = markets.filter((m) => typeof m.lp?.lpLockedPct === "number");
  if (!withPct.length) return null;
  let total = 0;
  let locked = 0;
  for (const m of withPct) {
    const usd = (m.lp?.baseUSD ?? 0) + (m.lp?.quoteUSD ?? 0);
    total += usd;
    locked += usd * (m.lp!.lpLockedPct! / 100);
  }
  if (total > 0) return Math.round((locked / total) * 1000) / 10;
  return Math.min(...withPct.map((m) => m.lp!.lpLockedPct!));
}

export function mapRugcheckReport(r: RawRugcheckReport, observedAt = new Date().toISOString()): SecurityReport {
  const risks = (r.risks ?? []).map((x) => ({ name: x.name, level: x.level ?? "unknown", description: x.description ?? x.value ?? "", score: x.score }));
  const normalised = r.score_normalised ?? (r.score !== null && r.score !== undefined ? clamp(r.score / 100, 0, 100) : null);
  const lpLocked = weightedLpLocked(r.markets ?? []);
  const known = r.knownAccounts ?? {};
  const topHolders: HolderInfo[] = (r.topHolders ?? []).map((h) => {
    const k = known[h.address] ?? (h.owner ? known[h.owner] : undefined);
    const type = k?.type?.toLowerCase() ?? "";
    return {
      address: h.address,
      owner: h.owner ?? null,
      amount: h.uiAmount ?? 0,
      pct: h.pct ?? 0,
      isLpPool: type.includes("amm") || type.includes("pool") || type.includes("lp") || type.includes("locker"),
      label: k?.name ?? (h.insider ? "flagged insider (rugcheck)" : null),
    };
  });
  const mintAuth = r.mintAuthority !== undefined ? r.mintAuthority : r.token?.mintAuthority;
  const freezeAuth = r.freezeAuthority !== undefined ? r.freezeAuthority : r.token?.freezeAuthority;
  return {
    rawScore: r.score != null ? dp(r.score, SRC, "MEDIUM", observedAt) : unknown(SRC),
    riskIndex: normalised != null ? dp(clamp(normalised, 0, 100), SRC, "MEDIUM", observedAt) : unknown(SRC),
    risks,
    rugged: r.rugged !== undefined ? dp(r.rugged, SRC, "MEDIUM", observedAt) : unknown(SRC),
    insidersDetected: r.graphInsidersDetected != null ? dp(r.graphInsidersDetected, SRC, "MEDIUM", observedAt) : unknown(SRC),
    lpLockedPct: lpLocked != null ? dp(lpLocked, SRC, "MEDIUM", observedAt) : unknown(SRC),
    totalHolders: r.totalHolders != null ? dp(r.totalHolders, SRC, "MEDIUM", observedAt) : unknown(SRC),
    mintAuthorityActive: mintAuth !== undefined ? dp(mintAuth !== null, SRC, "MEDIUM", observedAt) : unknown(SRC),
    freezeAuthorityActive: freezeAuth !== undefined ? dp(freezeAuth !== null, SRC, "MEDIUM", observedAt) : unknown(SRC),
    creator: r.creator ? dp(r.creator, SRC, "MEDIUM", observedAt) : unknown(SRC),
    topHolders,
    source: SRC,
    observedAt,
  };
}

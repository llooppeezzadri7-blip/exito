import { dp, unknown } from "../../src/core/types.js";
import type { HolderInfo, MarketSnapshot, SecurityInfo, TokenSnapshot, TradeEvent, WalletProfile, DeployerInfo, SecurityReport } from "../../src/core/model.js";
import type { SnapshotRecord, TokenRecord } from "../../src/db/records.js";
import { loadDefaultConfig } from "../../src/config/index.js";
import type { EngineConfig } from "../../src/config/schema.js";

export const cfg: EngineConfig = loadDefaultConfig();
export const MINT = "So11111111111111111111111111111111111111112";
export const T0 = new Date("2026-09-29T10:00:00.000Z");
export const at = (minutes: number): string => new Date(T0.getTime() + minutes * 60_000).toISOString();

export function makeMarket(o: Partial<{ price: number; mc: number; liq: number; v5: number; v1: number; v6: number; v24: number; b1: number; s1: number; b5: number; s5: number; pc5: number; pc1: number; pc24: number; created: string; observedAt: string }> = {}): MarketSnapshot {
  const obs = o.observedAt ?? at(0);
  const price = o.price ?? 0.001;
  const pair = { pairAddress: "PAIR111111111111111111111111111111111111111", dexId: "raydium", quoteSymbol: "SOL", priceUsd: price, liquidityUsd: o.liq ?? 50_000, volumeUsd: { m5: o.v5 ?? 2000, h1: o.v1 ?? 20_000, h6: o.v6 ?? 60_000, h24: o.v24 ?? 100_000 }, txns: { m5: { buys: o.b5 ?? 20, sells: o.s5 ?? 10 }, h1: { buys: o.b1 ?? 200, sells: o.s1 ?? 120 }, h6: null, h24: null }, priceChangePct: { m5: o.pc5 ?? 2, h1: o.pc1 ?? 15, h6: null, h24: o.pc24 ?? 40 }, pairCreatedAt: o.created ?? at(-60), source: "test-dex" };
  return { priceUsd: dp(price, "test-dex", "HIGH", obs), marketCapUsd: dp(o.mc ?? 300_000, "test-dex", "MEDIUM", obs), fdvUsd: dp(o.mc ?? 300_000, "test-dex", "MEDIUM", obs), liquidityUsd: dp(pair.liquidityUsd, "test-dex", "HIGH", obs), volumeUsd: pair.volumeUsd, txns: pair.txns, priceChangePct: pair.priceChangePct, pairCreatedAt: pair.pairCreatedAt, primaryPair: pair, pairs: [pair], boostsActive: null, websites: ["https://example.com"], socials: [{ type: "twitter", url: "https://x.com/example" }], imageUrl: null, source: "test-dex", observedAt: obs };
}

export function makeSecurity(o: Partial<{ mint: boolean | null; freeze: boolean | null; program: string; ext: string[]; permanentDelegate: boolean; transferHook: boolean; feeBps: number; mutable: boolean }> = {}): SecurityInfo {
  const obs = at(0);
  const k = <T,>(v: T | null | undefined, fallback: T): ReturnType<typeof dp<T>> => (v === null ? unknown<T>("test-rpc") : dp(v ?? fallback, "test-rpc", "HIGH", obs));
  return { mintAuthorityActive: k(o.mint, false), freezeAuthorityActive: k(o.freeze, false), tokenProgram: dp(o.program ?? "spl-token", "test-rpc", "HIGH", obs), extensions: dp(o.ext ?? [], "test-rpc", "HIGH", obs), supply: dp(1_000_000_000, "test-rpc", "HIGH", obs), decimals: dp(6, "test-rpc", "HIGH", obs), permanentDelegate: dp(o.permanentDelegate ?? false, "test-rpc", "HIGH", obs), transferHook: dp(o.transferHook ?? false, "test-rpc", "HIGH", obs), transferFeeBps: dp(o.feeBps ?? 0, "test-rpc", "HIGH", obs), nonTransferable: dp(false, "test-rpc", "HIGH", obs), metadataMutable: dp(o.mutable ?? false, "test-rpc", "HIGH", obs), updateAuthority: unknown("test-rpc"), source: "test-rpc", observedAt: obs };
}

export function makeHolders(pcts: number[], opts: { lpPct?: number; total?: number; owners?: string[] } = {}): TokenSnapshot["holders"] {
  const top: HolderInfo[] = pcts.map((pct, i) => ({ address: `ACC${i}${"x".repeat(38)}`.slice(0, 44), owner: opts.owners?.[i] ?? `OWN${i}${"y".repeat(38)}`.slice(0, 44), amount: pct * 1e7, pct, isLpPool: false, label: null }));
  if (opts.lpPct) top.unshift({ address: "LPACCOUNT11111111111111111111111111111111", owner: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1", amount: opts.lpPct * 1e7, pct: opts.lpPct, isLpPool: true, label: "Raydium AMM authority" });
  return { totalHolders: dp(opts.total ?? 500, "test-rpc", "HIGH", at(0)), top, lpLockedPct: dp(100, "test-report", "MEDIUM", at(0)), lpBurnedPct: unknown("test"), lpProviders: unknown("test"), source: "test-rpc", observedAt: at(0) };
}

export function makeDeployer(o: Partial<{ address: string; ageDays: number | null; txCount: number; fundedBy: string | null; holdsPct: number }> = {}): DeployerInfo {
  const obs = at(0);
  return { address: dp(o.address ?? "DEPLOYER1111111111111111111111111111111111", "test-rpc", "HIGH", obs), walletAgeDays: o.ageDays === null ? unknown("test-rpc") : dp(o.ageDays ?? 30, "test-rpc", "HIGH", obs), txCount: dp(o.txCount ?? 200, "test-rpc", "HIGH", obs), previousTokens: unknown("test"), previousRuggedTokens: unknown("test"), fundedBy: o.fundedBy === null ? unknown("test-rpc") : dp(o.fundedBy ?? "FUNDER111111111111111111111111111111111111", "test-rpc", "MEDIUM", obs), holdsPct: dp(o.holdsPct ?? 0, "test-rpc", "MEDIUM", obs), previousSurvivalRate: unknown("test"), source: "test-rpc", observedAt: obs };
}

export function makeReport(o: Partial<{ riskIndex: number; lpLocked: number; rugged: boolean; risks: SecurityReport["risks"]; insiders: number }> = {}): SecurityReport {
  const obs = at(0);
  return { rawScore: dp(100, "test-report", "MEDIUM", obs), riskIndex: dp(o.riskIndex ?? 10, "test-report", "MEDIUM", obs), risks: o.risks ?? [], rugged: dp(o.rugged ?? false, "test-report", "MEDIUM", obs), insidersDetected: dp(o.insiders ?? 0, "test-report", "MEDIUM", obs), lpLockedPct: dp(o.lpLocked ?? 100, "test-report", "MEDIUM", obs), totalHolders: dp(500, "test-report", "MEDIUM", obs), mintAuthorityActive: dp(false, "test-report", "MEDIUM", obs), freezeAuthorityActive: dp(false, "test-report", "MEDIUM", obs), creator: dp("DEPLOYER1111111111111111111111111111111111", "test-report", "MEDIUM", obs), topHolders: [], source: "test-report", observedAt: obs };
}

export function makeTrade(o: Partial<TradeEvent> & { minute?: number } = {}): TradeEvent {
  return { ts: o.ts ?? at(o.minute ?? 0), kind: o.kind ?? "buy", wallet: o.wallet ?? "WALLET1111111111111111111111111111111111111", amountUsd: o.amountUsd ?? 100, amountToken: o.amountToken ?? 1000, priceUsd: o.priceUsd ?? 0.001, txHash: o.txHash ?? `tx${Math.random().toString(36).slice(2)}`, source: "test-dex" };
}

export function makeWallet(address: string, o: Partial<{ fundedBy: string | null; fundedAt: string; firstSeen: string; txCount: number }> = {}): WalletProfile {
  const obs = at(0);
  return { address, firstSeenAt: dp(o.firstSeen ?? at(-1000), "test-rpc", "HIGH", obs), txCount: dp(o.txCount ?? 50, "test-rpc", "HIGH", obs), fundedBy: o.fundedBy === null || o.fundedBy === undefined ? unknown("test-rpc") : dp(o.fundedBy, "test-rpc", "MEDIUM", obs), fundedAt: o.fundedAt ? dp(o.fundedAt, "test-rpc", "MEDIUM", obs) : unknown("test-rpc"), balance: dp(1, "test-rpc", "HIGH", obs), source: "test-rpc", observedAt: obs };
}

export function makeSnapshot(o: Partial<TokenSnapshot> = {}): TokenSnapshot {
  return { chain: "solana", mint: MINT, symbol: "TEST", name: "Test Token", observedAt: at(0), createdAt: at(-60), market: makeMarket(), security: makeSecurity(), holders: makeHolders([4, 3, 2.5, 2, 2, 1.5, 1.5, 1, 1, 1], { lpPct: 20 }), deployer: makeDeployer(), securityReport: makeReport(), trades: [], candles: [], social: null, walletProfiles: [], sources: ["test-dex", "test-rpc", "test-report"], degradedSources: [], dataQuality: 0.9, ...o };
}

/** Build a snapshot record from a TokenSnapshot (mirrors build-snapshot.ts). */
export function toRecord(s: TokenSnapshot, extra: Partial<SnapshotRecord> = {}): SnapshotRecord {
  const m = s.market;
  const nonLp = (s.holders?.top ?? []).filter((h) => !h.isLpPool).sort((a, b) => b.pct - a.pct);
  return { chain: s.chain, mint: s.mint, observedAt: s.observedAt, priceUsd: m?.priceUsd.value ?? null, marketCapUsd: m?.marketCapUsd.value ?? null, liquidityUsd: m?.liquidityUsd.value ?? null, volumeM5Usd: m?.volumeUsd.m5 ?? null, volumeH1Usd: m?.volumeUsd.h1 ?? null, volumeH24Usd: m?.volumeUsd.h24 ?? null, buysH1: m?.txns.h1?.buys ?? null, sellsH1: m?.txns.h1?.sells ?? null, buysM5: m?.txns.m5?.buys ?? null, sellsM5: m?.txns.m5?.sells ?? null, holders: s.holders?.totalHolders.value ?? null, uniqueBuyersH1: null, uniqueSellersH1: null, top10Pct: nonLp.slice(0, 10).reduce((a, h) => a + h.pct, 0), dataQuality: s.dataQuality, sources: s.sources, payload: s, ...extra };
}

/** Series of snapshot records at given minute offsets with a generator for each point. */
export function makeSeries(minutes: number[], gen: (i: number, minute: number) => Partial<{ price: number; liq: number; v1: number; v5: number; holders: number; mc: number; b1: number; s1: number }>): SnapshotRecord[] {
  return minutes.map((minute, i) => {
    const g = gen(i, minute);
    const snap = makeSnapshot({ observedAt: at(minute), market: makeMarket({ price: g.price, liq: g.liq, v1: g.v1, v5: g.v5, mc: g.mc, b1: g.b1, s1: g.s1, observedAt: at(minute) }), holders: makeHolders([4, 3, 2, 2, 1], { lpPct: 20, total: g.holders ?? 500 }) });
    return toRecord(snap);
  });
}

export function makeToken(o: Partial<TokenRecord> = {}): TokenRecord {
  return { chain: "solana", mint: MINT, symbol: "TEST", name: "Test Token", createdAt: at(-60), discoveredAt: at(-30), discoverySources: ["test"], pairAddress: "PAIR111111111111111111111111111111111111111", deployer: null, tier: 2, status: "NEW", rejectReason: null, category: null, lastScore: null, lastRisk: null, lastAnalyzedAt: null, nextAnalyzeAt: at(0), cyclesBelowTier: 0, updatedAt: at(0), ...o };
}

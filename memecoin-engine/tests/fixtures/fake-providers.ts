import type { Chain } from "../../src/core/types.js";
import { dp, unknown } from "../../src/core/types.js";
import type { DiscoveredToken, HolderInfo, MarketSnapshot, SecurityInfo, SecurityReport, TradeEvent, WalletProfile } from "../../src/core/model.js";
import type { BlockchainProvider, DEXProvider, MarketDataProvider, SecurityProvider } from "../../src/providers/types.js";
import { ProviderRegistry } from "../../src/providers/registry.js";
import { MemoryStore } from "../../src/db/memory-store.js";
import type { EngineContext } from "../../src/pipeline/context.js";
import { logger } from "../../src/core/logger.js";
import { cfg, makeMarket, makeSecurity, makeHolders, makeReport, makeWallet, MINT } from "./factory.js";

/** Mutable world state the tests advance between analysis cycles. */
export interface World {
  now: Date;
  price: number;
  mc: number;
  liq: number;
  v5: number;
  v1: number;
  v24: number;
  b1: number;
  s1: number;
  pc5: number;
  pc1: number;
  pc24: number;
  holders: number;
  holderPcts: number[];
  holderOwners?: string[];
  lpPct: number;
  mintAuthority: boolean | null;
  freezeAuthority: boolean | null;
  lpLocked: number;
  reportRisks: SecurityReport["risks"];
  trades: TradeEvent[];
  wallets: Record<string, WalletProfile>;
  deployer: string;
  deployerAge: number | null;
  failDex: boolean;
  failRpc: boolean;
  newPools: DiscoveredToken[];
  feeds: DiscoveredToken[];
}

export function world(o: Partial<World> = {}): World {
  const now = new Date();
  return { now, price: 0.001, mc: 250_000, liq: 45_000, v5: 1500, v1: 15_000, v24: 60_000, b1: 150, s1: 90, pc5: 2, pc1: 12, pc24: 30, holders: 300, holderPcts: [4, 3, 2.5, 2, 2, 1.5, 1.5, 1, 1, 1], lpPct: 25, mintAuthority: false, freezeAuthority: false, lpLocked: 100, reportRisks: [], trades: [], wallets: {}, deployer: "DEPLOYER1111111111111111111111111111111111", deployerAge: 40, failDex: false, failRpc: false, newPools: [], feeds: [], ...o };
}

export function fakeRegistry(w: World): ProviderRegistry {
  const obs = () => w.now.toISOString();
  const dex: DEXProvider = {
    id: "dexscreener", capability: "dex", chains: ["solana"], isConfigured: () => true, ping: async () => true,
    getNewPools: async () => w.newPools,
    getMarket: async (): Promise<MarketSnapshot | null> => {
      if (w.failDex) throw new Error("dex 503");
      return makeMarket({ price: w.price, mc: w.mc, liq: w.liq, v5: w.v5, v1: w.v1, v24: w.v24, b1: w.b1, s1: w.s1, pc5: w.pc5, pc1: w.pc1, pc24: w.pc24, created: new Date(w.now.getTime() - 60 * 60_000).toISOString(), observedAt: obs() });
    },
    getTrades: async () => w.trades.filter((t) => new Date(t.ts).getTime() <= w.now.getTime()),
    getOhlcv: async () => [],
  };
  const feeds: MarketDataProvider = { id: "dexscreener-feeds", capability: "market", chains: ["solana"], isConfigured: () => true, ping: async () => true, getTrendingFeeds: async () => w.feeds };
  const gecko: DEXProvider = { ...dex, id: "geckoterminal", getMarket: async () => { if (w.failDex) throw new Error("gecko 503"); return dex.getMarket("solana", MINT); } };
  const chain: BlockchainProvider = {
    id: "solana-rpc", capability: "blockchain", chains: ["solana"], isConfigured: () => true, ping: async () => true,
    getMintInfo: async (): Promise<SecurityInfo> => { if (w.failRpc) throw new Error("rpc 429"); return { ...makeSecurity({ mint: w.mintAuthority, freeze: w.freezeAuthority }), observedAt: obs() }; },
    getTopHolders: async (): Promise<HolderInfo[]> => { if (w.failRpc) throw new Error("rpc 429"); return makeHolders(w.holderPcts, { lpPct: w.lpPct, total: w.holders, owners: w.holderOwners })!.top; },
    getDeployer: async () => (w.failRpc ? null : { address: w.deployer, createdAt: new Date(Date.now() - 60 * 60_000).toISOString(), signature: "sig" }),
    getWalletProfile: async (_c: Chain, a: string) => w.wallets[a] ?? (a === w.deployer ? makeWallet(a, { firstSeen: w.deployerAge === null ? undefined : new Date(Date.now() - w.deployerAge * 86_400_000).toISOString(), txCount: 120 }) : makeWallet(a)),
  };
  const sec: SecurityProvider = {
    id: "rugcheck", capability: "security", chains: ["solana"], isConfigured: () => true, ping: async () => true,
    getReport: async (): Promise<SecurityReport | null> => { const r = makeReport({ lpLocked: w.lpLocked, risks: w.reportRisks }); r.totalHolders = dp(w.holders, "test-report", "MEDIUM", obs()); r.mintAuthorityActive = w.mintAuthority === null ? unknown("test-report") : dp(w.mintAuthority, "test-report", "MEDIUM", obs()); r.freezeAuthorityActive = w.freezeAuthority === null ? unknown("test-report") : dp(w.freezeAuthority, "test-report", "MEDIUM", obs()); return { ...r, observedAt: obs() }; },
    getNewTokens: async () => [],
  };
  return new ProviderRegistry().register(dex).register(feeds).register(gecko).register(chain).register(sec);
}

export function fakeContext(w: World, store = new MemoryStore()): EngineContext {
  return { cfg, store, registry: fakeRegistry(w), log: logger, now: () => new Date(w.now), counters: {} };
}

export function advance(w: World, minutes: number, patch: Partial<World> = {}): void {
  w.now = new Date(w.now.getTime() + minutes * 60_000);
  Object.assign(w, patch);
}

export function discovered(mint = MINT, source = "geckoterminal:new_pools", createdAt = new Date(Date.now() - 60 * 60_000).toISOString()): DiscoveredToken {
  return { chain: "solana", mint, symbol: "TEST", name: "Test Token", pairAddress: "PAIR111111111111111111111111111111111111111", createdAt, source, observedAt: new Date().toISOString(), liquidityUsd: 45_000, volumeH1Usd: 15_000 };
}

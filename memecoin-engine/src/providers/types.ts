import type { Chain } from "../core/types.js";
import type {
  Candle,
  DeployerInfo,
  DiscoveredToken,
  HolderInfo,
  MarketSnapshot,
  SecurityInfo,
  SecurityReport,
  SocialSnapshot,
  TradeEvent,
  WalletProfile,
} from "../core/model.js";

/**
 * DataProvider abstraction (docs/DATA_SOURCES.md).
 * Each concrete provider implements one or more capability interfaces.
 * Callers go through ProviderRegistry, which handles fallback + health.
 */
export interface DataProvider {
  readonly id: string;
  readonly chains: Chain[];
  /** true when the provider has everything it needs (keys, urls). */
  isConfigured(): boolean;
  /** Cheap liveness probe (used by check:sources and health loop). */
  ping(): Promise<boolean>;
}

export interface BlockchainProvider extends DataProvider {
  readonly capability: "blockchain";
  getMintInfo(chain: Chain, mint: string): Promise<SecurityInfo>;
  getTopHolders(chain: Chain, mint: string, limit?: number): Promise<HolderInfo[]>;
  getDeployer(chain: Chain, mint: string): Promise<{ address: string; createdAt: string | null; signature: string | null } | null>;
  getWalletProfile(chain: Chain, address: string): Promise<WalletProfile>;
  getRecentTrades?(chain: Chain, pairAddress: string, mint: string, limit?: number): Promise<TradeEvent[]>;
}

export interface DEXProvider extends DataProvider {
  readonly capability: "dex";
  getNewPools(chain: Chain): Promise<DiscoveredToken[]>;
  getMarket(chain: Chain, mint: string): Promise<MarketSnapshot | null>;
  getTrades?(chain: Chain, pairAddress: string): Promise<TradeEvent[]>;
  getOhlcv?(chain: Chain, pairAddress: string, timeframe: "minute" | "hour", aggregate: number, limit: number): Promise<Candle[]>;
}

export interface MarketDataProvider extends DataProvider {
  readonly capability: "market";
  /** Curated / trending / boosted feeds used as discovery hints (never as quality signals). */
  getTrendingFeeds(chain: Chain): Promise<DiscoveredToken[]>;
}

export interface SecurityProvider extends DataProvider {
  readonly capability: "security";
  getReport(chain: Chain, mint: string): Promise<SecurityReport | null>;
  getNewTokens?(chain: Chain): Promise<DiscoveredToken[]>;
}

export interface SocialProvider extends DataProvider {
  readonly capability: "social";
  getSocial(chain: Chain, token: { mint: string; symbol: string | null; name: string | null; websites: string[]; socials: { type: string; url: string }[] }): Promise<Partial<SocialSnapshot>>;
}

export interface NewsProvider extends DataProvider {
  readonly capability: "news";
  getHeadlines(query: string): Promise<{ title: string; url: string; publishedAt: string; source: string }[]>;
}

export interface DiscoveryStream {
  readonly id: string;
  start(onToken: (t: DiscoveredToken) => void): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

export type AnyProvider = BlockchainProvider | DEXProvider | MarketDataProvider | SecurityProvider | SocialProvider | NewsProvider;
export type Capability = AnyProvider["capability"];

export type DeployerResolver = (chain: Chain, mint: string) => Promise<DeployerInfo | null>;

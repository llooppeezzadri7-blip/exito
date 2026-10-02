import type { Chain, DataPoint } from "./types.js";

export type Window = "m5" | "h1" | "h6" | "h24";
export const WINDOWS: Window[] = ["m5", "h1", "h6", "h24"];

export interface TxCounts {
  buys: number;
  sells: number;
}

export interface PairInfo {
  pairAddress: string;
  dexId: string;
  quoteSymbol: string | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volumeUsd: Partial<Record<Window, number | null>>;
  txns: Partial<Record<Window, TxCounts | null>>;
  priceChangePct: Partial<Record<Window, number | null>>;
  pairCreatedAt: string | null;
  source: string;
}

/** Aggregated market view of a token (usually from a DEX aggregator). */
export interface MarketSnapshot {
  priceUsd: DataPoint<number>;
  marketCapUsd: DataPoint<number>;
  fdvUsd: DataPoint<number>;
  liquidityUsd: DataPoint<number>;
  volumeUsd: Record<Window, number | null>;
  txns: Record<Window, TxCounts | null>;
  priceChangePct: Record<Window, number | null>;
  pairCreatedAt: string | null;
  primaryPair: PairInfo | null;
  pairs: PairInfo[];
  boostsActive: number | null;
  websites: string[];
  socials: { type: string; url: string }[];
  imageUrl: string | null;
  /** Symbol/name of the token itself (base side of the primary pair), never the quote asset. */
  baseSymbol: string | null;
  baseName: string | null;
  source: string;
  observedAt: string;
}

export interface SecurityInfo {
  mintAuthorityActive: DataPoint<boolean>;
  freezeAuthorityActive: DataPoint<boolean>;
  tokenProgram: DataPoint<string>;
  extensions: DataPoint<string[]>;
  supply: DataPoint<number>;
  decimals: DataPoint<number>;
  /** Token-2022 specific dangerous extensions */
  permanentDelegate: DataPoint<boolean>;
  transferHook: DataPoint<boolean>;
  transferFeeBps: DataPoint<number>;
  nonTransferable: DataPoint<boolean>;
  metadataMutable: DataPoint<boolean>;
  updateAuthority: DataPoint<string>;
  source: string;
  observedAt: string;
}

export interface HolderInfo {
  /** Token account or owner address (owner preferred when known). */
  address: string;
  owner: string | null;
  amount: number;
  pct: number;
  isLpPool: boolean;
  label: string | null;
}

export interface HoldersSnapshot {
  totalHolders: DataPoint<number>;
  top: HolderInfo[];
  lpLockedPct: DataPoint<number>;
  lpBurnedPct: DataPoint<number>;
  lpProviders: DataPoint<number>;
  source: string;
  observedAt: string;
}

export interface DeployerInfo {
  address: DataPoint<string>;
  walletAgeDays: DataPoint<number>;
  txCount: DataPoint<number>;
  previousTokens: DataPoint<number>;
  previousRuggedTokens: DataPoint<number>;
  fundedBy: DataPoint<string>;
  holdsPct: DataPoint<number>;
  /** Share of previous tokens still alive/liquid (0..1). */
  previousSurvivalRate: DataPoint<number>;
  source: string;
  observedAt: string;
}

export interface TradeEvent {
  ts: string;
  kind: "buy" | "sell";
  wallet: string | null;
  amountUsd: number | null;
  amountToken: number | null;
  priceUsd: number | null;
  txHash: string | null;
  source: string;
}

export interface Candle {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
}

export interface WalletProfile {
  address: string;
  firstSeenAt: DataPoint<string>;
  txCount: DataPoint<number>;
  fundedBy: DataPoint<string>;
  fundedAt: DataPoint<string>;
  /** SOL balance in native units (for context, not scoring). */
  balance: DataPoint<number>;
  source: string;
  observedAt: string;
}

export interface SecurityRisk {
  name: string;
  level: string;
  description: string;
  score: number | null;
}

/** Third-party security report (e.g. RugCheck). Never trusted alone; cross-checked with on-chain reads. */
export interface SecurityReport {
  /** Provider's raw score (semantics differ per provider). */
  rawScore: DataPoint<number>;
  /** Normalized 0..100, 100 = provider thinks it is as risky as it gets. */
  riskIndex: DataPoint<number>;
  risks: SecurityRisk[];
  rugged: DataPoint<boolean>;
  insidersDetected: DataPoint<number>;
  lpLockedPct: DataPoint<number>;
  totalHolders: DataPoint<number>;
  mintAuthorityActive: DataPoint<boolean>;
  freezeAuthorityActive: DataPoint<boolean>;
  creator: DataPoint<string>;
  topHolders: HolderInfo[];
  source: string;
  observedAt: string;
}

export interface SocialSnapshot {
  mentions1h: DataPoint<number>;
  mentions24h: DataPoint<number>;
  uniqueAuthors24h: DataPoint<number>;
  newAccountShare: DataPoint<number>; // 0..1 of authors younger than 30d
  engagement24h: DataPoint<number>;
  sentiment: DataPoint<number>; // -1..1
  telegramMembers: DataPoint<number>;
  twitterFollowers: DataPoint<number>;
  hasWebsite: boolean;
  hasTwitter: boolean;
  hasTelegram: boolean;
  keywords: string[];
  sources: string[];
  observedAt: string;
}

export interface TokenSnapshot {
  chain: Chain;
  mint: string;
  symbol: string | null;
  name: string | null;
  observedAt: string;
  /** Best estimate of token/pair creation time. */
  createdAt: string | null;
  market: MarketSnapshot | null;
  security: SecurityInfo | null;
  holders: HoldersSnapshot | null;
  deployer: DeployerInfo | null;
  securityReport: SecurityReport | null;
  trades: TradeEvent[];
  candles: Candle[];
  social: SocialSnapshot | null;
  walletProfiles: WalletProfile[];
  sources: string[];
  degradedSources: string[];
  /** 0..1 — share of critical fields that are known and fresh. */
  dataQuality: number;
}

export interface DiscoveredToken {
  chain: Chain;
  mint: string;
  symbol: string | null;
  name: string | null;
  pairAddress: string | null;
  createdAt: string | null;
  source: string;
  observedAt: string;
  /** Optional hints for early triage (may be null). */
  liquidityUsd: number | null;
  volumeH1Usd: number | null;
  raw?: unknown;
}

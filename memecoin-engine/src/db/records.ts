import type { Chain, Confidence, MarketPhase, OpportunityCategory, RiskLevel, ThesisStatus, Tier, AlertType, Severity } from "../core/types.js";
import type { HolderInfo, PairInfo, TokenSnapshot, TradeEvent, WalletProfile } from "../core/model.js";

export type TokenStatus = "NEW" | "MONITORED" | "REJECTED" | "ARCHIVED";

export interface TokenRecord {
  chain: Chain;
  mint: string;
  symbol: string | null;
  name: string | null;
  createdAt: string | null;
  discoveredAt: string;
  discoverySources: string[];
  pairAddress: string | null;
  deployer: string | null;
  tier: Tier;
  status: TokenStatus;
  rejectReason: string | null;
  category: OpportunityCategory | null;
  lastScore: number | null;
  lastRisk: RiskLevel | null;
  lastAnalyzedAt: string | null;
  nextAnalyzeAt: string | null;
  cyclesBelowTier: number;
  updatedAt: string;
}

export interface SnapshotRecord {
  id?: number;
  chain: Chain;
  mint: string;
  observedAt: string;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volumeM5Usd: number | null;
  volumeH1Usd: number | null;
  volumeH24Usd: number | null;
  buysH1: number | null;
  sellsH1: number | null;
  buysM5: number | null;
  sellsM5: number | null;
  holders: number | null;
  uniqueBuyersH1: number | null;
  uniqueSellersH1: number | null;
  top10Pct: number | null;
  dataQuality: number;
  sources: string[];
  payload: TokenSnapshot;
}

export interface WalletRecord extends WalletProfile {
  chain: Chain;
  tags: string[];
  updatedAt: string;
}

export interface WalletClusterRecord {
  id: string;
  chain: Chain;
  mint: string;
  wallets: string[];
  kind: "POTENTIAL_CLUSTER";
  riskScore: number;
  supplyPct: number | null;
  evidence: { statement: string; data?: Record<string, unknown> }[];
  detectedAt: string;
}

export interface DeployerRecord {
  chain: Chain;
  address: string;
  tokensCreated: number;
  tokensRugged: number;
  tokensAbandoned: number;
  reputationScore: number | null;
  reputation: "UNKNOWN" | "POOR" | "MIXED" | "FAIR" | "GOOD";
  firstSeenAt: string | null;
  lastSeenAt: string;
  data: Record<string, unknown>;
}

export interface SocialMentionRecord {
  id?: number;
  chain: Chain;
  mint: string;
  platform: string;
  authorId: string | null;
  authorAgeDays: number | null;
  text: string | null;
  url: string | null;
  postedAt: string;
  engagement: number | null;
  source: string;
}

export interface SocialSnapshotRecord {
  id?: number;
  chain: Chain;
  mint: string;
  observedAt: string;
  mentions1h: number | null;
  mentions24h: number | null;
  uniqueAuthors24h: number | null;
  newAccountShare: number | null;
  engagement24h: number | null;
  sentiment: number | null;
  telegramMembers: number | null;
  twitterFollowers: number | null;
  score: number | null;
  sources: string[];
}

export interface NarrativeRecord {
  key: string;
  label: string;
  keywords: string[];
  tokensCount: number;
  mentions24h: number;
  momentum: number | null;
  freshness: number | null;
  saturation: number | null;
  firstSeenAt: string;
  updatedAt: string;
}

export interface RiskEventRecord {
  id?: number;
  chain: Chain;
  mint: string;
  type: string;
  severity: Severity;
  message: string;
  data: Record<string, unknown>;
  at: string;
}

export interface AlertRecord {
  id: string;
  chain: Chain;
  mint: string;
  type: AlertType;
  severity: Severity;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  channels: string[];
  deliveredTo: string[];
  createdAt: string;
  sentAt: string | null;
  error: string | null;
}

export interface ScoreBreakdownItem {
  factor: string;
  points: number;
  reason: string;
  independentSignal?: boolean;
}

export interface OpportunityRecord {
  chain: Chain;
  mint: string;
  score: number | null;
  category: OpportunityCategory;
  confidence: Confidence;
  phase: MarketPhase;
  risk: RiskLevel;
  rugRisk: number | null;
  exitRisk: number | null;
  dataQuality: number;
  thesis: ThesisStatus;
  breakdown: ScoreBreakdownItem[];
  subscores: Record<string, number | null>;
  whyDetected: string[];
  risks: string[];
  flags: string[];
  bullCase: string[];
  bearCase: string[];
  conflicts: string[];
  entryZones: Record<string, string> | null;
  statusText: string;
  gates: { gate: string; passed: boolean; detail: string }[];
  snapshotId: number | null;
  computedAt: string;
}

export interface PredictionRecord {
  id: string;
  chain: Chain;
  mint: string;
  madeAt: string;
  horizonHours: number;
  resolveAt: string;
  category: OpportunityCategory;
  score: number | null;
  confidence: Confidence;
  features: Record<string, number | null>;
  priceAt: number | null;
  marketCapAt: number | null;
  liquidityAt: number | null;
  modelVersion: string;
  resolved: boolean;
}

export type OutcomeLabel = "BIG_UP" | "UP" | "SIDEWAYS" | "DOWN" | "BIG_DOWN" | "RUG" | "LIQUIDITY_DRAIN" | "UNKNOWN";

export interface OutcomeRecord {
  id?: number;
  predictionId: string;
  chain: Chain;
  mint: string;
  horizonHours: number;
  priceAt: number | null;
  priceAfter: number | null;
  returnPct: number | null;
  maxReturnPct: number | null;
  minReturnPct: number | null;
  liquidityAt: number | null;
  liquidityAfter: number | null;
  label: OutcomeLabel;
  resolvedAt: string;
}

export interface PaperTradeRecord {
  id: string;
  chain: Chain;
  mint: string;
  symbol: string | null;
  openedAt: string;
  closedAt: string | null;
  entryPriceUsd: number;
  entryFillPriceUsd: number;
  sizeUsd: number;
  tokens: number;
  feesUsd: number;
  slippagePct: number;
  exitPriceUsd: number | null;
  exitFillPriceUsd: number | null;
  pnlUsd: number | null;
  pnlPct: number | null;
  peakPriceUsd: number;
  troughPriceUsd: number;
  maxDrawdownPct: number;
  reason: string;
  exitReason: string | null;
  scoreAtEntry: number | null;
  opportunityCategory: OpportunityCategory | null;
  status: "OPEN" | "CLOSED";
}

export interface ModelVersionRecord {
  version: string;
  kind: "RULE" | "STATISTICAL" | "ML";
  weights: Record<string, number>;
  metrics: Record<string, number | null>;
  notes: string;
  active: boolean;
  createdAt: string;
}

export interface AuditRecord {
  id?: number;
  at: string;
  actor: string;
  action: string;
  subject: string;
  data: Record<string, unknown>;
}

export interface JobRecord {
  id: number;
  queue: string;
  payload: Record<string, unknown>;
  runAt: string;
  attempts: number;
  maxAttempts: number;
  lockedAt: string | null;
  lastError: string | null;
  status: "PENDING" | "RUNNING" | "DONE" | "DEAD";
  createdAt: string;
  dedupeKey: string | null;
}

export interface HealthRecord {
  at: string;
  providers: Record<string, unknown>[];
  queue: Record<string, number>;
  counters: Record<string, number>;
  workers: Record<string, unknown>;
  dataLatencySec: number | null;
  errorRate: number | null;
}

export interface TokenListFilter {
  chain?: Chain;
  status?: TokenStatus | TokenStatus[];
  tier?: Tier;
  category?: OpportunityCategory | OpportunityCategory[];
  minScore?: number;
  maxAgeMinutes?: number;
  limit?: number;
  orderBy?: "score" | "discoveredAt" | "lastAnalyzedAt";
}

export type PoolRecord = PairInfo & { chain: Chain; mint: string; updatedAt: string };
export type HolderRecord = HolderInfo & { chain: Chain; mint: string; observedAt: string };
export type TradeRecord = TradeEvent & { chain: Chain; mint: string };

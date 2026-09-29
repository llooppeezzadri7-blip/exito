import type {
  AlertRecord,
  AuditRecord,
  DeployerRecord,
  HealthRecord,
  HolderRecord,
  JobRecord,
  ModelVersionRecord,
  NarrativeRecord,
  OpportunityRecord,
  OutcomeRecord,
  PaperTradeRecord,
  PoolRecord,
  PredictionRecord,
  RiskEventRecord,
  SnapshotRecord,
  SocialMentionRecord,
  SocialSnapshotRecord,
  TokenListFilter,
  TokenRecord,
  TradeRecord,
  WalletClusterRecord,
  WalletRecord,
} from "./records.js";
import type { Chain, AlertType } from "../core/types.js";

/**
 * Persistence boundary. Two implementations: PostgresStore (production) and MemoryStore (tests/dev).
 * Every record carries timestamps; nothing is ever silently overwritten without `updatedAt`.
 */
export interface Store {
  init(): Promise<void>;
  close(): Promise<void>;

  // tokens
  upsertToken(t: TokenRecord): Promise<void>;
  getToken(chain: Chain, mint: string): Promise<TokenRecord | null>;
  patchToken(chain: Chain, mint: string, patch: Partial<TokenRecord>): Promise<void>;
  listTokens(filter?: TokenListFilter): Promise<TokenRecord[]>;
  listDueTokens(nowIso: string, limit: number): Promise<TokenRecord[]>;
  countTokens(): Promise<Record<string, number>>;

  // snapshots
  insertSnapshot(s: SnapshotRecord): Promise<number>;
  listSnapshots(chain: Chain, mint: string, sinceIso: string | null, limit?: number): Promise<SnapshotRecord[]>;
  latestSnapshot(chain: Chain, mint: string): Promise<SnapshotRecord | null>;
  /** Cross-token sample of a metric for anomaly baselines (most recent N snapshots). */
  sampleMetric(metric: "volumeH1Usd" | "liquidityUsd" | "holders" | "buysH1", limit: number): Promise<number[]>;
  pruneSnapshots(olderThanIso: string): Promise<number>;

  // pools / holders / trades / wallets
  upsertPools(pools: PoolRecord[]): Promise<void>;
  listPools(chain: Chain, mint: string): Promise<PoolRecord[]>;
  replaceHolders(chain: Chain, mint: string, holders: HolderRecord[]): Promise<void>;
  listHolders(chain: Chain, mint: string): Promise<HolderRecord[]>;
  insertTrades(trades: TradeRecord[]): Promise<number>;
  listTrades(chain: Chain, mint: string, sinceIso: string | null, limit?: number): Promise<TradeRecord[]>;
  upsertWallet(w: WalletRecord): Promise<void>;
  getWallets(chain: Chain, addresses: string[]): Promise<WalletRecord[]>;
  replaceClusters(chain: Chain, mint: string, clusters: WalletClusterRecord[]): Promise<void>;
  listClusters(chain: Chain, mint: string): Promise<WalletClusterRecord[]>;

  // deployers
  upsertDeployer(d: DeployerRecord): Promise<void>;
  getDeployer(chain: Chain, address: string): Promise<DeployerRecord | null>;
  listTokensByDeployer(chain: Chain, address: string): Promise<TokenRecord[]>;

  // social / narratives
  insertSocialMentions(m: SocialMentionRecord[]): Promise<number>;
  listSocialMentions(chain: Chain, mint: string, sinceIso: string): Promise<SocialMentionRecord[]>;
  insertSocialSnapshot(s: SocialSnapshotRecord): Promise<void>;
  listSocialSnapshots(chain: Chain, mint: string, sinceIso: string | null, limit?: number): Promise<SocialSnapshotRecord[]>;
  upsertNarrative(n: NarrativeRecord): Promise<void>;
  listNarratives(): Promise<NarrativeRecord[]>;

  // risk / alerts / opportunities
  insertRiskEvent(e: RiskEventRecord): Promise<void>;
  listRiskEvents(chain: Chain, mint: string, limit?: number): Promise<RiskEventRecord[]>;
  listRecentRiskEvents(sinceIso: string, limit?: number): Promise<RiskEventRecord[]>;
  insertAlert(a: AlertRecord): Promise<void>;
  patchAlert(id: string, patch: Partial<AlertRecord>): Promise<void>;
  listAlerts(opts?: { chain?: Chain; mint?: string; sinceIso?: string; limit?: number }): Promise<AlertRecord[]>;
  lastAlert(chain: Chain, mint: string, type: AlertType): Promise<AlertRecord | null>;
  upsertOpportunity(o: OpportunityRecord): Promise<void>;
  getOpportunity(chain: Chain, mint: string): Promise<OpportunityRecord | null>;
  listOpportunities(opts?: { categories?: string[]; minScore?: number; limit?: number }): Promise<OpportunityRecord[]>;

  // learning
  insertPrediction(p: PredictionRecord): Promise<void>;
  listPredictions(chain: Chain, mint: string, limit?: number): Promise<PredictionRecord[]>;
  listDuePredictions(nowIso: string, limit: number): Promise<PredictionRecord[]>;
  markPredictionResolved(id: string): Promise<void>;
  insertOutcome(o: OutcomeRecord): Promise<void>;
  listOutcomes(limit?: number): Promise<OutcomeRecord[]>;
  listPredictionsWithOutcomes(limit?: number): Promise<{ prediction: PredictionRecord; outcome: OutcomeRecord }[]>;
  insertModelVersion(m: ModelVersionRecord): Promise<void>;
  getActiveModel(kind: ModelVersionRecord["kind"]): Promise<ModelVersionRecord | null>;
  listModelVersions(): Promise<ModelVersionRecord[]>;

  // paper trading
  insertPaperTrade(t: PaperTradeRecord): Promise<void>;
  patchPaperTrade(id: string, patch: Partial<PaperTradeRecord>): Promise<void>;
  listPaperTrades(opts?: { status?: "OPEN" | "CLOSED"; limit?: number }): Promise<PaperTradeRecord[]>;
  getOpenPaperTrade(chain: Chain, mint: string): Promise<PaperTradeRecord | null>;

  // audit / jobs / health
  insertAudit(a: AuditRecord): Promise<void>;
  listAudit(opts?: { subject?: string; limit?: number }): Promise<AuditRecord[]>;
  enqueueJob(queue: string, payload: Record<string, unknown>, opts?: { runAt?: string; maxAttempts?: number; dedupeKey?: string }): Promise<number | null>;
  claimJobs(queue: string, nowIso: string, limit: number): Promise<JobRecord[]>;
  completeJob(id: number): Promise<void>;
  failJob(id: number, error: string, retryAtIso: string | null): Promise<void>;
  queueStats(): Promise<Record<string, number>>;
  listDeadJobs(limit?: number): Promise<JobRecord[]>;
  requeueDeadJob(id: number): Promise<void>;
  saveHealth(h: HealthRecord): Promise<void>;
  latestHealth(): Promise<HealthRecord | null>;
}

import type { Store } from "./store.js";
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
import type { AlertType, Chain } from "../core/types.js";

const k = (chain: string, mint: string) => `${chain}:${mint}`;

/**
 * In-memory Store for tests and keyless local runs. Not durable — the process restart loses everything.
 * Mirrors PostgresStore semantics (ordering, dedupe, retention) so pipeline tests are representative.
 */
export class MemoryStore implements Store {
  tokens = new Map<string, TokenRecord>();
  snapshots: SnapshotRecord[] = [];
  pools = new Map<string, PoolRecord[]>();
  holders = new Map<string, HolderRecord[]>();
  trades: TradeRecord[] = [];
  wallets = new Map<string, WalletRecord>();
  clusters = new Map<string, WalletClusterRecord[]>();
  deployers = new Map<string, DeployerRecord>();
  mentions: SocialMentionRecord[] = [];
  socialSnapshots: SocialSnapshotRecord[] = [];
  narratives = new Map<string, NarrativeRecord>();
  riskEvents: RiskEventRecord[] = [];
  alerts: AlertRecord[] = [];
  opportunities = new Map<string, OpportunityRecord>();
  predictions = new Map<string, PredictionRecord>();
  outcomes: OutcomeRecord[] = [];
  models: ModelVersionRecord[] = [];
  paperTrades = new Map<string, PaperTradeRecord>();
  audit: AuditRecord[] = [];
  jobs: JobRecord[] = [];
  health: HealthRecord[] = [];
  private seq = 1;

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async upsertToken(t: TokenRecord): Promise<void> {
    this.tokens.set(k(t.chain, t.mint), { ...t });
  }
  async getToken(chain: Chain, mint: string): Promise<TokenRecord | null> {
    return this.tokens.get(k(chain, mint)) ?? null;
  }
  async patchToken(chain: Chain, mint: string, patch: Partial<TokenRecord>): Promise<void> {
    const t = this.tokens.get(k(chain, mint));
    if (t) Object.assign(t, patch, { updatedAt: new Date().toISOString() });
  }
  async listTokens(filter: TokenListFilter = {}): Promise<TokenRecord[]> {
    const now = Date.now();
    let arr = [...this.tokens.values()];
    if (filter.chain) arr = arr.filter((t) => t.chain === filter.chain);
    if (filter.status) {
      const s = Array.isArray(filter.status) ? filter.status : [filter.status];
      arr = arr.filter((t) => s.includes(t.status));
    }
    if (filter.tier) arr = arr.filter((t) => t.tier === filter.tier);
    if (filter.category) {
      const c = Array.isArray(filter.category) ? filter.category : [filter.category];
      arr = arr.filter((t) => t.category && c.includes(t.category));
    }
    if (filter.minScore !== undefined) arr = arr.filter((t) => (t.lastScore ?? -1) >= filter.minScore!);
    if (filter.maxAgeMinutes !== undefined) arr = arr.filter((t) => t.createdAt && now - new Date(t.createdAt).getTime() <= filter.maxAgeMinutes! * 60_000);
    const ob = filter.orderBy ?? "score";
    arr.sort((a, b) =>
      ob === "score" ? (b.lastScore ?? -1) - (a.lastScore ?? -1) : ob === "discoveredAt" ? b.discoveredAt.localeCompare(a.discoveredAt) : (b.lastAnalyzedAt ?? "").localeCompare(a.lastAnalyzedAt ?? ""),
    );
    return arr.slice(0, filter.limit ?? 100);
  }
  async listDueTokens(nowIso: string, limit: number): Promise<TokenRecord[]> {
    return [...this.tokens.values()]
      .filter((t) => (t.status === "NEW" || t.status === "MONITORED") && (!t.nextAnalyzeAt || t.nextAnalyzeAt <= nowIso))
      .sort((a, b) => b.tier - a.tier || (a.nextAnalyzeAt ?? "").localeCompare(b.nextAnalyzeAt ?? ""))
      .slice(0, limit);
  }
  async countTokens(): Promise<Record<string, number>> {
    const out: Record<string, number> = { total: 0, NEW: 0, MONITORED: 0, REJECTED: 0, ARCHIVED: 0, tier1: 0, tier2: 0, tier3: 0, tier4: 0 };
    for (const t of this.tokens.values()) {
      out.total!++;
      out[t.status] = (out[t.status] ?? 0) + 1;
      out[`tier${t.tier}`] = (out[`tier${t.tier}`] ?? 0) + 1;
      // status keys (NEW/MONITORED/REJECTED/ARCHIVED) win over the same-named category
      if (t.category && t.category !== "REJECTED") out[t.category] = (out[t.category] ?? 0) + 1;
    }
    return out;
  }

  async insertSnapshot(s: SnapshotRecord): Promise<number> {
    const id = this.seq++;
    this.snapshots.push({ ...s, id });
    return id;
  }
  async listSnapshots(chain: Chain, mint: string, sinceIso: string | null, limit = 500): Promise<SnapshotRecord[]> {
    return this.snapshots
      .filter((s) => s.chain === chain && s.mint === mint && (!sinceIso || s.observedAt >= sinceIso))
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
      .slice(-limit);
  }
  async latestSnapshot(chain: Chain, mint: string): Promise<SnapshotRecord | null> {
    const l = await this.listSnapshots(chain, mint, null, 1);
    return l[0] ?? null;
  }
  async sampleMetric(metric: "volumeH1Usd" | "liquidityUsd" | "holders" | "buysH1", limit: number): Promise<number[]> {
    return this.snapshots
      .slice(-limit)
      .map((s) => s[metric])
      .filter((v): v is number => typeof v === "number");
  }
  async pruneSnapshots(olderThanIso: string): Promise<number> {
    const before = this.snapshots.length;
    this.snapshots = this.snapshots.filter((s) => s.observedAt >= olderThanIso);
    return before - this.snapshots.length;
  }

  async upsertPools(pools: PoolRecord[]): Promise<void> {
    for (const p of pools) {
      const key = k(p.chain, p.mint);
      const arr = this.pools.get(key) ?? [];
      const idx = arr.findIndex((x) => x.pairAddress === p.pairAddress);
      if (idx >= 0) arr[idx] = p;
      else arr.push(p);
      this.pools.set(key, arr);
    }
  }
  async listPools(chain: Chain, mint: string): Promise<PoolRecord[]> {
    return this.pools.get(k(chain, mint)) ?? [];
  }
  async replaceHolders(chain: Chain, mint: string, holders: HolderRecord[]): Promise<void> {
    this.holders.set(k(chain, mint), holders);
  }
  async listHolders(chain: Chain, mint: string): Promise<HolderRecord[]> {
    return this.holders.get(k(chain, mint)) ?? [];
  }
  async insertTrades(trades: TradeRecord[]): Promise<number> {
    let n = 0;
    const seen = new Set(this.trades.map((t) => `${t.chain}:${t.mint}:${t.txHash ?? t.ts + t.wallet}`));
    for (const t of trades) {
      const key = `${t.chain}:${t.mint}:${t.txHash ?? t.ts + t.wallet}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.trades.push(t);
      n++;
    }
    return n;
  }
  async listTrades(chain: Chain, mint: string, sinceIso: string | null, limit = 1000): Promise<TradeRecord[]> {
    return this.trades
      .filter((t) => t.chain === chain && t.mint === mint && (!sinceIso || t.ts >= sinceIso))
      .sort((a, b) => a.ts.localeCompare(b.ts))
      .slice(-limit);
  }
  async upsertWallet(w: WalletRecord): Promise<void> {
    this.wallets.set(k(w.chain, w.address), w);
  }
  async getWallets(chain: Chain, addresses: string[]): Promise<WalletRecord[]> {
    return addresses.map((a) => this.wallets.get(k(chain, a))).filter((w): w is WalletRecord => !!w);
  }
  async replaceClusters(chain: Chain, mint: string, clusters: WalletClusterRecord[]): Promise<void> {
    this.clusters.set(k(chain, mint), clusters);
  }
  async listClusters(chain: Chain, mint: string): Promise<WalletClusterRecord[]> {
    return this.clusters.get(k(chain, mint)) ?? [];
  }

  async upsertDeployer(d: DeployerRecord): Promise<void> {
    this.deployers.set(k(d.chain, d.address), d);
  }
  async getDeployer(chain: Chain, address: string): Promise<DeployerRecord | null> {
    return this.deployers.get(k(chain, address)) ?? null;
  }
  async listTokensByDeployer(chain: Chain, address: string): Promise<TokenRecord[]> {
    return [...this.tokens.values()].filter((t) => t.chain === chain && t.deployer === address);
  }

  async insertSocialMentions(m: SocialMentionRecord[]): Promise<number> {
    const seen = new Set(this.mentions.map((x) => x.url ?? `${x.platform}:${x.authorId}:${x.postedAt}`));
    let n = 0;
    for (const x of m) {
      const key = x.url ?? `${x.platform}:${x.authorId}:${x.postedAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.mentions.push({ ...x, id: this.seq++ });
      n++;
    }
    return n;
  }
  async listSocialMentions(chain: Chain, mint: string, sinceIso: string): Promise<SocialMentionRecord[]> {
    return this.mentions.filter((m) => m.chain === chain && m.mint === mint && m.postedAt >= sinceIso);
  }
  async insertSocialSnapshot(s: SocialSnapshotRecord): Promise<void> {
    this.socialSnapshots.push({ ...s, id: this.seq++ });
  }
  async listSocialSnapshots(chain: Chain, mint: string, sinceIso: string | null, limit = 200): Promise<SocialSnapshotRecord[]> {
    return this.socialSnapshots
      .filter((s) => s.chain === chain && s.mint === mint && (!sinceIso || s.observedAt >= sinceIso))
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
      .slice(-limit);
  }
  async upsertNarrative(n: NarrativeRecord): Promise<void> {
    this.narratives.set(n.key, n);
  }
  async listNarratives(): Promise<NarrativeRecord[]> {
    return [...this.narratives.values()];
  }

  async insertRiskEvent(e: RiskEventRecord): Promise<void> {
    this.riskEvents.push({ ...e, id: this.seq++ });
  }
  async listRiskEvents(chain: Chain, mint: string, limit = 100): Promise<RiskEventRecord[]> {
    return this.riskEvents.filter((e) => e.chain === chain && e.mint === mint).slice(-limit).reverse();
  }
  async listRecentRiskEvents(sinceIso: string, limit = 100): Promise<RiskEventRecord[]> {
    return this.riskEvents.filter((e) => e.at >= sinceIso).slice(-limit).reverse();
  }
  async insertAlert(a: AlertRecord): Promise<void> {
    this.alerts.push({ ...a });
  }
  async patchAlert(id: string, patch: Partial<AlertRecord>): Promise<void> {
    const a = this.alerts.find((x) => x.id === id);
    if (a) Object.assign(a, patch);
  }
  async listAlerts(opts: { chain?: Chain; mint?: string; sinceIso?: string; limit?: number } = {}): Promise<AlertRecord[]> {
    return this.alerts
      .filter((a) => (!opts.chain || a.chain === opts.chain) && (!opts.mint || a.mint === opts.mint) && (!opts.sinceIso || a.createdAt >= opts.sinceIso))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, opts.limit ?? 100);
  }
  async lastAlert(chain: Chain, mint: string, type: AlertType): Promise<AlertRecord | null> {
    const l = this.alerts.filter((a) => a.chain === chain && a.mint === mint && a.type === type).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return l[0] ?? null;
  }
  async upsertOpportunity(o: OpportunityRecord): Promise<void> {
    this.opportunities.set(k(o.chain, o.mint), o);
  }
  async getOpportunity(chain: Chain, mint: string): Promise<OpportunityRecord | null> {
    return this.opportunities.get(k(chain, mint)) ?? null;
  }
  async listOpportunities(opts: { categories?: string[]; minScore?: number; limit?: number } = {}): Promise<OpportunityRecord[]> {
    return [...this.opportunities.values()]
      .filter((o) => (!opts.categories || opts.categories.includes(o.category)) && (opts.minScore === undefined || (o.score ?? -1) >= opts.minScore))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
      .slice(0, opts.limit ?? 50);
  }

  async insertPrediction(p: PredictionRecord): Promise<void> {
    this.predictions.set(p.id, { ...p });
  }
  async listPredictions(chain: Chain, mint: string, limit = 50): Promise<PredictionRecord[]> {
    return [...this.predictions.values()]
      .filter((p) => p.chain === chain && p.mint === mint)
      .sort((a, b) => b.madeAt.localeCompare(a.madeAt))
      .slice(0, limit);
  }
  async listDuePredictions(nowIso: string, limit: number): Promise<PredictionRecord[]> {
    return [...this.predictions.values()]
      .filter((p) => !p.resolved && p.resolveAt <= nowIso)
      .slice(0, limit);
  }
  async markPredictionResolved(id: string): Promise<void> {
    const p = this.predictions.get(id);
    if (p) p.resolved = true;
  }
  async insertOutcome(o: OutcomeRecord): Promise<void> {
    this.outcomes.push({ ...o, id: this.seq++ });
  }
  async listOutcomes(limit = 1000): Promise<OutcomeRecord[]> {
    return this.outcomes.slice(-limit);
  }
  async listPredictionsWithOutcomes(limit = 5000): Promise<{ prediction: PredictionRecord; outcome: OutcomeRecord }[]> {
    return this.outcomes
      .slice(-limit)
      .map((o) => ({ prediction: this.predictions.get(o.predictionId)!, outcome: o }))
      .filter((x) => !!x.prediction);
  }
  async insertModelVersion(m: ModelVersionRecord): Promise<void> {
    if (m.active) for (const x of this.models) if (x.kind === m.kind) x.active = false;
    this.models.push({ ...m });
  }
  async getActiveModel(kind: ModelVersionRecord["kind"]): Promise<ModelVersionRecord | null> {
    return this.models.filter((m) => m.kind === kind && m.active).at(-1) ?? null;
  }
  async listModelVersions(): Promise<ModelVersionRecord[]> {
    return [...this.models];
  }

  async insertPaperTrade(t: PaperTradeRecord): Promise<void> {
    this.paperTrades.set(t.id, { ...t });
  }
  async patchPaperTrade(id: string, patch: Partial<PaperTradeRecord>): Promise<void> {
    const t = this.paperTrades.get(id);
    if (t) Object.assign(t, patch);
  }
  async listPaperTrades(opts: { status?: "OPEN" | "CLOSED"; limit?: number } = {}): Promise<PaperTradeRecord[]> {
    return [...this.paperTrades.values()]
      .filter((t) => !opts.status || t.status === opts.status)
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
      .slice(0, opts.limit ?? 500);
  }
  async getOpenPaperTrade(chain: Chain, mint: string): Promise<PaperTradeRecord | null> {
    return [...this.paperTrades.values()].find((t) => t.chain === chain && t.mint === mint && t.status === "OPEN") ?? null;
  }

  async insertAudit(a: AuditRecord): Promise<void> {
    this.audit.push({ ...a, id: this.seq++ });
  }
  async listAudit(opts: { subject?: string; limit?: number } = {}): Promise<AuditRecord[]> {
    return this.audit
      .filter((a) => !opts.subject || a.subject === opts.subject)
      .slice(-(opts.limit ?? 100))
      .reverse();
  }
  async enqueueJob(queue: string, payload: Record<string, unknown>, opts: { runAt?: string; maxAttempts?: number; dedupeKey?: string } = {}): Promise<number | null> {
    if (opts.dedupeKey && this.jobs.some((j) => j.dedupeKey === opts.dedupeKey && (j.status === "PENDING" || j.status === "RUNNING"))) return null;
    const j: JobRecord = {
      id: this.seq++,
      queue,
      payload,
      runAt: opts.runAt ?? new Date().toISOString(),
      attempts: 0,
      maxAttempts: opts.maxAttempts ?? 5,
      lockedAt: null,
      lastError: null,
      status: "PENDING",
      createdAt: new Date().toISOString(),
      dedupeKey: opts.dedupeKey ?? null,
    };
    this.jobs.push(j);
    return j.id;
  }
  async claimJobs(queue: string, nowIso: string, limit: number): Promise<JobRecord[]> {
    const due = this.jobs.filter((j) => j.queue === queue && j.status === "PENDING" && j.runAt <= nowIso).sort((a, b) => a.runAt.localeCompare(b.runAt)).slice(0, limit);
    for (const j of due) {
      j.status = "RUNNING";
      j.lockedAt = nowIso;
      j.attempts++;
    }
    return due.map((j) => ({ ...j }));
  }
  async completeJob(id: number): Promise<void> {
    const j = this.jobs.find((x) => x.id === id);
    if (j) j.status = "DONE";
  }
  async failJob(id: number, error: string, retryAtIso: string | null): Promise<void> {
    const j = this.jobs.find((x) => x.id === id);
    if (!j) return;
    j.lastError = error;
    j.lockedAt = null;
    if (retryAtIso && j.attempts < j.maxAttempts) {
      j.status = "PENDING";
      j.runAt = retryAtIso;
    } else j.status = "DEAD";
  }
  async queueStats(): Promise<Record<string, number>> {
    const out: Record<string, number> = { PENDING: 0, RUNNING: 0, DONE: 0, DEAD: 0 };
    for (const j of this.jobs) out[j.status] = (out[j.status] ?? 0) + 1;
    return out;
  }
  async listDeadJobs(limit = 100): Promise<JobRecord[]> {
    return this.jobs.filter((j) => j.status === "DEAD").slice(-limit);
  }
  async requeueDeadJob(id: number): Promise<void> {
    const j = this.jobs.find((x) => x.id === id);
    if (j && j.status === "DEAD") {
      j.status = "PENDING";
      j.attempts = 0;
      j.runAt = new Date().toISOString();
    }
  }
  async saveHealth(h: HealthRecord): Promise<void> {
    this.health.push(h);
    if (this.health.length > 500) this.health.shift();
  }
  async latestHealth(): Promise<HealthRecord | null> {
    return this.health.at(-1) ?? null;
  }
}

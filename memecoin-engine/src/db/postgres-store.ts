import pg from "pg";
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
import { runMigrations } from "./migrate.js";

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Production Store on PostgreSQL (works with Supabase). All queries are parameterized. */
export class PostgresStore implements Store {
  readonly pool: pg.Pool;

  constructor(connectionString: string, opts: { max?: number } = {}) {
    this.pool = new pg.Pool({ connectionString, max: opts.max ?? 8, idleTimeoutMillis: 30_000 });
  }

  async init(): Promise<void> {
    await runMigrations(this.pool);
  }
  async close(): Promise<void> {
    await this.pool.end();
  }

  private async q<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.pool.query<T>(text, params);
    return r.rows;
  }

  // ---------- tokens ----------
  async upsertToken(t: TokenRecord): Promise<void> {
    await this.q(
      `INSERT INTO tokens (chain,mint,symbol,name,created_at,discovered_at,discovery_sources,pair_address,deployer,tier,status,reject_reason,category,last_score,last_risk,last_analyzed_at,next_analyze_at,cycles_below_tier,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,now())
       ON CONFLICT (chain,mint) DO UPDATE SET symbol=COALESCE(EXCLUDED.symbol,tokens.symbol), name=COALESCE(EXCLUDED.name,tokens.name),
         created_at=COALESCE(EXCLUDED.created_at,tokens.created_at), discovery_sources=(SELECT ARRAY(SELECT DISTINCT unnest(tokens.discovery_sources || EXCLUDED.discovery_sources))),
         pair_address=COALESCE(EXCLUDED.pair_address,tokens.pair_address), deployer=COALESCE(EXCLUDED.deployer,tokens.deployer),
         tier=EXCLUDED.tier, status=EXCLUDED.status, reject_reason=EXCLUDED.reject_reason, category=EXCLUDED.category, last_score=EXCLUDED.last_score,
         last_risk=EXCLUDED.last_risk, last_analyzed_at=EXCLUDED.last_analyzed_at, next_analyze_at=EXCLUDED.next_analyze_at, cycles_below_tier=EXCLUDED.cycles_below_tier, updated_at=now()`,
      [t.chain, t.mint, t.symbol, t.name, t.createdAt, t.discoveredAt, t.discoverySources, t.pairAddress, t.deployer, t.tier, t.status, t.rejectReason, t.category, t.lastScore, t.lastRisk, t.lastAnalyzedAt, t.nextAnalyzeAt, t.cyclesBelowTier],
    );
  }
  async getToken(chain: Chain, mint: string): Promise<TokenRecord | null> {
    const rows = await this.q("SELECT * FROM tokens WHERE chain=$1 AND mint=$2", [chain, mint]);
    return rows[0] ? tokenFromRow(rows[0]) : null;
  }
  async patchToken(chain: Chain, mint: string, patch: Partial<TokenRecord>): Promise<void> {
    const map: Record<string, string> = {
      symbol: "symbol", name: "name", createdAt: "created_at", pairAddress: "pair_address", deployer: "deployer", tier: "tier", status: "status",
      rejectReason: "reject_reason", category: "category", lastScore: "last_score", lastRisk: "last_risk", lastAnalyzedAt: "last_analyzed_at",
      nextAnalyzeAt: "next_analyze_at", cyclesBelowTier: "cycles_below_tier", discoverySources: "discovery_sources",
    };
    const sets: string[] = [];
    const params: unknown[] = [chain, mint];
    for (const [key, col] of Object.entries(map)) {
      if (key in patch) {
        params.push((patch as Record<string, unknown>)[key]);
        sets.push(`${col}=$${params.length}`);
      }
    }
    if (!sets.length) return;
    await this.q(`UPDATE tokens SET ${sets.join(",")}, updated_at=now() WHERE chain=$1 AND mint=$2`, params);
  }
  async listTokens(filter: TokenListFilter = {}): Promise<TokenRecord[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace("?", `$${params.length}`));
    };
    if (filter.chain) add("chain=?", filter.chain);
    if (filter.status) add("status = ANY(?)", Array.isArray(filter.status) ? filter.status : [filter.status]);
    if (filter.tier) add("tier=?", filter.tier);
    if (filter.category) add("category = ANY(?)", Array.isArray(filter.category) ? filter.category : [filter.category]);
    if (filter.minScore !== undefined) add("last_score >= ?", filter.minScore);
    if (filter.maxAgeMinutes !== undefined) add("created_at >= now() - (? * interval '1 minute')", filter.maxAgeMinutes);
    const order = filter.orderBy === "discoveredAt" ? "discovered_at DESC" : filter.orderBy === "lastAnalyzedAt" ? "last_analyzed_at DESC NULLS LAST" : "last_score DESC NULLS LAST";
    params.push(filter.limit ?? 100);
    const rows = await this.q(`SELECT * FROM tokens ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${order} LIMIT $${params.length}`, params);
    return rows.map(tokenFromRow);
  }
  async listDueTokens(nowIso: string, limit: number): Promise<TokenRecord[]> {
    const rows = await this.q(
      "SELECT * FROM tokens WHERE status IN ('NEW','MONITORED') AND (next_analyze_at IS NULL OR next_analyze_at <= $1) ORDER BY tier DESC, next_analyze_at ASC NULLS FIRST LIMIT $2",
      [nowIso, limit],
    );
    return rows.map(tokenFromRow);
  }
  async countTokens(): Promise<Record<string, number>> {
    const out: Record<string, number> = { total: 0, NEW: 0, MONITORED: 0, REJECTED: 0, ARCHIVED: 0, tier1: 0, tier2: 0, tier3: 0, tier4: 0 };
    for (const r of await this.q<{ status: string; n: string }>("SELECT status, count(*)::text n FROM tokens GROUP BY status")) {
      out[r.status] = Number(r.n);
      out.total! += Number(r.n);
    }
    for (const r of await this.q<{ tier: number; n: string }>("SELECT tier, count(*)::text n FROM tokens WHERE status IN ('NEW','MONITORED') GROUP BY tier")) out[`tier${r.tier}`] = Number(r.n);
    for (const r of await this.q<{ category: string; n: string }>("SELECT category, count(*)::text n FROM tokens WHERE category IS NOT NULL AND category <> 'REJECTED' GROUP BY category")) out[r.category] = Number(r.n);
    return out;
  }

  // ---------- snapshots ----------
  async insertSnapshot(s: SnapshotRecord): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query<{ id: string }>(
        `INSERT INTO token_snapshots (chain,mint,observed_at,price_usd,market_cap_usd,liquidity_usd,volume_m5_usd,volume_h1_usd,volume_h24_usd,buys_h1,sells_h1,buys_m5,sells_m5,holders,unique_buyers_h1,unique_sellers_h1,top10_pct,data_quality,sources,payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
        [s.chain, s.mint, s.observedAt, s.priceUsd, s.marketCapUsd, s.liquidityUsd, s.volumeM5Usd, s.volumeH1Usd, s.volumeH24Usd, s.buysH1, s.sellsH1, s.buysM5, s.sellsM5, s.holders, s.uniqueBuyersH1, s.uniqueSellersH1, s.top10Pct, s.dataQuality, s.sources, JSON.stringify(s.payload)],
      );
      const id = Number(r.rows[0]!.id);
      await client.query("INSERT INTO liquidity_snapshots (snapshot_id,chain,mint,observed_at,liquidity_usd,market_cap_usd,source) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, s.chain, s.mint, s.observedAt, s.liquidityUsd, s.marketCapUsd, s.payload.market?.source ?? null]);
      await client.query("INSERT INTO holder_snapshots (snapshot_id,chain,mint,observed_at,holders,top10_pct,source) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, s.chain, s.mint, s.observedAt, s.holders, s.top10Pct, s.payload.holders?.source ?? null]);
      await client.query("COMMIT");
      return id;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async listSnapshots(chain: Chain, mint: string, sinceIso: string | null, limit = 500): Promise<SnapshotRecord[]> {
    const rows = await this.q(
      `SELECT * FROM (SELECT * FROM token_snapshots WHERE chain=$1 AND mint=$2 ${sinceIso ? "AND observed_at >= $4" : ""} ORDER BY observed_at DESC LIMIT $3) t ORDER BY observed_at ASC`,
      sinceIso ? [chain, mint, limit, sinceIso] : [chain, mint, limit],
    );
    return rows.map(snapshotFromRow);
  }
  async latestSnapshot(chain: Chain, mint: string): Promise<SnapshotRecord | null> {
    const rows = await this.q("SELECT * FROM token_snapshots WHERE chain=$1 AND mint=$2 ORDER BY observed_at DESC LIMIT 1", [chain, mint]);
    return rows[0] ? snapshotFromRow(rows[0]) : null;
  }
  async sampleMetric(metric: "volumeH1Usd" | "liquidityUsd" | "holders" | "buysH1", limit: number): Promise<number[]> {
    const col = { volumeH1Usd: "volume_h1_usd", liquidityUsd: "liquidity_usd", holders: "holders", buysH1: "buys_h1" }[metric];
    const rows = await this.q<{ v: string }>(`SELECT ${col}::text v FROM token_snapshots WHERE ${col} IS NOT NULL ORDER BY observed_at DESC LIMIT $1`, [limit]);
    return rows.map((r) => Number(r.v));
  }
  async pruneSnapshots(olderThanIso: string): Promise<number> {
    const r = await this.pool.query("DELETE FROM token_snapshots WHERE observed_at < $1", [olderThanIso]);
    return r.rowCount ?? 0;
  }

  // ---------- pools / holders / trades / wallets ----------
  async upsertPools(pools: PoolRecord[]): Promise<void> {
    for (const p of pools) {
      await this.q(
        `INSERT INTO pools (chain,mint,pair_address,dex_id,quote_symbol,liquidity_usd,price_usd,pair_created_at,data,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
         ON CONFLICT (chain,mint,pair_address) DO UPDATE SET dex_id=EXCLUDED.dex_id, quote_symbol=EXCLUDED.quote_symbol, liquidity_usd=EXCLUDED.liquidity_usd, price_usd=EXCLUDED.price_usd, pair_created_at=COALESCE(EXCLUDED.pair_created_at,pools.pair_created_at), data=EXCLUDED.data, updated_at=now()`,
        [p.chain, p.mint, p.pairAddress, p.dexId, p.quoteSymbol, p.liquidityUsd, p.priceUsd, p.pairCreatedAt, JSON.stringify(p)],
      );
    }
  }
  async listPools(chain: Chain, mint: string): Promise<PoolRecord[]> {
    const rows = await this.q<{ data: PoolRecord; updated_at: Date }>("SELECT data, updated_at FROM pools WHERE chain=$1 AND mint=$2", [chain, mint]);
    return rows.map((r) => ({ ...r.data, updatedAt: r.updated_at.toISOString() }));
  }
  async replaceHolders(chain: Chain, mint: string, holders: HolderRecord[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM holders WHERE chain=$1 AND mint=$2", [chain, mint]);
      for (const h of holders) {
        await client.query("INSERT INTO holders (chain,mint,address,owner,amount,pct,is_lp_pool,label,observed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (chain,mint,address) DO NOTHING", [chain, mint, h.address, h.owner, h.amount, h.pct, h.isLpPool, h.label, h.observedAt]);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async listHolders(chain: Chain, mint: string): Promise<HolderRecord[]> {
    const rows = await this.q("SELECT * FROM holders WHERE chain=$1 AND mint=$2 ORDER BY pct DESC", [chain, mint]);
    return rows.map((r) => ({ chain: r.chain, mint: r.mint, address: r.address, owner: r.owner, amount: num(r.amount) ?? 0, pct: num(r.pct) ?? 0, isLpPool: r.is_lp_pool, label: r.label, observedAt: iso(r.observed_at)! }));
  }
  async insertTrades(trades: TradeRecord[]): Promise<number> {
    let n = 0;
    for (const t of trades) {
      const r = await this.pool.query(
        "INSERT INTO transactions (chain,mint,ts,kind,wallet,amount_usd,amount_token,price_usd,tx_hash,source,dedupe_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING",
        [t.chain, t.mint, t.ts, t.kind, t.wallet, t.amountUsd, t.amountToken, t.priceUsd, t.txHash, t.source, t.txHash ?? `${t.ts}:${t.wallet}`],
      );
      n += r.rowCount ?? 0;
    }
    return n;
  }
  async listTrades(chain: Chain, mint: string, sinceIso: string | null, limit = 1000): Promise<TradeRecord[]> {
    const rows = await this.q(
      `SELECT * FROM (SELECT * FROM transactions WHERE chain=$1 AND mint=$2 ${sinceIso ? "AND ts >= $4" : ""} ORDER BY ts DESC LIMIT $3) t ORDER BY ts ASC`,
      sinceIso ? [chain, mint, limit, sinceIso] : [chain, mint, limit],
    );
    return rows.map((r) => ({ chain: r.chain, mint: r.mint, ts: iso(r.ts)!, kind: r.kind, wallet: r.wallet, amountUsd: num(r.amount_usd), amountToken: num(r.amount_token), priceUsd: num(r.price_usd), txHash: r.tx_hash, source: r.source }));
  }
  async upsertWallet(w: WalletRecord): Promise<void> {
    await this.q(
      `INSERT INTO wallets (chain,address,first_seen_at,tx_count,funded_by,funded_at,balance,tags,data,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
       ON CONFLICT (chain,address) DO UPDATE SET first_seen_at=EXCLUDED.first_seen_at, tx_count=EXCLUDED.tx_count, funded_by=EXCLUDED.funded_by, funded_at=EXCLUDED.funded_at, balance=EXCLUDED.balance, tags=EXCLUDED.tags, data=EXCLUDED.data, updated_at=now()`,
      [w.chain, w.address, w.firstSeenAt.value, w.txCount.value, w.fundedBy.value, w.fundedAt.value, w.balance.value, w.tags, JSON.stringify(w)],
    );
  }
  async getWallets(chain: Chain, addresses: string[]): Promise<WalletRecord[]> {
    if (!addresses.length) return [];
    const rows = await this.q<{ data: WalletRecord; updated_at: Date }>("SELECT data, updated_at FROM wallets WHERE chain=$1 AND address = ANY($2)", [chain, addresses]);
    return rows.map((r) => ({ ...r.data, updatedAt: r.updated_at.toISOString() }));
  }
  async replaceClusters(chain: Chain, mint: string, clusters: WalletClusterRecord[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM wallet_clusters WHERE chain=$1 AND mint=$2", [chain, mint]);
      for (const c of clusters) {
        await client.query("INSERT INTO wallet_clusters (id,chain,mint,wallets,kind,risk_score,supply_pct,evidence,detected_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [c.id, chain, mint, c.wallets, c.kind, c.riskScore, c.supplyPct, JSON.stringify(c.evidence), c.detectedAt]);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async listClusters(chain: Chain, mint: string): Promise<WalletClusterRecord[]> {
    const rows = await this.q("SELECT * FROM wallet_clusters WHERE chain=$1 AND mint=$2 ORDER BY risk_score DESC", [chain, mint]);
    return rows.map((r) => ({ id: r.id, chain: r.chain, mint: r.mint, wallets: r.wallets, kind: r.kind, riskScore: num(r.risk_score) ?? 0, supplyPct: num(r.supply_pct), evidence: r.evidence, detectedAt: iso(r.detected_at)! }));
  }

  // ---------- deployers ----------
  async upsertDeployer(d: DeployerRecord): Promise<void> {
    await this.q(
      `INSERT INTO deployers (chain,address,tokens_created,tokens_rugged,tokens_abandoned,reputation_score,reputation,first_seen_at,last_seen_at,data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (chain,address) DO UPDATE SET tokens_created=EXCLUDED.tokens_created, tokens_rugged=EXCLUDED.tokens_rugged, tokens_abandoned=EXCLUDED.tokens_abandoned, reputation_score=EXCLUDED.reputation_score, reputation=EXCLUDED.reputation, first_seen_at=COALESCE(EXCLUDED.first_seen_at,deployers.first_seen_at), last_seen_at=EXCLUDED.last_seen_at, data=EXCLUDED.data`,
      [d.chain, d.address, d.tokensCreated, d.tokensRugged, d.tokensAbandoned, d.reputationScore, d.reputation, d.firstSeenAt, d.lastSeenAt, JSON.stringify(d.data)],
    );
  }
  async getDeployer(chain: Chain, address: string): Promise<DeployerRecord | null> {
    const rows = await this.q("SELECT * FROM deployers WHERE chain=$1 AND address=$2", [chain, address]);
    const r = rows[0];
    return r ? { chain: r.chain, address: r.address, tokensCreated: r.tokens_created, tokensRugged: r.tokens_rugged, tokensAbandoned: r.tokens_abandoned, reputationScore: num(r.reputation_score), reputation: r.reputation, firstSeenAt: iso(r.first_seen_at), lastSeenAt: iso(r.last_seen_at)!, data: r.data } : null;
  }
  async listTokensByDeployer(chain: Chain, address: string): Promise<TokenRecord[]> {
    return (await this.q("SELECT * FROM tokens WHERE chain=$1 AND deployer=$2", [chain, address])).map(tokenFromRow);
  }

  // ---------- social ----------
  async insertSocialMentions(m: SocialMentionRecord[]): Promise<number> {
    let n = 0;
    for (const x of m) {
      const r = await this.pool.query(
        "INSERT INTO social_mentions (chain,mint,platform,author_id,author_age_days,text,url,posted_at,engagement,source,dedupe_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING",
        [x.chain, x.mint, x.platform, x.authorId, x.authorAgeDays, x.text, x.url, x.postedAt, x.engagement, x.source, x.url ?? `${x.platform}:${x.authorId}:${x.postedAt}`],
      );
      n += r.rowCount ?? 0;
    }
    return n;
  }
  async listSocialMentions(chain: Chain, mint: string, sinceIso: string): Promise<SocialMentionRecord[]> {
    const rows = await this.q("SELECT * FROM social_mentions WHERE chain=$1 AND mint=$2 AND posted_at >= $3 ORDER BY posted_at", [chain, mint, sinceIso]);
    return rows.map((r) => ({ id: Number(r.id), chain: r.chain, mint: r.mint, platform: r.platform, authorId: r.author_id, authorAgeDays: num(r.author_age_days), text: r.text, url: r.url, postedAt: iso(r.posted_at)!, engagement: num(r.engagement), source: r.source }));
  }
  async insertSocialSnapshot(s: SocialSnapshotRecord): Promise<void> {
    await this.q(
      "INSERT INTO social_snapshots (chain,mint,observed_at,mentions_1h,mentions_24h,unique_authors_24h,new_account_share,engagement_24h,sentiment,telegram_members,twitter_followers,score,sources) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      [s.chain, s.mint, s.observedAt, s.mentions1h, s.mentions24h, s.uniqueAuthors24h, s.newAccountShare, s.engagement24h, s.sentiment, s.telegramMembers, s.twitterFollowers, s.score, s.sources],
    );
  }
  async listSocialSnapshots(chain: Chain, mint: string, sinceIso: string | null, limit = 200): Promise<SocialSnapshotRecord[]> {
    const rows = await this.q(
      `SELECT * FROM (SELECT * FROM social_snapshots WHERE chain=$1 AND mint=$2 ${sinceIso ? "AND observed_at >= $4" : ""} ORDER BY observed_at DESC LIMIT $3) t ORDER BY observed_at ASC`,
      sinceIso ? [chain, mint, limit, sinceIso] : [chain, mint, limit],
    );
    return rows.map((r) => ({ id: Number(r.id), chain: r.chain, mint: r.mint, observedAt: iso(r.observed_at)!, mentions1h: r.mentions_1h, mentions24h: r.mentions_24h, uniqueAuthors24h: r.unique_authors_24h, newAccountShare: num(r.new_account_share), engagement24h: num(r.engagement_24h), sentiment: num(r.sentiment), telegramMembers: r.telegram_members, twitterFollowers: r.twitter_followers, score: num(r.score), sources: r.sources }));
  }
  async upsertNarrative(n: NarrativeRecord): Promise<void> {
    await this.q(
      `INSERT INTO narratives (key,label,keywords,tokens_count,mentions_24h,momentum,freshness,saturation,first_seen_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (key) DO UPDATE SET label=EXCLUDED.label, keywords=EXCLUDED.keywords, tokens_count=EXCLUDED.tokens_count, mentions_24h=EXCLUDED.mentions_24h, momentum=EXCLUDED.momentum, freshness=EXCLUDED.freshness, saturation=EXCLUDED.saturation, updated_at=EXCLUDED.updated_at`,
      [n.key, n.label, n.keywords, n.tokensCount, n.mentions24h, n.momentum, n.freshness, n.saturation, n.firstSeenAt, n.updatedAt],
    );
  }
  async listNarratives(): Promise<NarrativeRecord[]> {
    const rows = await this.q("SELECT * FROM narratives ORDER BY momentum DESC NULLS LAST");
    return rows.map((r) => ({ key: r.key, label: r.label, keywords: r.keywords, tokensCount: r.tokens_count, mentions24h: r.mentions_24h, momentum: num(r.momentum), freshness: num(r.freshness), saturation: num(r.saturation), firstSeenAt: iso(r.first_seen_at)!, updatedAt: iso(r.updated_at)! }));
  }

  // ---------- risk / alerts / opportunities ----------
  async insertRiskEvent(e: RiskEventRecord): Promise<void> {
    await this.q("INSERT INTO risk_events (chain,mint,type,severity,message,data,at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [e.chain, e.mint, e.type, e.severity, e.message, JSON.stringify(e.data), e.at]);
  }
  async listRiskEvents(chain: Chain, mint: string, limit = 100): Promise<RiskEventRecord[]> {
    return (await this.q("SELECT * FROM risk_events WHERE chain=$1 AND mint=$2 ORDER BY at DESC LIMIT $3", [chain, mint, limit])).map(riskFromRow);
  }
  async listRecentRiskEvents(sinceIso: string, limit = 100): Promise<RiskEventRecord[]> {
    return (await this.q("SELECT * FROM risk_events WHERE at >= $1 ORDER BY at DESC LIMIT $2", [sinceIso, limit])).map(riskFromRow);
  }
  async insertAlert(a: AlertRecord): Promise<void> {
    await this.q("INSERT INTO alerts (id,chain,mint,type,severity,title,body,payload,channels,delivered_to,created_at,sent_at,error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING", [a.id, a.chain, a.mint, a.type, a.severity, a.title, a.body, JSON.stringify(a.payload), a.channels, a.deliveredTo, a.createdAt, a.sentAt, a.error]);
  }
  async patchAlert(id: string, patch: Partial<AlertRecord>): Promise<void> {
    await this.q("UPDATE alerts SET delivered_to=COALESCE($2,delivered_to), sent_at=COALESCE($3,sent_at), error=$4 WHERE id=$1", [id, patch.deliveredTo ?? null, patch.sentAt ?? null, patch.error ?? null]);
  }
  async listAlerts(opts: { chain?: Chain; mint?: string; sinceIso?: string; limit?: number } = {}): Promise<AlertRecord[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.chain) { params.push(opts.chain); where.push(`chain=$${params.length}`); }
    if (opts.mint) { params.push(opts.mint); where.push(`mint=$${params.length}`); }
    if (opts.sinceIso) { params.push(opts.sinceIso); where.push(`created_at>=$${params.length}`); }
    params.push(opts.limit ?? 100);
    const rows = await this.q(`SELECT * FROM alerts ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT $${params.length}`, params);
    return rows.map(alertFromRow);
  }
  async lastAlert(chain: Chain, mint: string, type: AlertType): Promise<AlertRecord | null> {
    const rows = await this.q("SELECT * FROM alerts WHERE chain=$1 AND mint=$2 AND type=$3 ORDER BY created_at DESC LIMIT 1", [chain, mint, type]);
    return rows[0] ? alertFromRow(rows[0]) : null;
  }
  async upsertOpportunity(o: OpportunityRecord): Promise<void> {
    await this.q(
      `INSERT INTO opportunities (chain,mint,score,category,confidence,phase,risk,rug_risk,exit_risk,data_quality,thesis,data,snapshot_id,computed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (chain,mint) DO UPDATE SET score=EXCLUDED.score, category=EXCLUDED.category, confidence=EXCLUDED.confidence, phase=EXCLUDED.phase, risk=EXCLUDED.risk, rug_risk=EXCLUDED.rug_risk, exit_risk=EXCLUDED.exit_risk, data_quality=EXCLUDED.data_quality, thesis=EXCLUDED.thesis, data=EXCLUDED.data, snapshot_id=EXCLUDED.snapshot_id, computed_at=EXCLUDED.computed_at`,
      [o.chain, o.mint, o.score, o.category, o.confidence, o.phase, o.risk, o.rugRisk, o.exitRisk, o.dataQuality, o.thesis, JSON.stringify(o), o.snapshotId, o.computedAt],
    );
  }
  async getOpportunity(chain: Chain, mint: string): Promise<OpportunityRecord | null> {
    const rows = await this.q<{ data: OpportunityRecord }>("SELECT data FROM opportunities WHERE chain=$1 AND mint=$2", [chain, mint]);
    return rows[0]?.data ?? null;
  }
  async listOpportunities(opts: { categories?: string[]; minScore?: number; limit?: number } = {}): Promise<OpportunityRecord[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.categories) { params.push(opts.categories); where.push(`category = ANY($${params.length})`); }
    if (opts.minScore !== undefined) { params.push(opts.minScore); where.push(`score >= $${params.length}`); }
    params.push(opts.limit ?? 50);
    const rows = await this.q<{ data: OpportunityRecord }>(`SELECT data FROM opportunities ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY score DESC NULLS LAST LIMIT $${params.length}`, params);
    return rows.map((r) => r.data);
  }

  // ---------- learning ----------
  async insertPrediction(p: PredictionRecord): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO predictions (id,chain,mint,made_at,horizon_hours,resolve_at,category,score,confidence,features,price_at,market_cap_at,liquidity_at,model_version,resolved) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (id) DO NOTHING",
        [p.id, p.chain, p.mint, p.madeAt, p.horizonHours, p.resolveAt, p.category, p.score, p.confidence, JSON.stringify(p.features), p.priceAt, p.marketCapAt, p.liquidityAt, p.modelVersion, p.resolved],
      );
      for (const [name, value] of Object.entries(p.features)) {
        await client.query("INSERT INTO feature_values (prediction_id,name,value) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [p.id, name, value]);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async listPredictions(chain: Chain, mint: string, limit = 50): Promise<PredictionRecord[]> {
    return (await this.q("SELECT * FROM predictions WHERE chain=$1 AND mint=$2 ORDER BY made_at DESC LIMIT $3", [chain, mint, limit])).map(predictionFromRow);
  }
  async listDuePredictions(nowIso: string, limit: number): Promise<PredictionRecord[]> {
    return (await this.q("SELECT * FROM predictions WHERE resolved=false AND resolve_at <= $1 ORDER BY resolve_at LIMIT $2", [nowIso, limit])).map(predictionFromRow);
  }
  async markPredictionResolved(id: string): Promise<void> {
    await this.q("UPDATE predictions SET resolved=true WHERE id=$1", [id]);
  }
  async insertOutcome(o: OutcomeRecord): Promise<void> {
    await this.q("INSERT INTO outcomes (prediction_id,chain,mint,horizon_hours,price_at,price_after,return_pct,max_return_pct,min_return_pct,liquidity_at,liquidity_after,label,resolved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [o.predictionId, o.chain, o.mint, o.horizonHours, o.priceAt, o.priceAfter, o.returnPct, o.maxReturnPct, o.minReturnPct, o.liquidityAt, o.liquidityAfter, o.label, o.resolvedAt]);
  }
  async listOutcomes(limit = 1000): Promise<OutcomeRecord[]> {
    return (await this.q("SELECT * FROM outcomes ORDER BY resolved_at DESC LIMIT $1", [limit])).map(outcomeFromRow);
  }
  async listPredictionsWithOutcomes(limit = 5000): Promise<{ prediction: PredictionRecord; outcome: OutcomeRecord }[]> {
    const rows = await this.q("SELECT o.*, row_to_json(p.*) AS p FROM outcomes o JOIN predictions p ON p.id=o.prediction_id ORDER BY o.resolved_at DESC LIMIT $1", [limit]);
    return rows.map((r) => ({ outcome: outcomeFromRow(r), prediction: predictionFromRow(r.p) }));
  }
  async insertModelVersion(m: ModelVersionRecord): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (m.active) await client.query("UPDATE model_versions SET active=false WHERE kind=$1", [m.kind]);
      await client.query("INSERT INTO model_versions (version,kind,weights,metrics,notes,active,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (version) DO UPDATE SET weights=EXCLUDED.weights, metrics=EXCLUDED.metrics, notes=EXCLUDED.notes, active=EXCLUDED.active", [m.version, m.kind, JSON.stringify(m.weights), JSON.stringify(m.metrics), m.notes, m.active, m.createdAt]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async getActiveModel(kind: ModelVersionRecord["kind"]): Promise<ModelVersionRecord | null> {
    const rows = await this.q("SELECT * FROM model_versions WHERE kind=$1 AND active=true ORDER BY created_at DESC LIMIT 1", [kind]);
    return rows[0] ? modelFromRow(rows[0]) : null;
  }
  async listModelVersions(): Promise<ModelVersionRecord[]> {
    return (await this.q("SELECT * FROM model_versions ORDER BY created_at")).map(modelFromRow);
  }

  // ---------- paper trading ----------
  async insertPaperTrade(t: PaperTradeRecord): Promise<void> {
    await this.q(
      `INSERT INTO paper_trades (id,chain,mint,symbol,opened_at,closed_at,entry_price_usd,entry_fill_price_usd,size_usd,tokens,fees_usd,slippage_pct,exit_price_usd,exit_fill_price_usd,pnl_usd,pnl_pct,peak_price_usd,trough_price_usd,max_drawdown_pct,reason,exit_reason,score_at_entry,opportunity_category,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) ON CONFLICT (id) DO NOTHING`,
      [t.id, t.chain, t.mint, t.symbol, t.openedAt, t.closedAt, t.entryPriceUsd, t.entryFillPriceUsd, t.sizeUsd, t.tokens, t.feesUsd, t.slippagePct, t.exitPriceUsd, t.exitFillPriceUsd, t.pnlUsd, t.pnlPct, t.peakPriceUsd, t.troughPriceUsd, t.maxDrawdownPct, t.reason, t.exitReason, t.scoreAtEntry, t.opportunityCategory, t.status],
    );
  }
  async patchPaperTrade(id: string, patch: Partial<PaperTradeRecord>): Promise<void> {
    const map: Record<string, string> = { closedAt: "closed_at", exitPriceUsd: "exit_price_usd", exitFillPriceUsd: "exit_fill_price_usd", pnlUsd: "pnl_usd", pnlPct: "pnl_pct", peakPriceUsd: "peak_price_usd", troughPriceUsd: "trough_price_usd", maxDrawdownPct: "max_drawdown_pct", exitReason: "exit_reason", status: "status", feesUsd: "fees_usd" };
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [key, col] of Object.entries(map)) if (key in patch) { params.push((patch as Record<string, unknown>)[key]); sets.push(`${col}=$${params.length}`); }
    if (!sets.length) return;
    await this.q(`UPDATE paper_trades SET ${sets.join(",")} WHERE id=$1`, params);
  }
  async listPaperTrades(opts: { status?: "OPEN" | "CLOSED"; limit?: number } = {}): Promise<PaperTradeRecord[]> {
    const rows = opts.status
      ? await this.q("SELECT * FROM paper_trades WHERE status=$1 ORDER BY opened_at DESC LIMIT $2", [opts.status, opts.limit ?? 500])
      : await this.q("SELECT * FROM paper_trades ORDER BY opened_at DESC LIMIT $1", [opts.limit ?? 500]);
    return rows.map(paperFromRow);
  }
  async getOpenPaperTrade(chain: Chain, mint: string): Promise<PaperTradeRecord | null> {
    const rows = await this.q("SELECT * FROM paper_trades WHERE chain=$1 AND mint=$2 AND status='OPEN' LIMIT 1", [chain, mint]);
    return rows[0] ? paperFromRow(rows[0]) : null;
  }

  // ---------- audit / jobs / health ----------
  async insertAudit(a: AuditRecord): Promise<void> {
    await this.q("INSERT INTO audit_logs (at,actor,action,subject,data) VALUES ($1,$2,$3,$4,$5)", [a.at, a.actor, a.action, a.subject, JSON.stringify(a.data)]);
  }
  async listAudit(opts: { subject?: string; limit?: number } = {}): Promise<AuditRecord[]> {
    const rows = opts.subject
      ? await this.q("SELECT * FROM audit_logs WHERE subject=$1 ORDER BY at DESC LIMIT $2", [opts.subject, opts.limit ?? 100])
      : await this.q("SELECT * FROM audit_logs ORDER BY at DESC LIMIT $1", [opts.limit ?? 100]);
    return rows.map((r) => ({ id: Number(r.id), at: iso(r.at)!, actor: r.actor, action: r.action, subject: r.subject, data: r.data }));
  }
  async enqueueJob(queue: string, payload: Record<string, unknown>, opts: { runAt?: string; maxAttempts?: number; dedupeKey?: string } = {}): Promise<number | null> {
    const rows = await this.q<{ id: string }>(
      "INSERT INTO jobs (queue,payload,run_at,max_attempts,dedupe_key) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id",
      [queue, JSON.stringify(payload), opts.runAt ?? new Date().toISOString(), opts.maxAttempts ?? 5, opts.dedupeKey ?? null],
    );
    return rows[0] ? Number(rows[0].id) : null;
  }
  async claimJobs(queue: string, nowIso: string, limit: number): Promise<JobRecord[]> {
    const rows = await this.q(
      `UPDATE jobs SET status='RUNNING', locked_at=now(), attempts=attempts+1
       WHERE id IN (SELECT id FROM jobs WHERE queue=$1 AND status='PENDING' AND run_at <= $2 ORDER BY run_at LIMIT $3 FOR UPDATE SKIP LOCKED)
       RETURNING *`,
      [queue, nowIso, limit],
    );
    return rows.map(jobFromRow);
  }
  async completeJob(id: number): Promise<void> {
    await this.q("UPDATE jobs SET status='DONE', locked_at=NULL WHERE id=$1", [id]);
  }
  async failJob(id: number, error: string, retryAtIso: string | null): Promise<void> {
    await this.q(
      `UPDATE jobs SET last_error=$2, locked_at=NULL,
         status = CASE WHEN $3::timestamptz IS NOT NULL AND attempts < max_attempts THEN 'PENDING' ELSE 'DEAD' END,
         run_at = CASE WHEN $3::timestamptz IS NOT NULL AND attempts < max_attempts THEN $3::timestamptz ELSE run_at END
       WHERE id=$1`,
      [id, error, retryAtIso],
    );
  }
  async queueStats(): Promise<Record<string, number>> {
    const out: Record<string, number> = { PENDING: 0, RUNNING: 0, DONE: 0, DEAD: 0 };
    for (const r of await this.q<{ status: string; n: string }>("SELECT status, count(*)::text n FROM jobs GROUP BY status")) out[r.status] = Number(r.n);
    return out;
  }
  async listDeadJobs(limit = 100): Promise<JobRecord[]> {
    return (await this.q("SELECT * FROM jobs WHERE status='DEAD' ORDER BY id DESC LIMIT $1", [limit])).map(jobFromRow);
  }
  async requeueDeadJob(id: number): Promise<void> {
    await this.q("UPDATE jobs SET status='PENDING', attempts=0, run_at=now() WHERE id=$1 AND status='DEAD'", [id]);
  }
  async saveHealth(h: HealthRecord): Promise<void> {
    await this.q("INSERT INTO health_snapshots (at,data) VALUES ($1,$2)", [h.at, JSON.stringify(h)]);
    await this.q("DELETE FROM health_snapshots WHERE at < now() - interval '7 days'");
    await this.q("DELETE FROM jobs WHERE status='DONE' AND created_at < now() - interval '2 days'");
  }
  async latestHealth(): Promise<HealthRecord | null> {
    const rows = await this.q<{ data: HealthRecord }>("SELECT data FROM health_snapshots ORDER BY at DESC LIMIT 1");
    return rows[0]?.data ?? null;
  }
}

function tokenFromRow(r: pg.QueryResultRow): TokenRecord {
  return {
    chain: r.chain, mint: r.mint, symbol: r.symbol, name: r.name, createdAt: iso(r.created_at), discoveredAt: iso(r.discovered_at)!, discoverySources: r.discovery_sources ?? [],
    pairAddress: r.pair_address, deployer: r.deployer, tier: r.tier, status: r.status, rejectReason: r.reject_reason, category: r.category, lastScore: num(r.last_score), lastRisk: r.last_risk,
    lastAnalyzedAt: iso(r.last_analyzed_at), nextAnalyzeAt: iso(r.next_analyze_at), cyclesBelowTier: r.cycles_below_tier, updatedAt: iso(r.updated_at)!,
  };
}
function snapshotFromRow(r: pg.QueryResultRow): SnapshotRecord {
  return {
    id: Number(r.id), chain: r.chain, mint: r.mint, observedAt: iso(r.observed_at)!, priceUsd: num(r.price_usd), marketCapUsd: num(r.market_cap_usd), liquidityUsd: num(r.liquidity_usd),
    volumeM5Usd: num(r.volume_m5_usd), volumeH1Usd: num(r.volume_h1_usd), volumeH24Usd: num(r.volume_h24_usd), buysH1: r.buys_h1, sellsH1: r.sells_h1, buysM5: r.buys_m5, sellsM5: r.sells_m5,
    holders: r.holders, uniqueBuyersH1: r.unique_buyers_h1, uniqueSellersH1: r.unique_sellers_h1, top10Pct: num(r.top10_pct), dataQuality: num(r.data_quality) ?? 0, sources: r.sources ?? [], payload: r.payload,
  };
}
function riskFromRow(r: pg.QueryResultRow): RiskEventRecord {
  return { id: Number(r.id), chain: r.chain, mint: r.mint, type: r.type, severity: r.severity, message: r.message, data: r.data, at: iso(r.at)! };
}
function alertFromRow(r: pg.QueryResultRow): AlertRecord {
  return { id: r.id, chain: r.chain, mint: r.mint, type: r.type, severity: r.severity, title: r.title, body: r.body, payload: r.payload, channels: r.channels, deliveredTo: r.delivered_to, createdAt: iso(r.created_at)!, sentAt: iso(r.sent_at), error: r.error };
}
function predictionFromRow(r: pg.QueryResultRow): PredictionRecord {
  return { id: r.id, chain: r.chain, mint: r.mint, madeAt: iso(r.made_at)!, horizonHours: Number(r.horizon_hours), resolveAt: iso(r.resolve_at)!, category: r.category, score: num(r.score), confidence: r.confidence, features: r.features, priceAt: num(r.price_at), marketCapAt: num(r.market_cap_at), liquidityAt: num(r.liquidity_at), modelVersion: r.model_version, resolved: r.resolved };
}
function outcomeFromRow(r: pg.QueryResultRow): OutcomeRecord {
  return { id: Number(r.id), predictionId: r.prediction_id, chain: r.chain, mint: r.mint, horizonHours: Number(r.horizon_hours), priceAt: num(r.price_at), priceAfter: num(r.price_after), returnPct: num(r.return_pct), maxReturnPct: num(r.max_return_pct), minReturnPct: num(r.min_return_pct), liquidityAt: num(r.liquidity_at), liquidityAfter: num(r.liquidity_after), label: r.label, resolvedAt: iso(r.resolved_at)! };
}
function modelFromRow(r: pg.QueryResultRow): ModelVersionRecord {
  return { version: r.version, kind: r.kind, weights: r.weights, metrics: r.metrics, notes: r.notes, active: r.active, createdAt: iso(r.created_at)! };
}
function paperFromRow(r: pg.QueryResultRow): PaperTradeRecord {
  return {
    id: r.id, chain: r.chain, mint: r.mint, symbol: r.symbol, openedAt: iso(r.opened_at)!, closedAt: iso(r.closed_at), entryPriceUsd: Number(r.entry_price_usd), entryFillPriceUsd: Number(r.entry_fill_price_usd), sizeUsd: Number(r.size_usd), tokens: Number(r.tokens), feesUsd: Number(r.fees_usd), slippagePct: Number(r.slippage_pct),
    exitPriceUsd: num(r.exit_price_usd), exitFillPriceUsd: num(r.exit_fill_price_usd), pnlUsd: num(r.pnl_usd), pnlPct: num(r.pnl_pct), peakPriceUsd: Number(r.peak_price_usd), troughPriceUsd: Number(r.trough_price_usd), maxDrawdownPct: Number(r.max_drawdown_pct),
    reason: r.reason, exitReason: r.exit_reason, scoreAtEntry: num(r.score_at_entry), opportunityCategory: r.opportunity_category, status: r.status,
  };
}
function jobFromRow(r: pg.QueryResultRow): JobRecord {
  return { id: Number(r.id), queue: r.queue, payload: r.payload, runAt: iso(r.run_at)!, attempts: r.attempts, maxAttempts: r.max_attempts, lockedAt: iso(r.locked_at), lastError: r.last_error, status: r.status, createdAt: iso(r.created_at)!, dedupeKey: r.dedupe_key };
}

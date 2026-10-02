import { randomUUID } from "node:crypto";
import type { Tier } from "../core/types.js";
import type { EngineContext } from "./context.js";
import { bump } from "./context.js";
import { buildSnapshot } from "./build-snapshot.js";
import type { OpportunityRecord, PredictionRecord, TokenRecord } from "../db/records.js";
import { computeMetrics, type TokenMetrics } from "../analyzers/metrics.js";
import { analyzeSecurity } from "../analyzers/security.js";
import { analyzeLiquidity } from "../analyzers/liquidity.js";
import { analyzeHolders } from "../analyzers/holders.js";
import { analyzeDeployer, reputationLabel } from "../analyzers/deployer.js";
import { detectWalletClusters } from "../analyzers/wallet-cluster.js";
import { analyzeMicrostructure } from "../analyzers/microstructure.js";
import { analyzeSocial } from "../analyzers/social.js";
import { analyzeNarrative } from "../analyzers/narrative.js";
import { analyzeEarlyMomentum } from "../analyzers/early-momentum.js";
import { detectAnomalies } from "../analyzers/anomaly.js";
import { assessRugRisk } from "../risk/rug-detector.js";
import { assessPhase } from "../risk/phase.js";
import { evaluateGates } from "../risk/gates.js";
import { assessThesis } from "../risk/thesis.js";
import { adversarialAnalysis } from "../scoring/adversarial.js";
import { describeEntryZones } from "../scoring/entry-zones.js";
import { scoreOpportunity } from "../scoring/opportunity.js";
import type { AnalyzerResult } from "../core/types.js";
import type { TokenSnapshot } from "../core/model.js";
import { errMessage } from "../core/errors.js";

export interface AnalysisOutcome {
  token: TokenRecord;
  snapshot: TokenSnapshot;
  snapshotId: number;
  metrics: TokenMetrics;
  results: AnalyzerResult[];
  opportunity: OpportunityRecord;
  previous: OpportunityRecord | null;
  newFlags: string[];
  thesisReasons: string[];
  tierBefore: Tier;
  tierAfter: Tier;
}

/**
 * Full evaluation of one token: ingestion → analyzers → rug/phase/gates → score → thesis → persistence.
 * Idempotent per call; every run leaves a snapshot, an opportunity row and an audit log entry (AUDIT TRAIL).
 */
export async function analyzeToken(ctx: EngineContext, token: TokenRecord, opts: { hint?: { raw?: unknown }; learnedWeights?: Record<string, number> } = {}): Promise<AnalysisOutcome> {
  const { store, cfg } = ctx;
  const tier = token.tier;
  const now = ctx.now();
  const { snapshot, record, walletRecords } = await buildSnapshot(ctx, token, tier, opts.hint);
  const snapshotId = await store.insertSnapshot(record);
  bump(ctx, "snapshots");
  if (snapshot.market) {
    await store.upsertPools(snapshot.market.pairs.map((p) => ({ ...p, chain: token.chain, mint: token.mint, updatedAt: record.observedAt })));
  }
  if (snapshot.holders?.top.length) await store.replaceHolders(token.chain, token.mint, snapshot.holders.top.map((h) => ({ ...h, chain: token.chain, mint: token.mint, observedAt: snapshot.holders!.observedAt })));
  if (snapshot.trades.length) await store.insertTrades(snapshot.trades.map((t) => ({ ...t, chain: token.chain, mint: token.mint })));
  for (const w of walletRecords) await store.upsertWallet(w);

  // ---- series + metrics ----
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const series = await store.listSnapshots(token.chain, token.mint, since, 400);
  const metrics = computeMetrics(series, now);
  const allTrades = snapshot.trades.length ? snapshot.trades : (await store.listTrades(token.chain, token.mint, since, 500)).map((t) => t);

  // ---- analyzers ----
  const results: AnalyzerResult[] = [];
  const security = analyzeSecurity(snapshot);
  results.push(security);
  const liquidity = analyzeLiquidity(snapshot, metrics, cfg);
  results.push(liquidity);
  const holders = analyzeHolders({ ...snapshot, trades: allTrades }, metrics, cfg);
  results.push(holders);
  const deployerAddr = snapshot.deployer?.address.value ?? token.deployer ?? null;
  const deployerHist = deployerAddr ? await store.getDeployer(token.chain, deployerAddr) : null;
  results.push(analyzeDeployer(snapshot, deployerHist));
  const clusterOut = detectWalletClusters({
    chain: token.chain,
    mint: token.mint,
    holders: snapshot.holders?.top ?? [],
    trades: allTrades,
    wallets: snapshot.walletProfiles,
    deployer: deployerAddr,
    cfg: { minWallets: cfg.holders.cluster_min_wallets, timeWindowSec: cfg.holders.cluster_time_window_sec },
    now,
  });
  results.push(clusterOut.result);
  if (tier >= 3) await store.replaceClusters(token.chain, token.mint, clusterOut.clusters);
  results.push(analyzeMicrostructure({ ...snapshot, trades: allTrades }, metrics, cfg));
  const socialHistory = await store.listSocialSnapshots(token.chain, token.mint, since, 100);
  const social = analyzeSocial(snapshot.social, socialHistory, { spikeZ: cfg.social.spike_zscore, saturationPerHour: cfg.social.saturation_mentions_per_hour });
  results.push(social);
  if (snapshot.social && snapshot.social.sources.length) {
    await store.insertSocialSnapshot({
      chain: token.chain, mint: token.mint, observedAt: snapshot.social.observedAt,
      mentions1h: snapshot.social.mentions1h.value, mentions24h: snapshot.social.mentions24h.value, uniqueAuthors24h: snapshot.social.uniqueAuthors24h.value,
      newAccountShare: snapshot.social.newAccountShare.value, engagement24h: snapshot.social.engagement24h.value, sentiment: snapshot.social.sentiment.value,
      telegramMembers: snapshot.social.telegramMembers.value, twitterFollowers: snapshot.social.twitterFollowers.value, score: social.score, sources: snapshot.social.sources,
    });
  }
  const narrative = analyzeNarrative({ symbol: snapshot.symbol ?? token.symbol, name: snapshot.name ?? token.name, keywords: snapshot.social?.keywords }, await store.listNarratives());
  results.push(narrative);
  results.push(analyzeEarlyMomentum(snapshot, metrics, social.score));
  const [popVol, popLiq, popHold, popBuys] = await Promise.all([store.sampleMetric("volumeH1Usd", 500), store.sampleMetric("liquidityUsd", 500), store.sampleMetric("holders", 500), store.sampleMetric("buysH1", 500)]);
  results.push(detectAnomalies(metrics, { volumeH1Usd: popVol, liquidityUsd: popLiq, holders: popHold, buysH1: popBuys, ownVolumeH1: series.slice(0, -1).map((s) => s.volumeH1Usd).filter((v): v is number => v !== null), ownHolders: series.slice(0, -1).map((s) => s.holders).filter((v): v is number => v !== null) }, { spikeZ: cfg.social.spike_zscore }));

  // ---- risk + scoring ----
  const rug = assessRugRisk(results, { extreme: cfg.risk_gates.extreme_risk_rug_threshold });
  const insidersSelling = results.some((r) => r.flags.some((f) => f.code === "WHALE_DISTRIBUTION"));
  const phase = assessPhase(metrics, cfg.no_fomo, insidersSelling);
  const exitRisk = liquidity.metrics.exit_risk ?? null;
  const clusterSuspected = clusterOut.result.flags.some((f) => f.code === "SUSPICIOUS_WALLET_CLUSTER" && (f.severity === "CRITICAL" || f.severity === "HIGH"));
  const gates = evaluateGates(
    {
      rugRisk: rug.rugRisk,
      exitRisk,
      dataQuality: snapshot.dataQuality,
      securityScore: security.score,
      securityUnknown: security.score === null,
      clusterSuspected,
      mintAuthority: snapshot.security?.mintAuthorityActive.value ?? snapshot.securityReport?.mintAuthorityActive.value ?? null,
      freezeAuthority: snapshot.security?.freezeAuthorityActive.value ?? snapshot.securityReport?.freezeAuthorityActive.value ?? null,
      liquidityUsd: snapshot.market?.liquidityUsd.value ?? null,
      holders: record.holders,
    },
    cfg,
  );
  const adversarial = adversarialAnalysis(results, metrics);
  const scored = scoreOpportunity({ results, metrics, rug, gates, phase, adversarial, exitRisk, dataQuality: snapshot.dataQuality, narrativeSaturation: narrative.saturation, weights: opts.learnedWeights }, cfg);
  const previous = await store.getOpportunity(token.chain, token.mint);
  const flagCodes = [...new Set(results.flatMap((r) => r.flags.filter((f) => f.severity !== "INFO").map((f) => f.code)))];
  const thesis = assessThesis(previous, { score: scored.score, rugRisk: rug.rugRisk, category: scored.category, flags: flagCodes }, metrics);
  const opportunity: OpportunityRecord = {
    chain: token.chain,
    mint: token.mint,
    score: scored.score,
    category: scored.category,
    confidence: scored.confidence,
    phase: scored.phase,
    risk: scored.risk,
    rugRisk: rug.rugRisk,
    exitRisk,
    dataQuality: snapshot.dataQuality,
    thesis: thesis.status,
    breakdown: scored.breakdown,
    subscores: scored.subscores,
    whyDetected: scored.whyDetected,
    risks: scored.risks,
    flags: flagCodes,
    bullCase: adversarial.bull,
    bearCase: adversarial.bear,
    conflicts: adversarial.conflicts,
    entryZones: tier >= 2 ? describeEntryZones(series, metrics, scored.phase) : null,
    statusText: scored.statusText,
    gates: gates.gates,
    snapshotId,
    computedAt: now.toISOString(),
  };
  await store.upsertOpportunity(opportunity);

  // ---- risk events for new HIGH/CRITICAL flags ----
  const prevFlags = new Set(previous?.flags ?? []);
  const newFlags = flagCodes.filter((f) => !prevFlags.has(f));
  for (const r of results) {
    for (const f of r.flags) {
      if ((f.severity === "HIGH" || f.severity === "CRITICAL") && newFlags.includes(f.code)) {
        await store.insertRiskEvent({ chain: token.chain, mint: token.mint, type: f.code, severity: f.severity, message: f.message, data: { analyzer: r.analyzer, evidence: f.evidence ?? [] }, at: now.toISOString() });
        bump(ctx, "risk_events");
      }
    }
  }

  // ---- deployer bookkeeping ----
  if (deployerAddr) {
    const tokensBy = await store.listTokensByDeployer(token.chain, deployerAddr);
    const created = new Set(tokensBy.map((t) => t.mint));
    created.add(token.mint);
    const rugged = tokensBy.filter((t) => t.mint !== token.mint && (t.category === "EXTREME_RISK" || t.rejectReason?.includes("rug") || t.lastRisk === "EXTREME_RISK")).length + (rug.level === "EXTREME_RISK" && flagCodes.includes("LIQUIDITY_DROP") ? 1 : 0);
    const abandoned = tokensBy.filter((t) => t.mint !== token.mint && t.status === "ARCHIVED").length;
    const depScore = results.find((r) => r.analyzer === "deployer")?.score ?? null;
    await store.upsertDeployer({
      chain: token.chain, address: deployerAddr, tokensCreated: created.size, tokensRugged: rugged, tokensAbandoned: abandoned,
      reputationScore: depScore, reputation: reputationLabel(depScore), firstSeenAt: deployerHist?.firstSeenAt ?? token.createdAt ?? now.toISOString(), lastSeenAt: now.toISOString(),
      data: { lastToken: token.mint },
    });
  }

  // ---- predictions (learning ledger) ----
  if (tier >= 2 && scored.score !== null) {
    const last = (await store.listPredictions(token.chain, token.mint, 1))[0];
    if (!last || now.getTime() - new Date(last.madeAt).getTime() >= 3_600_000 || (previous && previous.category !== scored.category)) {
      const features: Record<string, number | null> = { ...metrics, ...scored.subscores, rug_risk: rug.rugRisk, exit_risk: exitRisk, data_quality: snapshot.dataQuality, phase_early: scored.phase === "EARLY" ? 1 : 0, conflicts: adversarial.conflicts.length };
      for (const r of results) for (const [k, v] of Object.entries(r.metrics)) if (!(k in features)) features[k] = v;
      for (const h of cfg.learning.horizons_hours) {
        const p: PredictionRecord = {
          id: randomUUID(), chain: token.chain, mint: token.mint, madeAt: now.toISOString(), horizonHours: h, resolveAt: new Date(now.getTime() + h * 3_600_000).toISOString(),
          category: scored.category, score: scored.score, confidence: scored.confidence, features, priceAt: record.priceUsd, marketCapAt: record.marketCapUsd, liquidityAt: record.liquidityUsd,
          modelVersion: opts.learnedWeights ? "statistical" : "rule-v1", resolved: false,
        };
        await store.insertPrediction(p);
      }
      bump(ctx, "predictions");
    }
  }

  // ---- tier / status update ----
  const tierAfter = nextTier(ctx, token, scored.score, scored.category, record, scored.subscores.early_momentum ?? null, gates.blockAsOpportunity);
  const status: TokenRecord["status"] = scored.category === "REJECTED" ? "REJECTED" : "MONITORED";
  const interval = status === "REJECTED" ? 6 * 3600 : cfg.tiers[tierAfter].interval_sec;
  const ageH = token.createdAt ? (now.getTime() - new Date(token.createdAt).getTime()) / 3_600_000 : 0;
  const archived = ageH > cfg.tiers[tierAfter].ttl_hours && tierAfter <= 2;
  const patch: Partial<TokenRecord> = {
    symbol: snapshot.symbol ?? token.symbol,
    name: snapshot.name ?? token.name,
    createdAt: snapshot.createdAt ?? token.createdAt,
    pairAddress: snapshot.market?.primaryPair?.pairAddress ?? token.pairAddress,
    deployer: deployerAddr ?? token.deployer,
    tier: tierAfter,
    status: archived ? "ARCHIVED" : status,
    rejectReason: scored.category === "REJECTED" ? gates.gates.filter((g) => !g.passed).map((g) => `${g.gate}: ${g.detail}`).join("; ") : null,
    category: scored.category,
    lastScore: scored.score,
    lastRisk: scored.risk,
    lastAnalyzedAt: now.toISOString(),
    nextAnalyzeAt: archived ? null : new Date(now.getTime() + interval * 1000).toISOString(),
    cyclesBelowTier: tierAfter < token.tier ? 0 : token.cyclesBelowTier,
  };
  await store.patchToken(token.chain, token.mint, patch);
  bump(ctx, "analyses");
  bump(ctx, `category_${scored.category}`);
  await store.insertAudit({
    at: now.toISOString(), actor: "engine", action: "analyze", subject: `${token.chain}:${token.mint}`,
    data: { snapshotId, tier, tierAfter, score: scored.score, category: scored.category, confidence: scored.confidence, phase: scored.phase, risk: scored.risk, rugRisk: rug.rugRisk, exitRisk, dataQuality: snapshot.dataQuality, sources: snapshot.sources, degraded: snapshot.degradedSources, flags: flagCodes, missingSignals: scored.missingSignals, gates: gates.gates.filter((g) => !g.passed), thesis: thesis.status },
  });
  return { token: { ...token, ...patch } as TokenRecord, snapshot, snapshotId, metrics, results, opportunity, previous, newFlags, thesisReasons: thesis.reasons, tierBefore: tier, tierAfter };
}

function nextTier(ctx: EngineContext, token: TokenRecord, score: number | null, category: string, rec: { liquidityUsd: number | null; volumeH1Usd: number | null }, earlyMomentum: number | null = null, gated = false): Tier {
  const p = ctx.cfg.tiers.promote;
  let t: Tier = token.tier;
  // Rejected/extreme tokens are re-checked cheaply but never below tier 2: authorities must stay verifiable (they can be revoked later).
  if (category === "REJECTED" || category === "EXTREME_RISK") return 2;
  if (t === 1 && (rec.liquidityUsd ?? 0) >= p.to_2_min_liquidity_usd && (rec.volumeH1Usd ?? 0) >= p.to_2_min_volume_h1_usd) t = 2;
  if (t === 2 && ((score !== null && score >= p.to_3_min_score) || (!gated && earlyMomentum !== null && earlyMomentum >= p.to_3_min_early_momentum))) t = 3;
  if (t === 3 && score !== null && score >= p.to_4_min_score) t = 4;
  // demotion after N cycles below the threshold of the current tier
  if (score !== null) {
    const momentumHolds = earlyMomentum !== null && earlyMomentum >= p.to_3_min_early_momentum - 10;
    const below = (t === 4 && score < p.to_4_min_score - 5) || (t === 3 && score < p.to_3_min_score - 5 && !momentumHolds);
    if (below) {
      token.cyclesBelowTier++;
      if (token.cyclesBelowTier >= ctx.cfg.tiers.demote_after_cycles_below) {
        t = (t - 1) as Tier;
        token.cyclesBelowTier = 0;
      }
    } else token.cyclesBelowTier = 0;
  }
  return t;
}

export async function safeAnalyze(ctx: EngineContext, token: TokenRecord): Promise<AnalysisOutcome | null> {
  try {
    return await analyzeToken(ctx, token);
  } catch (e) {
    ctx.log.error({ mint: token.mint, err: errMessage(e) }, "analysis failed");
    bump(ctx, "analysis_errors");
    await ctx.store.patchToken(token.chain, token.mint, { nextAnalyzeAt: new Date(ctx.now().getTime() + 5 * 60_000).toISOString() });
    return null;
  }
}

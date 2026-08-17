import type { BusinessSource } from "@/lib/database/types";
import { queryEvents, type LeadOutcome, type SourceQueryRecord } from "./research-memory";
import { checkAutonomousChange, type ConstraintCheck } from "./hard-constraints";

/**
 * FASE 2 — Learning engine.
 *
 * Turns the event log into statements about what worked, and into
 * *proposals*. It never applies anything by itself: every output carries a
 * constraint check, and anything touching verification or scoring comes back
 * as requiring approval. The system is allowed to get better at choosing
 * where to look; it is not allowed to get looser about what it will claim.
 *
 * Every statistic here also carries its sample size. A source that looked
 * brilliant across three queries has told us nothing yet, and hiding that
 * behind a percentage is how a learning system starts lying to its owner.
 */

/** Below this many observations, a statistic is reported but never acted on. */
export const MIN_SAMPLE_FOR_ACTION = 10;

export interface SourcePerformance {
  source: BusinessSource;
  queries: number;
  failures: number;
  recordsReturned: number;
  recordsUsable: number;
  /** Usable records per successful query. */
  yieldPerQuery: number;
  /** Share of returned records that survived dedupe and corroboration. */
  usableRatio: number;
  reliability: number;
  sampleSufficient: boolean;
}

export function sourcePerformance(filter: { municipality?: string; sector?: string } = {}): SourcePerformance[] {
  const events = queryEvents({ type: "SOURCE_QUERIED", ...filter });
  const bySource = new Map<BusinessSource, SourceQueryRecord[]>();

  for (const event of events) {
    const record = event.data as unknown as SourceQueryRecord;
    if (!record?.source) continue;
    bySource.set(record.source, [...(bySource.get(record.source) ?? []), record]);
  }

  return [...bySource.entries()]
    .map(([source, records]) => {
      const successes = records.filter((r) => r.ok);
      const returned = successes.reduce((sum, r) => sum + r.returned, 0);
      const usable = successes.reduce((sum, r) => sum + r.usable, 0);

      return {
        source,
        queries: records.length,
        failures: records.length - successes.length,
        recordsReturned: returned,
        recordsUsable: usable,
        yieldPerQuery: successes.length > 0 ? usable / successes.length : 0,
        usableRatio: returned > 0 ? usable / returned : 0,
        reliability: records.length > 0 ? successes.length / records.length : 0,
        sampleSufficient: records.length >= MIN_SAMPLE_FOR_ACTION,
      };
    })
    .sort((a, b) => b.yieldPerQuery - a.yieldPerQuery);
}

export interface StrategyPerformance {
  municipality: string;
  sector: string | null;
  queries: number;
  usable: number;
  yieldPerQuery: number;
  sampleSufficient: boolean;
}

/** Which municipality/sector combinations actually produce prospects. */
export function strategyPerformance(): StrategyPerformance[] {
  const events = queryEvents({ type: "SOURCE_QUERIED" });
  const byKey = new Map<string, { municipality: string; sector: string | null; queries: number; usable: number }>();

  for (const event of events) {
    const record = event.data as unknown as SourceQueryRecord;
    if (!record?.ok) continue;
    const key = `${record.municipality}::${record.sector ?? "-"}`;
    const current = byKey.get(key) ?? {
      municipality: record.municipality,
      sector: record.sector,
      queries: 0,
      usable: 0,
    };
    current.queries += 1;
    current.usable += record.usable;
    byKey.set(key, current);
  }

  return [...byKey.values()]
    .map((entry) => ({
      ...entry,
      yieldPerQuery: entry.queries > 0 ? entry.usable / entry.queries : 0,
      sampleSufficient: entry.queries >= MIN_SAMPLE_FOR_ACTION,
    }))
    .sort((a, b) => b.yieldPerQuery - a.yieldPerQuery);
}

export interface SignalPerformance {
  /** e.g. "score>=80", "sector=Hoteles", "recomendado=SEO local". */
  signal: string;
  won: number;
  lost: number;
  total: number;
  winRate: number;
  sampleSufficient: boolean;
}

const WON: LeadOutcome[] = ["WON"];

/**
 * Which signals actually preceded a sale. This is the only place where the
 * system can learn what a good lead looks like, because it is the only place
 * with ground truth instead of its own opinion.
 */
export function signalPerformance(): SignalPerformance[] {
  const outcomes = queryEvents({ type: "OUTCOME_RECORDED" });
  const buckets = new Map<string, { won: number; total: number }>();

  const bump = (signal: string, won: boolean) => {
    const current = buckets.get(signal) ?? { won: 0, total: 0 };
    current.total += 1;
    if (won) current.won += 1;
    buckets.set(signal, current);
  };

  for (const event of outcomes) {
    const data = event.data as {
      outcome: LeadOutcome;
      scoreAtTime: number;
      confidenceAtTime: number;
      recommendedService: string | null;
    };
    const won = WON.includes(data.outcome);

    const band =
      data.scoreAtTime >= 80 ? "score>=80" : data.scoreAtTime >= 60 ? "score 60-79" : "score<60";
    bump(band, won);
    bump(data.confidenceAtTime >= 0.8 ? "confianza>=80%" : "confianza<80%", won);
    if (data.recommendedService) bump(`servicio=${data.recommendedService}`, won);
  }

  return [...buckets.entries()]
    .map(([signal, { won, total }]) => ({
      signal,
      won,
      lost: total - won,
      total,
      winRate: total > 0 ? won / total : 0,
      sampleSufficient: total >= MIN_SAMPLE_FOR_ACTION,
    }))
    .sort((a, b) => b.winRate - a.winRate);
}

export type ProposalKind = "source_priority" | "municipality_order" | "sector_order" | "query_strategy";

export interface LearningProposal {
  kind: ProposalKind;
  statement: string;
  /** The observation it rests on, with its sample size in plain sight. */
  evidence: string;
  sampleSize: number;
  /** Whether it may be applied without a human. */
  constraint: ConstraintCheck;
  applicable: boolean;
}

/**
 * Produces proposals from what the log shows. Deliberately conservative: a
 * proposal below the sample threshold is still returned — so the reasoning is
 * visible — but marked as not applicable.
 */
export function buildProposals(): LearningProposal[] {
  const proposals: LearningProposal[] = [];

  const sources = sourcePerformance();
  if (sources.length >= 2) {
    const [best, worst] = [sources[0], sources[sources.length - 1]];
    if (best.source !== worst.source && best.yieldPerQuery > worst.yieldPerQuery) {
      const sample = Math.min(best.queries, worst.queries);
      const constraint = checkAutonomousChange("source_priority");
      proposals.push({
        kind: "source_priority",
        statement: `Consultar ${best.source} antes que ${worst.source}.`,
        evidence: `${best.source}: ${best.yieldPerQuery.toFixed(1)} negocios aprovechables por consulta en ${best.queries} consultas. ${worst.source}: ${worst.yieldPerQuery.toFixed(1)} en ${worst.queries}.`,
        sampleSize: sample,
        constraint,
        applicable: constraint.allowed && sample >= MIN_SAMPLE_FOR_ACTION,
      });
    }
  }

  const strategies = strategyPerformance();
  if (strategies.length >= 2) {
    const best = strategies[0];
    const constraint = checkAutonomousChange("municipality_order");
    proposals.push({
      kind: "municipality_order",
      statement: `Priorizar ${best.municipality}${best.sector ? ` / ${best.sector}` : ""} en los próximos barridos.`,
      evidence: `${best.yieldPerQuery.toFixed(1)} negocios aprovechables por consulta en ${best.queries} consultas.`,
      sampleSize: best.queries,
      constraint,
      applicable: constraint.allowed && best.sampleSufficient,
    });
  }

  const signals = signalPerformance().filter((s) => s.total > 0);
  for (const signal of signals.slice(0, 3)) {
    // A signal that predicts sales is a scoring observation, and scoring is a
    // hard constraint — so this can only ever be a suggestion.
    const constraint = checkAutonomousChange("scoring_weights");
    proposals.push({
      kind: "query_strategy",
      statement: `"${signal.signal}" cierra el ${Math.round(signal.winRate * 100)}% de las veces. Podría merecer más peso — decisión tuya.`,
      evidence: `${signal.won} ganados de ${signal.total} leads con esa señal.`,
      sampleSize: signal.total,
      constraint,
      applicable: false,
    });
  }

  return proposals;
}

export interface LearningReport {
  sources: SourcePerformance[];
  strategies: StrategyPerformance[];
  signals: SignalPerformance[];
  proposals: LearningProposal[];
  /** Proposals the system could apply on its own right now. */
  actionable: LearningProposal[];
}

export function buildLearningReport(): LearningReport {
  const proposals = buildProposals();
  return {
    sources: sourcePerformance(),
    strategies: strategyPerformance(),
    signals: signalPerformance(),
    proposals,
    actionable: proposals.filter((p) => p.applicable),
  };
}

/** Ranking of sources to try first, learned from the log. Falls back to the
 * configured order when there is not enough evidence to reorder anything. */
export function preferredSourceOrder(fallback: BusinessSource[]): BusinessSource[] {
  const performance = sourcePerformance().filter((p) => p.sampleSufficient);
  if (performance.length === 0) return fallback;

  const ranked = performance.map((p) => p.source);
  return [...ranked, ...fallback.filter((source) => !ranked.includes(source))];
}

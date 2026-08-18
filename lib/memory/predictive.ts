import { queryEvents, type LeadOutcome, type OutcomeRecord } from "./research-memory";
import { MIN_SAMPLE_FOR_ACTION } from "./learning";
import { checkAutonomousChange, type ConstraintCheck } from "./hard-constraints";

/**
 * FASE 5.4 — which signals actually predict a sale.
 *
 * The difference from `signalPerformance()` is the comparison. A signal that
 * closes 40% of the time sounds strong until you notice everything closes 40%
 * of the time. So every rate here is stated against the base rate, and a
 * signal is only called predictive when it beats it by a real margin *and*
 * has the observations to back it.
 *
 * Three things this deliberately refuses to do:
 *
 *   - report a lift computed from fewer than `MIN_SAMPLE_FOR_ACTION`
 *     outcomes as anything but insufficient;
 *   - let a predictive signal change the scoring weights, however strong it
 *     looks — that is a hard constraint and stays one;
 *   - count a lead the system never scored as evidence about its scoring.
 */

/** Outcomes that count as a sale. Everything else is not a win. */
const WON: LeadOutcome[] = ["WON"];

export interface PredictiveSignal {
  /** e.g. "municipio=Blanes", "necesidad>=20", "fuente=turisme_cat". */
  signal: string;
  dimension: "score" | "confidence" | "municipality" | "sector" | "source" | "service" | "factor";
  won: number;
  total: number;
  winRate: number;
  /** Win rate across every outcome, for comparison. */
  baseRate: number;
  /** winRate - baseRate, in percentage points. */
  liftPoints: number;
  sampleSufficient: boolean;
  /** True only when the sample is sufficient AND the lift clears the margin. */
  predictive: boolean;
  /** Plain-language statement, sample size included. */
  statement: string;
}

/**
 * How many points above the base rate a signal must sit before it is called
 * predictive. Coarse on purpose: with sample sizes in the tens, anything
 * finer is reading noise.
 */
export const MIN_LIFT_POINTS = 15;

interface OutcomeWithContext extends OutcomeRecord {
  at: string;
}

export function recordedOutcomes(): OutcomeWithContext[] {
  return queryEvents({ type: "OUTCOME_RECORDED" }).map((event) => ({
    ...(event.data as unknown as OutcomeRecord),
    at: event.at,
  }));
}

/** The overall win rate. Everything else is measured against this. */
export function baseWinRate(): { rate: number; won: number; total: number } {
  const outcomes = recordedOutcomes();
  const won = outcomes.filter((o) => WON.includes(o.outcome)).length;
  return { rate: outcomes.length > 0 ? won / outcomes.length : 0, won, total: outcomes.length };
}

function bucketsFor(outcome: OutcomeWithContext): { signal: string; dimension: PredictiveSignal["dimension"] }[] {
  const buckets: { signal: string; dimension: PredictiveSignal["dimension"] }[] = [];

  // A lead the system never scored says nothing about whether its scoring
  // works, so it contributes to the base rate but to no score bucket.
  if (outcome.scoreAtTime !== null) {
    const band =
      outcome.scoreAtTime >= 80
        ? "puntuación>=80"
        : outcome.scoreAtTime >= 60
          ? "puntuación 60-79"
          : "puntuación<60";
    buckets.push({ signal: band, dimension: "score" });
  }

  if (outcome.confidenceAtTime !== null) {
    buckets.push({
      signal: outcome.confidenceAtTime >= 0.8 ? "evidencia>=80%" : "evidencia<80%",
      dimension: "confidence",
    });
  }

  if (outcome.municipality) buckets.push({ signal: `municipio=${outcome.municipality}`, dimension: "municipality" });
  if (outcome.sector) buckets.push({ signal: `sector=${outcome.sector}`, dimension: "sector" });
  if (outcome.businessSource) buckets.push({ signal: `fuente=${outcome.businessSource}`, dimension: "source" });
  if (outcome.recommendedService) {
    buckets.push({ signal: `servicio=${outcome.recommendedService}`, dimension: "service" });
  }

  // Factor bands: was a high "necesidad" actually what preceded the sale?
  for (const [key, points] of Object.entries(outcome.factorsAtTime ?? {})) {
    if (typeof points !== "number") continue;
    buckets.push({ signal: `${key}>=${points >= 15 ? 15 : points >= 10 ? 10 : 0}`, dimension: "factor" });
  }

  return buckets;
}

export function predictiveSignals(): PredictiveSignal[] {
  const outcomes = recordedOutcomes();
  const base = baseWinRate();

  const tally = new Map<string, { won: number; total: number; dimension: PredictiveSignal["dimension"] }>();

  for (const outcome of outcomes) {
    const won = WON.includes(outcome.outcome);
    for (const { signal, dimension } of bucketsFor(outcome)) {
      const current = tally.get(signal) ?? { won: 0, total: 0, dimension };
      current.total += 1;
      if (won) current.won += 1;
      tally.set(signal, current);
    }
  }

  return [...tally.entries()]
    .map(([signal, { won, total, dimension }]) => {
      const winRate = total > 0 ? won / total : 0;
      const liftPoints = (winRate - base.rate) * 100;
      const sampleSufficient = total >= MIN_SAMPLE_FOR_ACTION;
      const predictive = sampleSufficient && liftPoints >= MIN_LIFT_POINTS;

      return {
        signal,
        dimension,
        won,
        total,
        winRate,
        baseRate: base.rate,
        liftPoints,
        sampleSufficient,
        predictive,
        statement: sampleSufficient
          ? `${signal}: cierra el ${Math.round(winRate * 100)}% (${won} de ${total}), frente al ${Math.round(base.rate * 100)}% general. Diferencia: ${liftPoints >= 0 ? "+" : ""}${Math.round(liftPoints)} puntos.`
          : `${signal}: ${won} de ${total} cerrados. Muestra insuficiente (hacen falta ${MIN_SAMPLE_FOR_ACTION}), así que no se saca ninguna conclusión.`,
      };
    })
    .sort((a, b) => b.liftPoints - a.liftPoints);
}

export interface PriorityAdjustment {
  /** Which autonomous area the adjustment belongs to. */
  area: string;
  target: string;
  /** Positive lifts move it up the queue, negative ones down. */
  liftPoints: number;
  evidence: string;
  sampleSize: number;
  constraint: ConstraintCheck;
  applicable: boolean;
}

/**
 * Turns predictive signals into priority adjustments the planner can act on.
 *
 * Only the dimensions that are autonomous areas produce adjustments —
 * municipality, sector and source. A signal about score bands or factors is
 * *reported* (it is genuinely interesting) but produces no adjustment,
 * because acting on it would mean reweighting the model, and the model is a
 * hard constraint no amount of evidence unlocks automatically.
 */
export function priorityAdjustments(): PriorityAdjustment[] {
  const AREA_BY_DIMENSION: Partial<Record<PredictiveSignal["dimension"], string>> = {
    municipality: "municipality_order",
    sector: "sector_order",
    source: "source_priority",
  };

  return predictiveSignals()
    .filter((signal) => signal.sampleSufficient)
    .flatMap((signal): PriorityAdjustment[] => {
      const area = AREA_BY_DIMENSION[signal.dimension];
      if (!area) return [];

      const constraint = checkAutonomousChange(area);
      const target = signal.signal.split("=")[1] ?? signal.signal;

      return [
        {
          area,
          target,
          liftPoints: signal.liftPoints,
          evidence: signal.statement,
          sampleSize: signal.total,
          constraint,
          applicable: constraint.allowed && Math.abs(signal.liftPoints) >= MIN_LIFT_POINTS,
        },
      ];
    });
}

/**
 * Municipality ranking learned from real sales, for the planner. Returns null
 * when there is not enough ground truth to reorder anything — the caller then
 * has to say so rather than pretending the order means something.
 */
export function learnedMunicipalityOrder(): { order: string[]; sampleSize: number } | null {
  const adjustments = priorityAdjustments().filter(
    (adjustment) => adjustment.area === "municipality_order" && adjustment.applicable
  );
  if (adjustments.length === 0) return null;

  return {
    order: adjustments.sort((a, b) => b.liftPoints - a.liftPoints).map((a) => a.target),
    sampleSize: adjustments.reduce((sum, a) => sum + a.sampleSize, 0),
  };
}

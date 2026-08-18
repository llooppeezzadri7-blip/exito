import { checkAutonomousChange, type ConstraintCheck } from "./hard-constraints";
import { randomUUID } from "node:crypto";
import { enqueueMemoryWrite, memoryPersistence, recordEvent } from "./research-memory";

/**
 * FASE 3 — Experiment engine.
 *
 * Lets the system test a hypothesis about *how it searches* — which query
 * phrasing, which source order, which municipality first — by running
 * variants and comparing what they actually produced.
 *
 * Two guardrails, both deliberate:
 *
 *   1. An experiment can only target an autonomous area. A hypothesis about
 *      scoring weights or verification rules can be registered and measured,
 *      but its conclusion is a recommendation for a human, never an applied
 *      change.
 *   2. A conclusion needs a minimum number of observations per variant.
 *      Declaring a winner from two runs is how a system talks itself into
 *      noise, so below the threshold the verdict is "insufficient", not a
 *      hedged winner.
 */

export const MIN_OBSERVATIONS_PER_VARIANT = 5;

export type ExperimentStatus = "DRAFT" | "RUNNING" | "CONCLUDED" | "ABANDONED";

export interface ExperimentVariant {
  id: string;
  description: string;
  /** Observed outcomes: usable businesses produced per run. */
  observations: number[];
}

export interface Experiment {
  id: string;
  hypothesis: string;
  /** Which area it would change if it wins. */
  targetArea: string;
  status: ExperimentStatus;
  variants: ExperimentVariant[];
  createdAt: string;
  concludedAt: string | null;
  /** Whether a win could be applied automatically. */
  constraint: ConstraintCheck;
  conclusion: ExperimentConclusion | null;
}

export interface ExperimentConclusion {
  verdict: "winner" | "no_difference" | "insufficient_data";
  winningVariantId: string | null;
  summary: string;
  /** Mean usable businesses per run, per variant. */
  means: { variantId: string; mean: number; observations: number }[];
  /** Whether the outcome may be applied without a human. */
  autoApplicable: boolean;
}

class ExperimentStore {
  experiments: Experiment[] = [];
}

const globalForExperiments = globalThis as unknown as { __experimentStore?: ExperimentStore };
const store = globalForExperiments.__experimentStore ?? new ExperimentStore();
globalForExperiments.__experimentStore = store;

/** FASE 5.2 — write-through: an experiment spans many cycles, so it has to
 * outlive the process that started it, observations included. */
function persist(experiment: Experiment): void {
  const persistence = memoryPersistence();
  if (!persistence) return;
  enqueueMemoryWrite(`saveExperiment:${experiment.id}`, () =>
    persistence.saveExperiment(structuredClone(experiment))
  );
}

export async function hydrateExperiments(): Promise<number> {
  const persistence = memoryPersistence();
  if (!persistence) return 0;

  const loaded = await persistence.loadExperiments();
  const byId = new Map(loaded.map((experiment) => [experiment.id, experiment]));
  for (const experiment of store.experiments) byId.set(experiment.id, experiment);

  store.experiments = [...byId.values()];
  return loaded.length;
}

export interface CreateExperimentInput {
  hypothesis: string;
  targetArea: string;
  variants: { id: string; description: string }[];
  at?: string;
}

export function createExperiment(input: CreateExperimentInput): Experiment {
  if (input.variants.length < 2) {
    throw new Error("Un experimento necesita al menos dos variantes para comparar.");
  }

  const experiment: Experiment = {
    id: randomUUID(),
    hypothesis: input.hypothesis,
    targetArea: input.targetArea,
    status: "RUNNING",
    variants: input.variants.map((v) => ({ ...v, observations: [] })),
    createdAt: input.at ?? new Date().toISOString(),
    concludedAt: null,
    constraint: checkAutonomousChange(input.targetArea),
    conclusion: null,
  };

  store.experiments.push(experiment);
  persist(experiment);
  recordEvent({
    type: "DECISION_MADE",
    runId: null,
    businessId: null,
    businessName: null,
    municipality: null,
    sector: null,
    source: null,
    summary: `Experimento creado: ${experiment.hypothesis}`,
    data: { experimentId: experiment.id, targetArea: experiment.targetArea },
    at: experiment.createdAt,
  });

  return experiment;
}

export function recordObservation(experimentId: string, variantId: string, usableBusinesses: number): Experiment {
  const experiment = store.experiments.find((e) => e.id === experimentId);
  if (!experiment) throw new Error(`Experimento desconocido: ${experimentId}`);
  if (experiment.status !== "RUNNING") {
    throw new Error(`El experimento ${experimentId} no está en curso (${experiment.status}).`);
  }

  const variant = experiment.variants.find((v) => v.id === variantId);
  if (!variant) throw new Error(`Variante desconocida: ${variantId}`);

  variant.observations.push(usableBusinesses);
  persist(experiment);
  return experiment;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Concludes an experiment. The margin required to call a winner is
 * deliberately coarse — a 20% difference — because with sample sizes this
 * small anything finer would be reading tea leaves.
 */
export function concludeExperiment(experimentId: string, at?: string): Experiment {
  const experiment = store.experiments.find((e) => e.id === experimentId);
  if (!experiment) throw new Error(`Experimento desconocido: ${experimentId}`);

  const means = experiment.variants.map((v) => ({
    variantId: v.id,
    mean: mean(v.observations),
    observations: v.observations.length,
  }));

  const underpowered = means.filter((m) => m.observations < MIN_OBSERVATIONS_PER_VARIANT);

  if (underpowered.length > 0) {
    experiment.conclusion = {
      verdict: "insufficient_data",
      winningVariantId: null,
      summary: `Faltan observaciones: ${underpowered
        .map((m) => `${m.variantId} tiene ${m.observations} de ${MIN_OBSERVATIONS_PER_VARIANT}`)
        .join("; ")}. No se declara ganador.`,
      means,
      autoApplicable: false,
    };
  } else {
    const sorted = [...means].sort((a, b) => b.mean - a.mean);
    const [best, second] = sorted;
    const margin = second.mean > 0 ? (best.mean - second.mean) / second.mean : best.mean > 0 ? 1 : 0;

    if (margin >= 0.2) {
      experiment.conclusion = {
        verdict: "winner",
        winningVariantId: best.variantId,
        summary: `${best.variantId} produce ${best.mean.toFixed(1)} negocios por ejecución frente a ${second.mean.toFixed(1)} de ${second.variantId} (${Math.round(margin * 100)}% más).`,
        means,
        autoApplicable: experiment.constraint.allowed,
      };
    } else {
      experiment.conclusion = {
        verdict: "no_difference",
        winningVariantId: null,
        summary: `Diferencia del ${Math.round(margin * 100)}%, por debajo del 20% exigido: no hay motivo para cambiar nada.`,
        means,
        autoApplicable: false,
      };
    }
  }

  experiment.status = "CONCLUDED";
  experiment.concludedAt = at ?? new Date().toISOString();
  persist(experiment);

  recordEvent({
    type: "DECISION_MADE",
    runId: null,
    businessId: null,
    businessName: null,
    municipality: null,
    sector: null,
    source: null,
    summary: `Experimento ${experiment.id} concluido: ${experiment.conclusion.summary}`,
    data: { experimentId: experiment.id, verdict: experiment.conclusion.verdict },
    at: experiment.concludedAt,
  });

  return experiment;
}

export function listExperiments(status?: ExperimentStatus): Experiment[] {
  return status ? store.experiments.filter((e) => e.status === status) : [...store.experiments];
}

export function getExperiment(id: string): Experiment | null {
  return store.experiments.find((e) => e.id === id) ?? null;
}

/** Conclusions the system may act on by itself right now. */
export function autoApplicableConclusions(): Experiment[] {
  return store.experiments.filter((e) => e.conclusion?.autoApplicable === true);
}

/** Conclusions that reached a verdict but need a human decision. */
export function pendingApproval(): Experiment[] {
  return store.experiments.filter(
    (e) => e.conclusion?.verdict === "winner" && !e.conclusion.autoApplicable
  );
}

export function resetExperiments(): void {
  store.experiments = [];
}

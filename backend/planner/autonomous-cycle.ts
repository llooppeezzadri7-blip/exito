import type { AgencyRepository } from "@/lib/database";
import type { DiscoveryPort } from "@/backend/research/run-research";
import type { ScanOptions } from "@/backend/scanner/scan-website";
import { flushMemory, recordEvent } from "@/lib/memory/research-memory";
import { runAutonomousResearch, type AutonomousProgress } from "./autonomous-run";
import { buildPlan } from "./planner";
import {
  chooseNextObjective,
  DEFAULT_CYCLE_BUDGET,
  type CycleBudget,
  type ObjectiveChoice,
  type SelectionMode,
} from "./next-objective";
import { applyAdjustments, type AppliedAdjustment } from "./apply-learning";
import {
  assignVariants,
  concludeReady,
  ensureExperiments,
  observeCycle,
  type VariantAssignment,
} from "./experiment-runner";
import type { FinalReport } from "./report";
import type { ResearchGoal } from "./types";

/**
 * FASE 5.5 / 5.6 — one unattended cycle.
 *
 * choose objective → apply what has been learned → plan → research → report →
 * record. The whole point is that nothing in that chain needs a human, and
 * every step of it leaves a trace that explains itself afterwards.
 *
 * The budget is enforced here and is not negotiable by anything downstream:
 * a planner that decided it wanted forty municipalities would still get the
 * three it is allowed.
 */

export interface CycleRecord {
  id: string;
  trigger: "manual" | "cron" | "test";
  status: "COMPLETED" | "FAILED";
  goal: ResearchGoal;
  selectionMode: SelectionMode;
  selectionReason: string;
  sampleSize: number;
  /** Learned adjustments applied before planning, with their evidence. */
  adjustmentsApplied: AppliedAdjustment[];
  /** Experiment variants this cycle was assigned to. */
  experimentsRunning: VariantAssignment[];
  /** Experiments that reached their observation threshold in this cycle. */
  experimentsConcluded: { hypothesis: string; verdict: string; autoApplicable: boolean }[];
  /** Objetivos que este ciclo iba a intentar, ya recortados al presupuesto. */
  targetsPlanned: number;
  /** Objetivos que el plan contenía antes de aplicar el techo del ciclo. */
  targetsInPlan: number;
  targetsExecuted: number;
  businessesAnalyzed: number;
  leadsProduced: number;
  estimatedCostUsd: number;
  durationMs: number;
  stoppedBecause: string;
  error: string | null;
  startedAt: string;
  finishedAt: string;
  report: FinalReport | null;
}

export interface RunCycleOptions {
  repository: AgencyRepository;
  trigger: CycleRecord["trigger"];
  budget?: CycleBudget;
  /** Overrides the automatic choice. */
  explicit?: Partial<ResearchGoal>;
  discovery?: DiscoveryPort;
  now?: () => Date;
  scanOptions?: ScanOptions;
  mobileOptions?: { executablePath?: string; allowLoopbackForTesting?: boolean };
  disableMobile?: boolean;
  onProgress?: (progress: AutonomousProgress & { choice: ObjectiveChoice }) => void;
  /** Caps targets regardless of the plan. Defaults to the budget. */
  maxTargets?: number;
}

export async function runAutonomousCycle(options: RunCycleOptions): Promise<CycleRecord> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const budget = options.budget ?? DEFAULT_CYCLE_BUDGET;
  const id = `cycle-${startedAt.toISOString()}`;

  // What real results say should be prioritised differently. Applied before
  // planning so the plan reflects it, and returned so the record shows what
  // was applied and on what evidence.
  const adjustmentsApplied = applyAdjustments();

  // FASE 5.7 — the cycle is also an experiment run. Variants are assigned
  // before the objective is chosen so the assignment cannot be influenced by
  // what the cycle happens to find.
  ensureExperiments(startedAt);
  const experimentsRunning = assignVariants();

  const choice = chooseNextObjective({
    now: startedAt,
    budget,
    explicit: options.explicit,
  });

  recordEvent({
    type: "DECISION_MADE",
    runId: id,
    businessId: null,
    businessName: null,
    municipality: choice.municipalities[0] ?? null,
    sector: choice.sectors[0] ?? null,
    source: null,
    summary: `Siguiente objetivo (${choice.mode}): ${choice.goal.statement}`,
    data: {
      mode: choice.mode,
      reason: choice.reason,
      sampleSize: choice.sampleSize,
      municipalities: choice.municipalities,
      sectors: choice.sectors,
      adjustmentsApplied: adjustmentsApplied.length,
    },
    at: startedAt.toISOString(),
  });

  const base = {
    id,
    trigger: options.trigger,
    goal: choice.goal,
    selectionMode: choice.mode,
    selectionReason: choice.reason,
    sampleSize: choice.sampleSize,
    adjustmentsApplied,
    experimentsRunning,
    startedAt: startedAt.toISOString(),
  };

  try {
    const plan = buildPlan(choice.goal, {
      now: startedAt,
      stop: { maxLeads: budget.maxLeads, maxDurationMs: budget.maxDurationMs },
    });

    const result = await runAutonomousResearch({
      goal: choice.goal,
      plan,
      repository: options.repository,
      runId: id,
      discovery: options.discovery,
      now,
      scanOptions: options.scanOptions,
      mobileOptions: options.mobileOptions,
      disableMobile: options.disableMobile,
      maxTargets: options.maxTargets ?? budget.municipalitiesPerCycle,
      onProgress: (progress) => options.onProgress?.({ ...progress, choice }),
    });

    // What this cycle produced is the observation for its assigned variants.
    observeCycle(experimentsRunning, result.leads.length);
    const concluded = concludeReady(now()).map((entry) => ({
      hypothesis: entry.experiment.hypothesis,
      verdict: entry.experiment.conclusion?.verdict ?? "insufficient_data",
      autoApplicable: entry.autoApplicable,
    }));

    // Everything this cycle learned is on disk before it reports success.
    // Otherwise a cycle could claim to have learned something that never left
    // the process.
    await flushMemory();

    const finishedAt = now();

    return {
      ...base,
      status: "COMPLETED",
      experimentsConcluded: concluded,
      // What this cycle was actually going to attempt, not what the plan
      // would have liked. Reporting "1 de 4" when the budget only ever
      // allowed one reads as three failures instead of a respected ceiling.
      targetsPlanned: Math.min(plan.targets.length, options.maxTargets ?? budget.municipalitiesPerCycle),
      targetsInPlan: plan.targets.length,
      targetsExecuted: result.targets.filter((target) => !target.skipped).length,
      businessesAnalyzed: result.decisions.length,
      leadsProduced: result.leads.length,
      estimatedCostUsd: plan.estimatedCostUsd,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      stoppedBecause: result.stoppedBecause,
      error: null,
      finishedAt: finishedAt.toISOString(),
      report: result.report,
    };
  } catch (err) {
    const finishedAt = now();
    const message = err instanceof Error ? err.message : "Fallo inesperado en el ciclo";

    recordEvent({
      type: "ERROR_DETECTED",
      runId: id,
      businessId: null,
      businessName: null,
      municipality: choice.municipalities[0] ?? null,
      sector: null,
      source: null,
      summary: `El ciclo autónomo falló: ${message}`,
      data: { mode: choice.mode },
      at: finishedAt.toISOString(),
    });
    await flushMemory();

    return {
      ...base,
      status: "FAILED",
      experimentsConcluded: [],
      targetsPlanned: 0,
      targetsInPlan: 0,
      targetsExecuted: 0,
      businessesAnalyzed: 0,
      leadsProduced: 0,
      estimatedCostUsd: 0,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      stoppedBecause: "El ciclo terminó por error.",
      error: message,
      finishedAt: finishedAt.toISOString(),
      report: null,
    };
  }
}

/** Process-local history of cycles, so the dashboard can show recent ones. */
class CycleStore {
  cycles: CycleRecord[] = [];
}

const globalForCycles = globalThis as unknown as { __autonomousCycles?: CycleStore };
const cycleStore = globalForCycles.__autonomousCycles ?? new CycleStore();
globalForCycles.__autonomousCycles = cycleStore;

const MAX_CYCLES_KEPT = 50;

export function saveCycle(record: CycleRecord): void {
  cycleStore.cycles.unshift(record);
  if (cycleStore.cycles.length > MAX_CYCLES_KEPT) cycleStore.cycles.pop();
}

export function listCycles(): CycleRecord[] {
  return [...cycleStore.cycles];
}

export function lastCycle(): CycleRecord | null {
  return cycleStore.cycles[0] ?? null;
}

export function resetCycles(): void {
  cycleStore.cycles = [];
}

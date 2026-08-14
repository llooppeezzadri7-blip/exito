/**
 * Research pipeline (brief §25, §26).
 *
 * A prospect moves through ordered phases, each one recording its own state.
 * The two properties that matter: a failing phase never destroys what earlier
 * phases produced, and a failed phase can be retried on its own instead of
 * re-running (and re-paying for) the whole chain.
 */

export const RESEARCH_PHASES = [
  "DISCOVERY",
  "ENRICHMENT",
  "WEB_RESOLUTION",
  "WEB_SCAN",
  "MOBILE_SCAN",
  "SEO_SCAN",
  "COMPETITOR_SCAN",
  "VALIDATION",
  "SCORING",
  "SECOND_RESEARCH",
  "FINAL",
] as const;

export type ResearchPhase = (typeof RESEARCH_PHASES)[number];

export type PhaseStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";

export interface PhaseState {
  phase: ResearchPhase;
  status: PhaseStatus;
  startedAt: string | null;
  finishedAt: string | null;
  attempts: number;
  error: string | null;
  /** Whatever the phase produced. Preserved across failures of later phases. */
  output: unknown;
  /** Why the phase was skipped, when it was — never silently absent. */
  skipReason?: string;
}

export interface ResearchRun {
  businessId: string;
  phases: PhaseState[];
  startedAt: string;
  updatedAt: string;
}

export function createRun(businessId: string, now = new Date()): ResearchRun {
  const timestamp = now.toISOString();
  return {
    businessId,
    startedAt: timestamp,
    updatedAt: timestamp,
    phases: RESEARCH_PHASES.map((phase) => ({
      phase,
      status: "PENDING",
      startedAt: null,
      finishedAt: null,
      attempts: 0,
      error: null,
      output: null,
    })),
  };
}

export function phaseOf(run: ResearchRun, phase: ResearchPhase): PhaseState {
  const state = run.phases.find((p) => p.phase === phase);
  if (!state) throw new Error(`Fase desconocida: ${phase}`);
  return state;
}

export interface PhaseHandlerContext {
  run: ResearchRun;
  /** Output of a previous phase, or undefined if it never completed. */
  outputOf(phase: ResearchPhase): unknown;
}

export type PhaseHandler = (context: PhaseHandlerContext) => Promise<unknown>;

export interface RunPhaseOptions {
  maxAttempts?: number;
  now?: () => Date;
  /** Injectable so tests don't sleep through the backoff. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs a single phase with retries and exponential backoff. A phase that
 * exhausts its attempts is marked FAILED and the run continues: partial
 * research is still worth scoring, as long as the gaps are visible — which
 * is what `confidence` downstream is for.
 */
export async function runPhase(
  run: ResearchRun,
  phase: ResearchPhase,
  handler: PhaseHandler,
  options: RunPhaseOptions = {}
): Promise<PhaseState> {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttempts ?? 2;

  const state = phaseOf(run, phase);
  state.status = "RUNNING";
  state.startedAt = now().toISOString();
  state.error = null;

  const context: PhaseHandlerContext = {
    run,
    outputOf: (target) => {
      const previous = phaseOf(run, target);
      return previous.status === "COMPLETED" ? previous.output : undefined;
    },
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    state.attempts = attempt;
    try {
      state.output = await handler(context);
      state.status = "COMPLETED";
      state.error = null;
      state.finishedAt = now().toISOString();
      run.updatedAt = state.finishedAt;
      return state;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts) await sleep(2 ** (attempt - 1) * 1000);
    }
  }

  state.status = "FAILED";
  state.finishedAt = now().toISOString();
  run.updatedAt = state.finishedAt;
  return state;
}

export function skipPhase(
  run: ResearchRun,
  phase: ResearchPhase,
  reason: string,
  now = new Date()
): PhaseState {
  const state = phaseOf(run, phase);
  state.status = "SKIPPED";
  state.skipReason = reason;
  state.finishedAt = now.toISOString();
  run.updatedAt = state.finishedAt;
  return state;
}

/** Phases that failed and can be retried without redoing the whole run. */
export function retryablePhases(run: ResearchRun): ResearchPhase[] {
  return run.phases.filter((p) => p.status === "FAILED").map((p) => p.phase);
}

export interface RunSummary {
  completed: number;
  failed: number;
  skipped: number;
  pending: number;
  /** True once no phase is left to run, whatever their outcome. */
  finished: boolean;
}

export function summarize(run: ResearchRun): RunSummary {
  const count = (status: PhaseStatus) => run.phases.filter((p) => p.status === status).length;
  const pending = count("PENDING") + count("RUNNING");

  return {
    completed: count("COMPLETED"),
    failed: count("FAILED"),
    skipped: count("SKIPPED"),
    pending,
    finished: pending === 0,
  };
}

/**
 * §16: a lead is only re-researched when it scores high enough to matter.
 * Cheap leads do not deserve a second paid round; expensive claims do.
 */
export function needsSecondResearch(score: number): { required: boolean; depth: "none" | "standard" | "strict" } {
  if (score >= 80) return { required: true, depth: "strict" };
  if (score >= 70) return { required: true, depth: "standard" };
  return { required: false, depth: "none" };
}

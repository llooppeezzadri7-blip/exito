import type { ResearchRunRecord } from "./types";

/**
 * Registry of research runs (brief §3, §12).
 *
 * Runs live in a process-global map so the UI can poll progress while the
 * pipeline is still working — a server action cannot stream, and a run takes
 * minutes. It is deliberately the same shape the Supabase-backed store will
 * take, so persistence can be swapped in without the UI changing.
 *
 * Honest limitation, surfaced in the UI: this survives navigation and page
 * reloads within one server process, but not a server restart or a
 * multi-instance deployment.
 */

class RunStore {
  runs = new Map<string, ResearchRunRecord>();
  order: string[] = [];
}

const globalForRunStore = globalThis as unknown as { __researchRunStore?: RunStore };
const store = globalForRunStore.__researchRunStore ?? new RunStore();
globalForRunStore.__researchRunStore = store;

let counter = 0;

export function createRunId(): string {
  counter += 1;
  return `run-${Date.now()}-${counter}`;
}

export function saveRun(run: ResearchRunRecord): void {
  if (!store.runs.has(run.id)) store.order.unshift(run.id);
  store.runs.set(run.id, run);
}

export function getRun(id: string): ResearchRunRecord | null {
  return store.runs.get(id) ?? null;
}

export function listRuns(limit = 20): ResearchRunRecord[] {
  return store.order
    .slice(0, limit)
    .map((id) => store.runs.get(id))
    .filter((run): run is ResearchRunRecord => Boolean(run));
}

/** Test helper — never called by the app. */
export function resetRunStore(): void {
  store.runs.clear();
  store.order = [];
}

import { randomUUID } from "node:crypto";
import type { BusinessSource } from "@/lib/database/types";
import { WriteQueue, type MemoryPersistence } from "./persistence";

/**
 * FASE 1 — Memoria e historial de investigaciones.
 *
 * An append-only event log of what the system did and concluded. Append-only
 * matters: a conclusion that later turns out to be wrong must remain visible
 * next to its correction, because "what did we believe, on what evidence, and
 * when did we find out otherwise" is the raw material every later phase
 * learns from. Overwriting would erase exactly that.
 *
 * FASE 5: the log is now durable. Reads stay synchronous against an
 * in-process cache; writes go through to whatever `MemoryPersistence` is
 * configured, in the background. Without a configured backend the behaviour
 * is exactly what it was before — process-local — and the dashboard says so
 * rather than implying the learning is being kept.
 */

export type MemoryEventType =
  | "SOURCE_QUERIED"
  | "BUSINESS_DISCOVERED"
  | "CONCLUSION_REACHED"
  | "DECISION_MADE"
  | "ERROR_DETECTED"
  | "CORRECTION_APPLIED"
  | "OUTCOME_RECORDED"
  | "CHANGE_DETECTED";

export interface MemoryEvent {
  id: string;
  type: MemoryEventType;
  at: string;
  /** Which run produced it, so a whole investigation can be replayed. */
  runId: string | null;
  businessId: string | null;
  businessName: string | null;
  municipality: string | null;
  sector: string | null;
  source: BusinessSource | null;
  /** One sentence, in the terms a person would use. */
  summary: string;
  /** Structured payload; shape depends on `type`. */
  data: Record<string, unknown>;
}

export interface SourceQueryRecord {
  source: BusinessSource;
  municipality: string;
  sector: string | null;
  category: string | null;
  /** Raw records the source returned. */
  returned: number;
  /** Records that survived dedupe and corroboration. */
  usable: number;
  ok: boolean;
  durationMs: number;
  error: string | null;
}

/** How a lead actually turned out — the only real feedback signal there is. */
export type LeadOutcome = "WON" | "LOST" | "NO_REPLY" | "NOT_A_FIT";

export interface OutcomeRecord {
  businessId: string;
  outcome: LeadOutcome;
  /**
   * Score the system gave it *at the time it concluded*, so a prediction is
   * compared with reality instead of with a later, already-corrected version
   * of itself. Null when the lead was never scored by the system — that is a
   * real state, and filling it in with today's number would be inventing the
   * evidence the whole learning loop rests on.
   */
  scoreAtTime: number | null;
  confidenceAtTime: number | null;
  recommendedService: string | null;
  soldService: string | null;
  /** Segmentation for the learning engine. Null when unknown, never guessed. */
  municipality: string | null;
  sector: string | null;
  businessSource: BusinessSource | null;
  /** Factor points as scored at the time, keyed by factor. */
  factorsAtTime: Record<string, number> | null;
  notes: string | null;
}

/**
 * What the system concluded about a business the last time it looked. This is
 * the only sanctioned source for "the score at the time": it is timestamped,
 * append-only and was written before the outcome was known.
 */
export interface RecordedConclusion {
  at: string;
  score: number;
  confidence: number;
  tier: string | null;
  recommendedService: string | null;
  factors: Record<string, number>;
  municipality: string | null;
  sector: string | null;
  source: BusinessSource | null;
}

export function lastConclusionFor(businessId: string): RecordedConclusion | null {
  const conclusions = queryEvents({ businessId, type: "CONCLUSION_REACHED" });
  const latest = conclusions.at(-1);
  if (!latest) return null;

  const data = latest.data as {
    score?: number;
    confidence?: number;
    tier?: string;
    recommendedService?: string | null;
    factors?: { key: string; points: number }[];
  };

  if (typeof data.score !== "number" || typeof data.confidence !== "number") return null;

  return {
    at: latest.at,
    score: data.score,
    confidence: data.confidence,
    tier: data.tier ?? null,
    recommendedService: data.recommendedService ?? null,
    factors: Object.fromEntries((data.factors ?? []).map((f) => [f.key, f.points])),
    municipality: latest.municipality,
    sector: latest.sector,
    source: latest.source,
  };
}

class MemoryStore {
  events: MemoryEvent[] = [];
  persistence: MemoryPersistence | null = null;
  queue = new WriteQueue();
  hydratedAt: string | null = null;
}

const globalForMemory = globalThis as unknown as { __researchMemory?: MemoryStore };
const store = globalForMemory.__researchMemory ?? new MemoryStore();
globalForMemory.__researchMemory = store;

const MAX_EVENTS = 5000;

/**
 * FASE 5.2 — attaches a durable backend. Called once during start-up; passing
 * null returns the log to process-local behaviour.
 */
export function setMemoryPersistence(persistence: MemoryPersistence | null): void {
  store.persistence = persistence;
}

export function memoryPersistenceName(): string | null {
  return store.persistence?.name ?? null;
}

/**
 * The configured backend and the shared write queue, for the sibling memory
 * modules (errors, experiments). One queue for all three on purpose: `flush()`
 * and the lost-write report have to cover everything the system learned in a
 * cycle, not just the event log.
 */
export function memoryPersistence(): MemoryPersistence | null {
  return store.persistence;
}

export function enqueueMemoryWrite(operation: string, work: () => Promise<void>): void {
  store.queue.enqueue(operation, work);
}

/**
 * Loads the persisted log into the cache. Events already in memory are kept
 * and merged by id, so hydrating twice cannot duplicate them and a hydration
 * that runs after some work has happened does not throw that work away.
 */
export async function hydrateMemory(limit = MAX_EVENTS): Promise<number> {
  if (!store.persistence) return 0;

  const loaded = await store.persistence.loadEvents(limit);
  const byId = new Map(loaded.map((event) => [event.id, event]));
  for (const event of store.events) byId.set(event.id, event);

  store.events = [...byId.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-limit);
  store.hydratedAt = new Date().toISOString();

  return loaded.length;
}

/** Waits for background writes. A cycle calls this before reporting done. */
export async function flushMemory(): Promise<void> {
  await store.queue.flush();
}

export interface MemoryPersistenceStatus {
  backend: string | null;
  hydratedAt: string | null;
  pendingWrites: number;
  lostWrites: { at: string; operation: string; message: string }[];
}

export function memoryPersistenceStatus(): MemoryPersistenceStatus {
  return {
    backend: store.persistence?.name ?? null,
    hydratedAt: store.hydratedAt,
    pendingWrites: store.queue.pending,
    lostWrites: store.queue.lostWrites,
  };
}

export interface RecordEventInput extends Omit<MemoryEvent, "id" | "at"> {
  at?: string;
}

export function recordEvent(input: RecordEventInput): MemoryEvent {
  const event: MemoryEvent = {
    ...input,
    // A UUID rather than a per-process counter: ids now outlive the process
    // that minted them, and two processes both starting at 1 would mint
    // colliding ids that the merge-by-id in hydrateMemory would silently
    // collapse into one.
    id: randomUUID(),
    at: input.at ?? new Date().toISOString(),
  };

  store.events.push(event);
  // Oldest events fall off first *in the cache*; the persisted log keeps
  // them, so trimming here never destroys history.
  if (store.events.length > MAX_EVENTS) store.events.shift();

  const persistence = store.persistence;
  if (persistence) {
    store.queue.enqueue(`appendEvent:${event.type}`, () => persistence.appendEvent(event));
  }

  return event;
}

export function recordSourceQuery(
  record: SourceQueryRecord,
  context: { runId: string | null; at?: string }
): MemoryEvent {
  return recordEvent({
    type: "SOURCE_QUERIED",
    runId: context.runId,
    businessId: null,
    businessName: null,
    municipality: record.municipality,
    sector: record.sector,
    source: record.source,
    summary: record.ok
      ? `${record.source} devolvió ${record.returned} registros en ${record.municipality}, ${record.usable} aprovechables.`
      : `${record.source} falló en ${record.municipality}: ${record.error}`,
    data: { ...record },
    at: context.at,
  });
}

export function recordOutcome(
  record: OutcomeRecord,
  context: { at?: string } = {}
): MemoryEvent {
  return recordEvent({
    type: "OUTCOME_RECORDED",
    runId: null,
    businessId: record.businessId,
    businessName: null,
    municipality: record.municipality,
    sector: record.sector,
    source: record.businessSource,
    summary:
      record.scoreAtTime === null
        ? `Resultado real del lead: ${record.outcome} (el sistema nunca llegó a puntuarlo, así que no hay predicción que contrastar).`
        : `Resultado real del lead: ${record.outcome} (el sistema le había dado ${record.scoreAtTime}/100).`,
    data: { ...record },
    at: context.at,
  });
}

export interface MemoryQuery {
  type?: MemoryEventType;
  runId?: string;
  businessId?: string;
  municipality?: string;
  sector?: string;
  source?: BusinessSource;
  since?: string;
}

export function queryEvents(query: MemoryQuery = {}): MemoryEvent[] {
  return store.events.filter((event) => {
    if (query.type && event.type !== query.type) return false;
    if (query.runId && event.runId !== query.runId) return false;
    if (query.businessId && event.businessId !== query.businessId) return false;
    if (query.municipality && event.municipality !== query.municipality) return false;
    if (query.sector && event.sector !== query.sector) return false;
    if (query.source && event.source !== query.source) return false;
    if (query.since && event.at < query.since) return false;
    return true;
  });
}

/** Everything the system knows about one business, oldest first. */
export function businessHistory(businessId: string): MemoryEvent[] {
  return queryEvents({ businessId });
}

/** True when this business has already been researched, so a sweep can skip it. */
export function hasBeenResearched(businessId: string): boolean {
  return queryEvents({ businessId, type: "CONCLUSION_REACHED" }).length > 0;
}

export interface MemoryStats {
  events: number;
  runs: number;
  businesses: number;
  outcomes: number;
  errors: number;
  corrections: number;
}

export function memoryStats(): MemoryStats {
  const runs = new Set(store.events.map((e) => e.runId).filter(Boolean));
  const businesses = new Set(store.events.map((e) => e.businessId).filter(Boolean));

  return {
    events: store.events.length,
    runs: runs.size,
    businesses: businesses.size,
    outcomes: queryEvents({ type: "OUTCOME_RECORDED" }).length,
    errors: queryEvents({ type: "ERROR_DETECTED" }).length,
    corrections: queryEvents({ type: "CORRECTION_APPLIED" }).length,
  };
}

export function resetMemory(): void {
  store.events = [];
  store.queue.reset();
  store.hydratedAt = null;
}

import type { BusinessSource } from "@/lib/database/types";

/**
 * FASE 1 — Memoria e historial de investigaciones.
 *
 * An append-only event log of what the system did and concluded. Append-only
 * matters: a conclusion that later turns out to be wrong must remain visible
 * next to its correction, because "what did we believe, on what evidence, and
 * when did we find out otherwise" is the raw material every later phase
 * learns from. Overwriting would erase exactly that.
 *
 * Process-local for now, like the run store — stated plainly rather than
 * implied. Persisting to Supabase is a separate, mechanical step.
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
  /** Score the system gave it, so predictions can be compared with reality. */
  scoreAtTime: number;
  confidenceAtTime: number;
  recommendedService: string | null;
  soldService: string | null;
  notes: string | null;
}

class MemoryStore {
  events: MemoryEvent[] = [];
  counter = 0;
}

const globalForMemory = globalThis as unknown as { __researchMemory?: MemoryStore };
const store = globalForMemory.__researchMemory ?? new MemoryStore();
globalForMemory.__researchMemory = store;

const MAX_EVENTS = 5000;

export interface RecordEventInput extends Omit<MemoryEvent, "id" | "at"> {
  at?: string;
}

export function recordEvent(input: RecordEventInput): MemoryEvent {
  store.counter += 1;
  const event: MemoryEvent = {
    ...input,
    id: `ev-${store.counter}`,
    at: input.at ?? new Date().toISOString(),
  };

  store.events.push(event);
  // Oldest events fall off first; the log is a rolling window, not an archive.
  if (store.events.length > MAX_EVENTS) store.events.shift();
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
    municipality: null,
    sector: null,
    source: null,
    summary: `Resultado real del lead: ${record.outcome} (el sistema le había dado ${record.scoreAtTime}/100).`,
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
  store.counter = 0;
}

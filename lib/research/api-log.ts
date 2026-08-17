/**
 * Log of external API calls (brief §3).
 *
 * Records what was called, when, whether it worked, how long it took, how
 * many results came back and the estimated cost. The API key is never a
 * parameter here and never reaches this module — there is nothing to redact
 * because nothing sensitive is passed in.
 */

export type ApiProvider = "google_places" | "google_pagespeed" | "anthropic" | "website" | "webflow";

export interface ApiCallEntry {
  provider: ApiProvider;
  /** Endpoint or operation name, never a URL carrying credentials. */
  operation: string;
  at: string;
  ok: boolean;
  durationMs: number;
  resultCount: number | null;
  estimatedCostUsd: number | null;
  errorCode: string | null;
}

const MAX_ENTRIES = 500;

class ApiLog {
  entries: ApiCallEntry[] = [];
}

const globalForApiLog = globalThis as unknown as { __apiCallLog?: ApiLog };
const log = globalForApiLog.__apiCallLog ?? new ApiLog();
globalForApiLog.__apiCallLog = log;

export function recordApiCall(entry: Omit<ApiCallEntry, "at"> & { at?: string }): ApiCallEntry {
  const full: ApiCallEntry = { ...entry, at: entry.at ?? new Date().toISOString() };
  log.entries.unshift(full);
  if (log.entries.length > MAX_ENTRIES) log.entries.length = MAX_ENTRIES;
  return full;
}

export function listApiCalls(limit = 100): ApiCallEntry[] {
  return log.entries.slice(0, limit);
}

export function apiCallSummary(provider?: ApiProvider): {
  calls: number;
  failures: number;
  estimatedCostUsd: number;
} {
  const entries = provider ? log.entries.filter((e) => e.provider === provider) : log.entries;
  return {
    calls: entries.length,
    failures: entries.filter((e) => !e.ok).length,
    estimatedCostUsd: entries.reduce((sum, e) => sum + (e.estimatedCostUsd ?? 0), 0),
  };
}

export function resetApiLog(): void {
  log.entries = [];
}

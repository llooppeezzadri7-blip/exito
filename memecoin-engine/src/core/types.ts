/**
 * Core primitives shared by every module.
 *
 * Design rules (see docs/ARCHITECTURE.md):
 *  - Every external datum is a DataPoint: value + source + observedAt + confidence.
 *  - `null` value means UNKNOWN. We never fabricate a number to fill a gap.
 *  - Facts (observed) are separated from inferences (derived) via `kind`.
 */

export type Chain = "solana" | "ethereum" | "base" | "bsc" | "avalanche";

export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export interface DataPoint<T> {
  /** null = UNKNOWN (data not available / not verifiable). */
  value: T | null;
  /** Provider id that produced the datum, e.g. "solana-rpc", "dexscreener". */
  source: string;
  /** ISO timestamp of when the datum was observed at the source. */
  observedAt: string;
  confidence: Confidence;
}

export function dp<T>(value: T | null, source: string, confidence: Confidence = "HIGH", observedAt = new Date().toISOString()): DataPoint<T> {
  return { value, source, observedAt, confidence: value === null ? "UNKNOWN" : confidence };
}

export function unknown<T>(source = "none"): DataPoint<T> {
  return { value: null, source, observedAt: new Date().toISOString(), confidence: "UNKNOWN" };
}

export function isKnown<T>(p: DataPoint<T> | null | undefined): p is DataPoint<T> & { value: T } {
  return !!p && p.value !== null && p.value !== undefined;
}

export function val<T>(p: DataPoint<T> | null | undefined): T | null {
  return isKnown(p) ? p.value : null;
}

/** Age of a datum in milliseconds relative to `now`. */
export function freshnessMs(p: DataPoint<unknown> | null | undefined, now: Date = new Date()): number | null {
  if (!p) return null;
  return now.getTime() - new Date(p.observedAt).getTime();
}

export type FactKind = "FACT" | "INFERENCE";

export interface Evidence {
  kind: FactKind;
  /** Short, human readable statement. */
  statement: string;
  source: string;
  observedAt: string;
  /** Optional raw numbers backing the statement. */
  data?: Record<string, unknown>;
}

export type Severity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface Flag {
  code: string;
  severity: Severity;
  message: string;
  evidence?: Evidence[];
}

export interface AnalyzerResult {
  analyzer: string;
  /** 0..100 (higher is better) or null if the analyzer could not conclude. */
  score: number | null;
  confidence: Confidence;
  flags: Flag[];
  evidence: Evidence[];
  /** Named metrics the scorer/learning engine can consume. */
  metrics: Record<string, number | null>;
  computedAt: string;
}

export function emptyResult(analyzer: string, reason?: string): AnalyzerResult {
  return {
    analyzer,
    score: null,
    confidence: "UNKNOWN",
    flags: reason ? [{ code: "INSUFFICIENT_DATA", severity: "INFO", message: reason }] : [],
    evidence: [],
    metrics: {},
    computedAt: new Date().toISOString(),
  };
}

export type Tier = 1 | 2 | 3 | 4;

export type RiskLevel =
  | "RELATIVELY_LOW_RISK"
  | "LOW_RISK"
  | "MEDIUM_RISK"
  | "HIGH_RISK"
  | "EXTREME_RISK"
  | "UNKNOWN";

export type OpportunityCategory =
  | "NO_OPPORTUNITY"
  | "WATCHLIST"
  | "HIGH_CONVICTION_SETUP"
  | "EXTREME_RISK"
  | "INSUFFICIENT_DATA"
  | "SECURITY_UNVERIFIED"
  | "INVESTIGATE"
  | "REJECTED";

export type MarketPhase = "EARLY" | "LATE" | "EXHAUSTED" | "UNKNOWN";

export type ThesisStatus = "THESIS_INTACT" | "THESIS_WEAKENING" | "THESIS_INVALIDATED" | "RISK_ESCALATING" | "NO_THESIS";

export type AlertType =
  | "NEW_HIGH_POTENTIAL"
  | "RISK_ESCALATION"
  | "RUG_WARNING"
  | "LIQUIDITY_DROP"
  | "WHALE_EXIT"
  | "VOLUME_SPIKE"
  | "SOCIAL_SPIKE"
  | "NARRATIVE_SPIKE"
  | "BREAKOUT_SETUP"
  | "EXIT_WARNING"
  | "DATA_SOURCE_DEGRADED";

export const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "24h"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];
export const TIMEFRAME_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
};

import type { ResearchDepth } from "@/backend/research/types";

/**
 * FASE 4 — Autonomous planner types.
 *
 * The planner's output is a *plan with reasons*: every choice carries the
 * justification behind it, and a justification is either a historical
 * observation with its sample size or an explicit statement that there is no
 * history yet. There is no third option — inventing a statistic to sound
 * decisive is the failure mode this whole system is built against.
 */

export interface ResearchGoal {
  /** What the user actually asked for, in their words. */
  statement: string;
  zone: string;
  maxLeads: number;
  maxDepth: ResearchDepth;
  /** Optional narrowing; absent means the planner decides. */
  sectors?: string[];
  municipalities?: string[];
}

export type JustificationBasis = "historical_evidence" | "no_history_yet" | "explicit_request" | "domain_rule";

export interface PlanJustification {
  decision: string;
  basis: JustificationBasis;
  reason: string;
  /** Observations behind it. Zero means the reason must say so. */
  sampleSize: number;
}

export interface PlannedTarget {
  municipality: string;
  sector: string;
  subsector: string;
  /** Order of execution; lower runs first. */
  priority: number;
  maxBusinesses: number;
  justification: PlanJustification;
}

export interface StopCriteria {
  maxRounds: number;
  maxRequestsPerBusiness: number;
  maxDurationMs: number;
  /** Confidence at which a business is considered sufficiently evaluated. */
  sufficientConfidence: number;
  maxLeads: number;
}

export interface DeepeningCriteria {
  /** Score above which a business earns deep research. */
  deepenAboveScore: number;
  /** Confidence below which an otherwise good lead must be re-researched. */
  reResearchBelowConfidence: number;
  /** Score below which a business is dropped without further spend. */
  discardBelowScore: number;
}

export interface ResearchPlan {
  goal: ResearchGoal;
  targets: PlannedTarget[];
  sources: { source: string; justification: PlanJustification }[];
  depth: ResearchDepth;
  stop: StopCriteria;
  deepening: DeepeningCriteria;
  estimatedRequests: number;
  estimatedCostUsd: number;
  /** Every decision, in the order it was made. */
  decisions: PlanJustification[];
  createdAt: string;
}

/** FASE 4.2 — how much further research a business has earned. */
export type TriageClass = "A" | "B" | "C" | "D";

export interface TriageDecision {
  businessId: string;
  businessName: string;
  triage: TriageClass;
  reason: string;
  /** What is still unknown and could move the score. */
  openQuestions: string[];
}

/** FASE 4.3 — a targeted follow-up, not a repeat of the same queries. */
export type UncertaintyKind =
  | "website_unresolved"
  | "identity_ambiguous"
  | "no_scan"
  | "booking_unknown"
  | "mobile_unknown"
  | "competitors_insufficient"
  | "contradictory_sources"
  | "payment_capacity_unknown";

export interface ResearchDirective {
  kind: UncertaintyKind;
  /** Concrete action, not "investigate more". */
  action: string;
  /** Which factor it would unblock. */
  unblocks: string;
  /** Points currently unassessed because of it. */
  pointsAtStake: number;
}

export type StopReasonCode =
  | "SUFFICIENT_CONFIDENCE"
  | "NO_OPEN_QUESTIONS"
  | "MAX_ROUNDS"
  | "MAX_REQUESTS"
  | "TIMEOUT"
  | "DISCARDED"
  | "NO_PROGRESS";

export interface StopDecision {
  stop: boolean;
  code: StopReasonCode | null;
  reason: string;
}

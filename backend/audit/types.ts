/**
 * W1 — the web quality audit model.
 *
 * Nine dimensions, each scored 0–100 with the evidence behind it. The rule
 * that shapes the whole model: a dimension that could not be measured is
 * `NO_EVALUABLE`, never zero. Zero says "they do this badly"; not being able
 * to measure says something else entirely, and collapsing the two is how an
 * audit starts lying — the same anti-invention discipline the prospecting
 * side already runs on.
 *
 * Consequence: every score carries `confidence`, the share of its checks that
 * could actually be run. An 82 measured on 40% of the checks is not the same
 * claim as an 82 measured on all of them, and the report has to say so.
 */

export type AuditDimensionKey =
  | "technical_seo"
  | "onpage_seo"
  | "local_seo"
  | "content"
  | "performance"
  | "mobile"
  | "accessibility"
  | "cro"
  | "code_quality";

export type CheckStatus = "PASS" | "FAIL" | "WARN" | "NO_EVALUABLE";

export type CheckSeverity = "critical" | "serious" | "moderate" | "minor";

export interface AuditCheck {
  id: string;
  dimension: AuditDimensionKey;
  /** What was checked, in the terms an owner would understand. */
  label: string;
  status: CheckStatus;
  severity: CheckSeverity;
  /** Weight within its dimension. Checks that cannot run are excluded. */
  weight: number;
  /** What was actually observed. Never a recommendation dressed as a fact. */
  evidence: string;
  /** What to do about it. Only present when the check did not pass. */
  fix?: string;
  /** Why it could not be evaluated. Only present when NO_EVALUABLE. */
  missing?: string;
  /** Official reference, so a claim can be checked rather than trusted. */
  reference?: string;
}

export interface DimensionScore {
  key: AuditDimensionKey;
  label: string;
  /** 0–100 over the checks that could be run. Null when none could. */
  score: number | null;
  /** Share of this dimension's weight that was actually measurable. */
  confidence: number;
  checks: AuditCheck[];
  passed: number;
  failed: number;
  notEvaluable: number;
}

export interface QualityGateResult {
  /** True only when no critical check failed and no dimension is unmeasured. */
  passed: boolean;
  /** Failures that block delivery under §32. */
  blockers: AuditCheck[];
  /** Things worth fixing that do not block. */
  warnings: AuditCheck[];
  reason: string;
}

export interface WebAuditResult {
  url: string;
  finalUrl: string;
  auditedAt: string;
  /** Weighted across dimensions that could be scored. Null when none could. */
  overall: number | null;
  /** Share of the whole model that was measurable. */
  confidence: number;
  dimensions: DimensionScore[];
  gate: QualityGateResult;
  /** Highest-impact fixes first: severity, then how much score they unlock. */
  priorities: AuditCheck[];
  /** What the audit could not look at, and why. Never silently omitted. */
  limitations: string[];
}

export const DIMENSION_LABELS: Record<AuditDimensionKey, string> = {
  technical_seo: "SEO técnico",
  onpage_seo: "SEO on-page",
  local_seo: "SEO local",
  content: "Contenido",
  performance: "Rendimiento",
  mobile: "Móvil",
  accessibility: "Accesibilidad",
  cro: "Conversión",
  code_quality: "Calidad del código",
};

/**
 * How much each dimension weighs in the overall score.
 *
 * Deliberately not equal. For the local businesses this system targets, a
 * site that is unusable on a phone or gives no way to get in touch loses more
 * real money than one with an imperfect canonical tag. Accessibility carries
 * real weight because it is both a legal exposure and a usability floor, not
 * a checkbox.
 */
export const DIMENSION_WEIGHTS: Record<AuditDimensionKey, number> = {
  technical_seo: 15,
  onpage_seo: 15,
  local_seo: 10,
  content: 10,
  performance: 12,
  mobile: 15,
  accessibility: 10,
  cro: 8,
  code_quality: 5,
};

/** Severity order, used for prioritising fixes. */
export const SEVERITY_RANK: Record<CheckSeverity, number> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
};

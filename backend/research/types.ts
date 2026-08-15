import type { CommercialFactor, CommercialTier } from "@/lib/scoring/commercial-score";
import type { Evidence } from "@/lib/research/evidence";
import type { MobileAuditResult } from "@/backend/scanner/mobile-audit";
import type { CandidateAssessment } from "@/lib/research/website-resolver";

/** How deep a run goes. Each level is a superset of the previous one (§2). */
export type ResearchDepth = "rapida" | "profunda" | "completa";

export interface DepthPreset {
  id: ResearchDepth;
  label: string;
  description: string;
  steps: string[];
  resolveWebsite: boolean;
  scanWebsite: boolean;
  auditMobile: boolean;
  analyzeCompetitors: boolean;
  secondResearch: boolean;
}

export const DEPTH_PRESETS: Record<ResearchDepth, DepthPreset> = {
  rapida: {
    id: "rapida",
    label: "Investigación rápida",
    description: "Descubrimiento + datos básicos de la ficha de Google + puntuación.",
    steps: ["Descubrimiento", "Deduplicación", "Puntuación"],
    resolveWebsite: false,
    scanWebsite: false,
    auditMobile: false,
    analyzeCompetitors: false,
    secondResearch: false,
  },
  profunda: {
    id: "profunda",
    label: "Investigación profunda",
    description: "Añade resolución de web oficial, análisis técnico, móvil, SEO y competencia.",
    steps: [
      "Descubrimiento",
      "Deduplicación",
      "Resolución de webs",
      "Análisis de webs",
      "Análisis móvil",
      "Competencia",
      "Puntuación",
    ],
    resolveWebsite: true,
    scanWebsite: true,
    auditMobile: true,
    analyzeCompetitors: true,
    secondResearch: false,
  },
  completa: {
    id: "completa",
    label: "Investigación completa",
    description: "Todo lo anterior más una segunda investigación de los mejores leads (70+).",
    steps: [
      "Descubrimiento",
      "Deduplicación",
      "Resolución de webs",
      "Análisis de webs",
      "Análisis móvil",
      "Competencia",
      "Puntuación",
      "Segunda investigación",
      "Ranking",
    ],
    resolveWebsite: true,
    scanWebsite: true,
    auditMobile: true,
    analyzeCompetitors: true,
    secondResearch: true,
  },
};

export interface ResearchConfig {
  municipality: string;
  sector?: string;
  subsector?: string;
  maxBusinesses: number;
  depth: ResearchDepth;
}

export type ProgressStepStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED";

export interface ProgressStep {
  key: string;
  label: string;
  status: ProgressStepStatus;
  current: number;
  total: number;
  /** Short result line, e.g. "31 negocios únicos". */
  detail: string | null;
}

/** A failure that did NOT stop the run (§13). */
export interface ResearchIssue {
  businessName: string | null;
  phase: string;
  code: string;
  message: string;
}

export interface CompetitorSnapshot {
  name: string;
  city: string | null;
  website_url: string | null;
  rating: number | null;
  review_count: number | null;
}

export interface WebsiteResolutionSnapshot {
  status: "VERIFICADO" | "PROBABLE" | "NO_VERIFICADO";
  url: string | null;
  missing: string | null;
  assessments: CandidateAssessment[];
}

export interface ResearchResultItem {
  businessId: string;
  name: string;
  city: string | null;
  sector: string | null;
  score: number;
  confidence: number;
  tier: CommercialTier;
  factors: CommercialFactor[];
  recommendedService: string | null;
  recommendationReason: string | null;
  primaryProblem: string | null;
  evidence: Evidence[];
  websiteResolution: WebsiteResolutionSnapshot | null;
  mobileAudit: MobileAuditResult | null;
  competitors: CompetitorSnapshot[];
  competitorsVerified: boolean;
  secondResearch: SecondResearchOutcome | null;
  /** Phases that failed for this specific business (§13). */
  failedPhases: string[];
}

export interface SecondResearchOutcome {
  performed: boolean;
  depth: "standard" | "strict";
  /** Findings the re-check confirmed. */
  confirmed: string[];
  /** Findings the re-check contradicted, with the correction applied. */
  corrected: string[];
  scoreBefore: number;
  scoreAfter: number;
}

export interface ResearchRunRecord {
  id: string;
  config: ResearchConfig;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  steps: ProgressStep[];
  results: ResearchResultItem[];
  issues: ResearchIssue[];
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

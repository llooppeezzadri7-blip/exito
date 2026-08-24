import type { Settings } from "@/lib/database/types";
import { analyzeSite, type SiteAnalysis } from "@/backend/crawl/crawl-site";
import { auditWebsite } from "@/backend/audit/audit-website";
import type { WebAuditResult } from "@/backend/audit/types";
import { recordEvent } from "@/lib/memory/research-memory";
import { diagnose, diagnosisLimitations, type BusinessProblem } from "./diagnose";
import { recommend, type Recommendation } from "./recommend";

/**
 * "Analiza este negocio" — the whole chain, end to end.
 *
 *   crawl (W2) → audit (W1) → diagnose → recommend
 *
 * This is the first capability in the project that goes all the way from a
 * URL to something commercially actionable, which is why it exists before any
 * further analysis layer: the stack could already see a great deal and could
 * not yet say what to do about any of it.
 *
 * Every stage reuses what is already built. Nothing here re-implements
 * auditing, crawling or scoring.
 */

export interface AnalyzeBusinessOptions {
  settings: Settings;
  /** Business name, when known. Only used for reporting. */
  businessName?: string;
  allowLoopbackForTesting?: boolean;
  maxPages?: number;
  maxDepth?: number;
  skipMobile?: boolean;
  mobileOptions?: { executablePath?: string; allowLoopbackForTesting?: boolean };
  /** Skip the crawl and analyse the single URL. Faster, blinder. */
  singlePage?: boolean;
  onProgress?: (stage: AnalysisStage, detail: string) => void;
  now?: () => Date;
}

export type AnalysisStage = "CRAWL" | "AUDIT" | "DIAGNOSE" | "RECOMMEND" | "DONE";

export interface BusinessAnalysis {
  url: string;
  businessName: string | null;
  analyzedAt: string;
  site: SiteAnalysis | null;
  audit: WebAuditResult | null;
  problems: BusinessProblem[];
  recommendation: Recommendation;
  /** Wall-clock, so the cost of an analysis is visible. */
  durationMs: number;
}

export async function analyzeBusiness(
  url: string,
  options: AnalyzeBusinessOptions
): Promise<BusinessAnalysis> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const report = (stage: AnalysisStage, detail: string) => options.onProgress?.(stage, detail);

  let site: SiteAnalysis | null = null;
  let audit: WebAuditResult | null = null;

  if (options.singlePage) {
    report("AUDIT", "Auditando una sola página.");
    audit = await auditWebsite(url, {
      allowLoopbackForTesting: options.allowLoopbackForTesting,
      skipMobile: options.skipMobile,
      mobileOptions: options.mobileOptions,
    });
  } else {
    report("CRAWL", "Rastreando el sitio.");
    site = await analyzeSite(url, {
      allowLoopbackForTesting: options.allowLoopbackForTesting,
      maxPages: options.maxPages ?? 30,
      maxDepth: options.maxDepth ?? 4,
      // One audit is enough for the diagnosis: the entry point is what a
      // visitor lands on, and auditing every page multiplies browser
      // launches for findings that barely differ between templated pages.
      auditSample: 1,
      skipMobile: options.skipMobile,
      mobileOptions: options.mobileOptions,
    });

    report("AUDIT", `Auditadas ${site.audits.length} página(s).`);
    audit = site.audits[0]?.audit ?? null;
  }

  report("DIAGNOSE", "Traduciendo hallazgos a problemas de negocio.");
  const problems = diagnose({ audit, site });
  const limitations = diagnosisLimitations({ audit, site });

  report("RECOMMEND", `${problems.length} problema(s) detectados.`);
  const recommendation = recommend({
    problems,
    settings: options.settings,
    audit,
    site,
    limitations,
  });

  const finishedAt = now();

  // The analysis goes into the same memory the prospecting side learns from,
  // so a recommendation can later be compared with whether it actually sold.
  recordEvent({
    type: "CONCLUSION_REACHED",
    runId: null,
    businessId: null,
    businessName: options.businessName ?? null,
    municipality: null,
    sector: null,
    source: null,
    summary: `Análisis de ${url}: ${recommendation.verdict} — ${recommendation.headline}`,
    data: {
      url,
      verdict: recommendation.verdict,
      problems: problems.length,
      criticalProblems: problems.filter((problem) => problem.severity === "critical").length,
      services: recommendation.services.map((service) => service.kind),
      totalEur: recommendation.totalEur,
      evidenceCoverage: recommendation.evidenceCoverage,
      auditScore: audit?.overall ?? null,
    },
    at: finishedAt.toISOString(),
  });

  report("DONE", recommendation.headline);

  return {
    url,
    businessName: options.businessName ?? null,
    analyzedAt: startedAt.toISOString(),
    site,
    audit,
    problems,
    recommendation,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}

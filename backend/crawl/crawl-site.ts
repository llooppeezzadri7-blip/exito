import { auditWebsite } from "@/backend/audit/audit-website";
import type { WebAuditResult } from "@/backend/audit/types";
import { crawlSite, type CrawlOptions } from "./crawler";
import { findIssues, summarizeIssues, type SiteIssue, type SiteIssueSummary } from "./issues";
import type { CrawledPage, SiteModel } from "./site-model";

/**
 * W2 — the whole-site analysis.
 *
 * crawl → architecture → issues → per-page W1 audits → site quality gate.
 *
 * W1 is reused unchanged: it audits a URL, and this decides which URLs are
 * worth auditing. Auditing every page of a fifty-page site would mean fifty
 * headless-browser launches for information that barely varies between
 * templated pages, so a representative sample is audited by default and the
 * report says exactly which pages those were.
 */

export interface SiteAnalysisOptions extends CrawlOptions {
  /** How many crawled pages get a full W1 audit. 0 disables auditing. */
  auditSample?: number;
  /** Passed through to W1. */
  skipMobile?: boolean;
  mobileOptions?: { executablePath?: string; allowLoopbackForTesting?: boolean };
}

export interface SiteQualityGate {
  passed: boolean;
  /** Site-level failures that block: dead pages, loops, server errors. */
  blockers: SiteIssue[];
  reason: string;
}

export interface SiteAnalysis {
  site: SiteModel;
  issues: SiteIssue[];
  summary: SiteIssueSummary;
  /** Pages that got a full W1 audit, and why those. */
  audits: { url: string; reason: string; audit: WebAuditResult }[];
  /** Mean W1 score across audited pages. Null when none were audited. */
  averagePageScore: number | null;
  gate: SiteQualityGate;
  limitations: string[];
}

/**
 * Chooses which pages to audit. The entry point always, then the pages with
 * the most inbound links — the ones users and crawlers actually land on. A
 * random sample would be defensible statistically and useless practically.
 */
export function selectAuditTargets(
  site: SiteModel,
  sampleSize: number
): { url: string; reason: string }[] {
  if (sampleSize <= 0) return [];

  const auditable = site.pages.filter((page) => page.state === "OK" || page.state === "REDIRECT");
  const selected: { url: string; reason: string }[] = [];
  const taken = new Set<string>();

  const entry = auditable.find((page) => page.url === site.entryUrl);
  if (entry) {
    selected.push({ url: entry.url, reason: "Página de entrada del sitio." });
    taken.add(entry.url);
  }

  const byInbound = [...auditable]
    .filter((page) => !taken.has(page.url))
    .sort((a, b) => b.inboundLinks.length - a.inboundLinks.length);

  for (const page of byInbound) {
    if (selected.length >= sampleSize) break;
    selected.push({
      url: page.url,
      reason: `${page.inboundLinks.length} enlace(s) internos entrantes: es una de las páginas más enlazadas.`,
    });
    taken.add(page.url);
  }

  return selected;
}

/**
 * The site-level gate. Stricter than W1's page gate on purpose: a single page
 * can be excellent while the site around it is unreachable, and shipping on
 * the strength of the homepage is exactly the mistake this prevents.
 */
export function siteQualityGate(issues: SiteIssue[], site: SiteModel): SiteQualityGate {
  const blockers = issues.filter((entry) => entry.severity === "critical");

  if (blockers.length > 0) {
    return {
      passed: false,
      blockers,
      reason: `${blockers.length} problema(s) crítico(s) de sitio: ${blockers.map((b) => b.title).join("; ")}.`,
    };
  }

  if (site.stats.fetched === 0) {
    return {
      passed: false,
      blockers: [],
      reason: "No se pudo rastrear ninguna página, así que no hay nada que evaluar.",
    };
  }

  if (site.stats.stoppedBy !== "completed") {
    return {
      passed: false,
      blockers: [],
      reason: `El crawl paró por ${site.stats.stoppedBy}: no se ha visto el sitio entero, así que no puede darse por bueno.`,
    };
  }

  return {
    passed: true,
    blockers: [],
    reason: "Sin problemas críticos de sitio y el crawl cubrió todo lo alcanzable.",
  };
}

export async function analyzeSite(entryUrl: string, options: SiteAnalysisOptions = {}): Promise<SiteAnalysis> {
  const site = await crawlSite(entryUrl, options);
  const issues = findIssues(site);
  const limitations = [...site.limitations];

  const sampleSize = options.auditSample ?? 3;
  const targets = selectAuditTargets(site, sampleSize);
  const audits: SiteAnalysis["audits"] = [];

  for (const target of targets) {
    const audit = await auditWebsite(target.url, {
      allowLoopbackForTesting: options.allowLoopbackForTesting,
      skipMobile: options.skipMobile,
      mobileOptions: options.mobileOptions,
    });
    audits.push({ url: target.url, reason: target.reason, audit });
  }

  const auditable = site.pages.filter((page) => page.state === "OK" || page.state === "REDIRECT").length;
  if (sampleSize === 0) {
    limitations.push("No se auditó ninguna página con W1: solo hay resultados de crawl.");
  } else if (audits.length < auditable) {
    limitations.push(
      `Se auditaron ${audits.length} de ${auditable} páginas rastreables. Las puntuaciones por página describen esa muestra, no el sitio entero.`
    );
  }

  const scored = audits.map((entry) => entry.audit.overall).filter((score): score is number => score !== null);

  return {
    site,
    issues,
    summary: summarizeIssues(issues),
    audits,
    averagePageScore:
      scored.length === 0 ? null : Math.round(scored.reduce((sum, score) => sum + score, 0) / scored.length),
    gate: siteQualityGate(issues, site),
    limitations,
  };
}

/** Pages worth attention first, for a report or a work queue. */
export function pagesByPriority(site: SiteModel): CrawledPage[] {
  const rank = (page: CrawledPage): number => {
    if (page.state === "SERVER_ERROR") return 0;
    if (page.state === "CLIENT_ERROR") return 1;
    if (page.state === "UNREACHABLE") return 2;
    if (!page.indexable) return 3;
    return 4;
  };

  return [...site.pages].sort((a, b) => {
    const byState = rank(a) - rank(b);
    if (byState !== 0) return byState;
    return b.inboundLinks.length - a.inboundLinks.length;
  });
}

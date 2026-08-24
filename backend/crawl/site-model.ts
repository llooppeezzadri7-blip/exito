import type { RedirectHop } from "@/lib/security/ssrf-guard";
import type { WebAuditResult } from "@/backend/audit/types";
import type { RobotsTxt } from "./robots";
import type { SitemapReport } from "./sitemap";

/**
 * W2 — the structured representation of a site.
 *
 * This is the artefact everything after W2 consumes: keyword mapping, content
 * strategy, internal-linking recommendations, page generation, competitor
 * comparison. So it is deliberately a *description of what was observed*,
 * with no judgement baked in — the judgements live in `issues.ts` and in W1,
 * where they can be changed without invalidating the model.
 *
 * Verification levels follow the project's existing vocabulary rather than
 * inventing a parallel one:
 *   VERIFIED      — fetched and read directly.
 *   PROBABLE      — inferred from something else that was verified.
 *   NOT_VERIFIED  — could not be established.
 *   NO_EVALUABLE  — not applicable or not attempted in this run.
 */

export type Verification = "VERIFIED" | "PROBABLE" | "NOT_VERIFIED" | "NO_EVALUABLE";

export type PageState =
  | "OK"
  | "REDIRECT"
  | "CLIENT_ERROR"
  | "SERVER_ERROR"
  | "UNREACHABLE"
  | "BLOCKED_BY_ROBOTS"
  | "NOT_FETCHED";

export interface PageLink {
  /** Normalised key of the target. */
  to: string;
  /** The href exactly as it appeared, for reporting. */
  rawHref: string;
  anchorText: string;
  rel: string | null;
  internal: boolean;
}

export interface CrawledPage {
  /** Normalised URL. The identity used everywhere. */
  url: string;
  /** URL after following redirects, when different. */
  finalUrl: string;
  state: PageState;
  status: number | null;
  /** Clicks from the entry point. Null when only known from the sitemap. */
  depth: number | null;
  /** How this URL was first discovered. */
  discoveredVia: "seed" | "link" | "sitemap" | "canonical" | "redirect";
  /** Full redirect chain, empty when there was none. */
  redirects: RedirectHop[];

  title: string | null;
  metaDescription: string | null;
  h1: string[];
  canonical: string | null;
  /** True when canonical points somewhere other than this page. */
  canonicalPointsElsewhere: boolean;
  robotsMeta: string | null;
  indexable: boolean;
  /** Why the page is or is not indexable, in plain terms. */
  indexabilityReason: string;
  indexabilityVerification: Verification;

  wordCount: number;
  /** Hash of the normalised body text, for near-duplicate detection. */
  contentHash: string | null;

  outboundLinks: PageLink[];
  /** Normalised keys of internal pages linking here. Filled after the crawl. */
  inboundLinks: string[];

  inSitemap: boolean;
  allowedByRobots: boolean;
  robotsReason: string;

  contentType: string | null;
  bytes: number;
  elapsedMs: number | null;
  fetchedAt: string | null;
  error: string | null;

  /** W1 audit, when this page was selected for one. */
  audit: WebAuditResult | null;
}

export interface SiteArchitecture {
  /** Pages by depth: index 0 is the entry point. */
  byDepth: Record<number, string[]>;
  maxDepth: number;
  /** Reachable from the entry point by following internal links. */
  reachable: string[];
  /** Known to exist but not reachable by any internal link. */
  orphans: string[];
  /** Most linked-to internal pages, descending. */
  mostLinked: { url: string; inbound: number }[];
  /** Pages linking out the most, descending. */
  hubs: { url: string; outbound: number }[];
  /** Average internal links per crawled page. */
  averageOutboundLinks: number;
}

export interface CrawlStats {
  requested: number;
  fetched: number;
  ok: number;
  redirects: number;
  clientErrors: number;
  serverErrors: number;
  unreachable: number;
  blockedByRobots: number;
  /** URLs found but not fetched because a limit was reached. */
  notFetched: number;
  durationMs: number;
  /** Limit that ended the crawl, when one did. */
  stoppedBy: "completed" | "max_pages" | "max_duration" | "max_depth";
}

export interface SiteModel {
  entryUrl: string;
  origin: string;
  crawledAt: string;
  pages: CrawledPage[];
  architecture: SiteArchitecture;
  robots: RobotsTxt;
  sitemap: SitemapReport;
  stats: CrawlStats;
  /** What this crawl could not establish. Never silently omitted. */
  limitations: string[];
}

/** Convenience lookup. The pages array is the source of truth. */
export function pageIndex(model: SiteModel): Map<string, CrawledPage> {
  return new Map(model.pages.map((page) => [page.url, page]));
}

export function stateFromStatus(status: number, redirects: RedirectHop[]): PageState {
  if (redirects.length > 0 && status >= 200 && status < 300) return "REDIRECT";
  if (status >= 500) return "SERVER_ERROR";
  if (status >= 400) return "CLIENT_ERROR";
  return "OK";
}

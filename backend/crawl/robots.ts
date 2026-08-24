import { fetchSafely, type SafetyOptions } from "@/lib/security/ssrf-guard";

/**
 * W2 — robots.txt.
 *
 * Implements the matching rules from RFC 9309 (the Robots Exclusion
 * Protocol), which is what Google follows: longest matching rule wins,
 * `Allow` beats `Disallow` on equal length, `*` and `$` are the only
 * wildcards, and an empty `Disallow:` means "allow everything".
 *
 * Reference: https://www.rfc-editor.org/rfc/rfc9309.html
 *
 * A robots.txt that could not be fetched is `NOT_VERIFIED`, not "allows
 * everything". They are not the same claim, and a crawler that treats a
 * network error as permission is a crawler that ignores the rules whenever
 * the server hiccups.
 */

export type RobotsStatus = "VERIFIED" | "NOT_FOUND" | "NOT_VERIFIED";

export interface RobotsRule {
  type: "allow" | "disallow";
  /** The raw path pattern, wildcards included. */
  pattern: string;
}

export interface RobotsTxt {
  status: RobotsStatus;
  url: string;
  /** Rules that apply to our user-agent, after group resolution. */
  rules: RobotsRule[];
  /** Sitemaps declared in the file. Absolute URLs per the spec. */
  sitemaps: string[];
  crawlDelaySeconds: number | null;
  /** Why the file could not be read, when status is NOT_VERIFIED. */
  reason?: string;
  raw?: string;
}

export const CRAWLER_USER_AGENT = "AI-Digital-Agency-OS-Crawler";

/**
 * Parses robots.txt content. Group selection follows the spec: the most
 * specific matching user-agent group wins, falling back to `*`. Records from
 * other groups are ignored entirely rather than merged.
 */
export function parseRobotsTxt(content: string, url: string, userAgent = CRAWLER_USER_AGENT): RobotsTxt {
  const lines = content.split(/\r?\n/);
  const sitemaps: string[] = [];

  // Group state: a run of user-agent lines followed by their rules.
  const groups: { agents: string[]; rules: RobotsRule[]; crawlDelay: number | null }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastLineWasAgent = false;

  for (const rawLine of lines) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;

    const separator = line.indexOf(":");
    if (separator < 0) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }

    if (field === "user-agent") {
      // Consecutive user-agent lines share one group of rules.
      if (!current || !lastLineWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastLineWasAgent = true;
      continue;
    }

    lastLineWasAgent = false;
    if (!current) continue;

    if (field === "allow" || field === "disallow") {
      current.rules.push({ type: field, pattern: value });
    } else if (field === "crawl-delay") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) current.crawlDelay = parsed;
    }
  }

  const agent = userAgent.toLowerCase();
  // Most specific match first: an exact-ish substring match beats the wildcard.
  const specific = groups.find((group) =>
    group.agents.some((candidate) => candidate !== "*" && agent.includes(candidate))
  );
  const wildcard = groups.find((group) => group.agents.includes("*"));
  const chosen = specific ?? wildcard;

  return {
    status: "VERIFIED",
    url,
    rules: chosen?.rules ?? [],
    sitemaps,
    crawlDelaySeconds: chosen?.crawlDelay ?? null,
    raw: content,
  };
}

/** Translates a robots pattern into a regex. Only `*` and `$` are special. */
function patternToRegex(pattern: string): RegExp {
  let source = "";
  for (const char of pattern) {
    if (char === "*") source += ".*";
    else if (char === "$") source += "$";
    else source += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}`);
}

export interface RobotsDecision {
  allowed: boolean;
  /** The rule that decided it, or null when nothing matched. */
  matchedRule: RobotsRule | null;
  reason: string;
}

/**
 * Decides whether a path may be crawled. Longest match wins; on a tie, Allow
 * wins — both straight from RFC 9309 §2.2.2.
 */
export function isAllowed(robots: RobotsTxt, rawUrl: string): RobotsDecision {
  if (robots.status !== "VERIFIED") {
    return {
      allowed: true,
      matchedRule: null,
      reason:
        robots.status === "NOT_FOUND"
          ? "No hay robots.txt, así que no hay ninguna restricción declarada."
          : "No se pudo leer robots.txt; se rastrea con precaución y queda declarado como no verificado.",
    };
  }

  let path: string;
  try {
    const url = new URL(rawUrl);
    path = url.pathname + url.search;
  } catch {
    return { allowed: false, matchedRule: null, reason: "URL no válida." };
  }

  let best: { rule: RobotsRule; length: number } | null = null;

  for (const rule of robots.rules) {
    // An empty Disallow means "nothing is disallowed" — it is not a match.
    if (rule.type === "disallow" && rule.pattern === "") continue;
    if (!patternToRegex(rule.pattern).test(path)) continue;

    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.type === "allow")) {
      best = { rule, length };
    }
  }

  if (!best) {
    return { allowed: true, matchedRule: null, reason: "Ninguna regla de robots.txt afecta a esta URL." };
  }

  return {
    allowed: best.rule.type === "allow",
    matchedRule: best.rule,
    reason: `${best.rule.type === "allow" ? "Allow" : "Disallow"}: ${best.rule.pattern || "(vacío)"} en robots.txt.`,
  };
}

export async function fetchRobotsTxt(origin: string, options: SafetyOptions = {}): Promise<RobotsTxt> {
  const url = `${origin}/robots.txt`;

  try {
    const response = await fetchSafely(url, { timeoutMs: 8000, maxBytes: 500_000, ...options });

    if (response.status === 404 || response.status === 410) {
      return { status: "NOT_FOUND", url, rules: [], sitemaps: [], crawlDelaySeconds: null };
    }
    if (response.status >= 400) {
      return {
        status: "NOT_VERIFIED",
        url,
        rules: [],
        sitemaps: [],
        crawlDelaySeconds: null,
        reason: `robots.txt devolvió HTTP ${response.status}.`,
      };
    }

    return parseRobotsTxt(response.body, url);
  } catch (err) {
    return {
      status: "NOT_VERIFIED",
      url,
      rules: [],
      sitemaps: [],
      crawlDelaySeconds: null,
      reason: err instanceof Error ? err.message : "No se pudo leer robots.txt.",
    };
  }
}

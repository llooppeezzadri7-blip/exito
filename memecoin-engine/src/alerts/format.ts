import type { AlertType } from "../core/types.js";
import type { OpportunityRecord, TokenRecord } from "../db/records.js";
import type { TokenSnapshot } from "../core/model.js";
import { ageMinutes, formatAge } from "../core/time.js";

export interface AlertDraft {
  type: AlertType;
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  body: string;
  payload: Record<string, unknown>;
}

const usd = (v: number | null | undefined) => (v === null || v === undefined ? "unknown" : v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v.toFixed(0)}`);

/**
 * Professional alert text. Never "buy now": facts, score, risks, status and a manual-verification reminder.
 * Every alert carries timestamp + sources (docs/RISK_ENGINE.md §Alerts).
 */
export function formatOpportunityAlert(type: AlertType, token: TokenRecord, snap: TokenSnapshot, opp: OpportunityRecord, extra: string[] = []): AlertDraft {
  const m = snap.market;
  const age = formatAge(ageMinutes(snap.createdAt ?? token.createdAt));
  const header = type === "NEW_HIGH_POTENTIAL" ? "🚨 MEMECOIN ALERT" : type === "BREAKOUT_SETUP" ? "📈 BREAKOUT SETUP" : `🔔 ${type.replace(/_/g, " ")}`;
  const why = opp.whyDetected.length ? opp.whyDetected.map((w) => `• ${w}`).join("\n") : "• (no positive factors)";
  const risks = opp.risks.length ? opp.risks.map((r) => `• ${r}`).join("\n") : "• none recorded";
  const lines = [
    header,
    "",
    `Token: ${token.symbol ?? "?"}${token.name ? ` (${token.name})` : ""}`,
    `Chain: ${token.chain}`,
    `Age: ${age}`,
    `Market Cap: ${usd(m?.marketCapUsd.value ?? m?.fdvUsd.value)}`,
    `Liquidity: ${usd(m?.liquidityUsd.value)}`,
    `Volume 1h: ${usd(m?.volumeUsd.h1)}`,
    "",
    `Opportunity Score: ${opp.score ?? "n/a"}/100`,
    `Risk: ${opp.risk.replace(/_/g, " ")}${opp.rugRisk !== null ? ` (rug index ${opp.rugRisk})` : ""}`,
    `Exit risk: ${opp.exitRisk ?? "unknown"}`,
    `Confidence: ${opp.confidence}`,
    `Phase: ${opp.phase}`,
    `Data quality: ${Math.round(opp.dataQuality * 100)}%`,
    "",
    "WHY:",
    why,
    "",
    "RISKS:",
    risks,
    ...(opp.conflicts.length ? ["", "CONFLICTING SIGNALS:", ...opp.conflicts.map((c) => `• ${c}`)] : []),
    ...(extra.length ? ["", ...extra] : []),
    "",
    `STATUS: ${opp.statusText}`,
    "",
    `Contract: ${token.mint}`,
    `Sources: ${snap.sources.join(", ") || "none"}${snap.degradedSources.length ? ` | degraded: ${snap.degradedSources.join(", ")}` : ""}`,
    `Observed: ${snap.observedAt}`,
    "",
    "This is research output, not advice. Extremely speculative asset. No signal predicts price. Verify manually before any decision.",
  ];
  return {
    type,
    severity: type === "NEW_HIGH_POTENTIAL" || type === "BREAKOUT_SETUP" ? "INFO" : "MEDIUM",
    title: `${header} ${token.symbol ?? token.mint.slice(0, 6)} — score ${opp.score ?? "n/a"} / ${opp.risk}`,
    body: lines.join("\n"),
    payload: { score: opp.score, category: opp.category, risk: opp.risk, confidence: opp.confidence, phase: opp.phase, breakdown: opp.breakdown, gates: opp.gates, sources: snap.sources, observedAt: snap.observedAt },
  };
}

export function formatRiskAlert(type: AlertType, token: TokenRecord, snap: TokenSnapshot, opp: OpportunityRecord, reasons: string[]): AlertDraft {
  const m = snap.market;
  const sev = type === "RUG_WARNING" || type === "LIQUIDITY_DROP" ? "CRITICAL" : type === "WHALE_EXIT" || type === "EXIT_WARNING" || type === "RISK_ESCALATION" ? "HIGH" : "MEDIUM";
  const lines = [
    `⚠️ ${type.replace(/_/g, " ")}`,
    "",
    `Token: ${token.symbol ?? "?"} (${token.chain})`,
    `Liquidity: ${usd(m?.liquidityUsd.value)} | MC: ${usd(m?.marketCapUsd.value ?? m?.fdvUsd.value)}`,
    `Score: ${opp.score ?? "n/a"} | Risk: ${opp.risk.replace(/_/g, " ")} | Thesis: ${opp.thesis.replace(/_/g, " ")}`,
    "",
    "WHAT CHANGED:",
    ...(reasons.length ? reasons.map((r) => `• ${r}`) : ["• see risks"]),
    "",
    "CURRENT RISKS:",
    ...opp.risks.slice(0, 6).map((r) => `• ${r}`),
    "",
    `Status: ${opp.thesis.replace(/_/g, " ")}`,
    `Contract: ${token.mint}`,
    `Sources: ${snap.sources.join(", ")} | Observed: ${snap.observedAt}`,
  ];
  return { type, severity: sev, title: `⚠️ ${type.replace(/_/g, " ")} ${token.symbol ?? token.mint.slice(0, 6)}`, body: lines.join("\n"), payload: { reasons, thesis: opp.thesis, risk: opp.risk, rugRisk: opp.rugRisk, observedAt: snap.observedAt } };
}

/** Human-in-the-loop action links (dashboard routes); the bot itself never executes anything. */
export function actionLinks(baseUrl: string | null, token: TokenRecord): string[] {
  const mint = token.mint;
  const dash = baseUrl ? `${baseUrl.replace(/\/$/, "")}/token.html?mint=${mint}` : null;
  return [
    "ACTIONS (manual):",
    `• VIEW TOKEN: ${dash ?? "dashboard"}`,
    `• VIEW ONCHAIN DATA: https://solscan.io/token/${mint}`,
    `• VIEW CHART: https://dexscreener.com/solana/${mint}`,
    `• VIEW SECURITY: https://rugcheck.xyz/tokens/${mint}`,
    `• PAPER TRADE / WATCH / IGNORE: ${dash ?? "dashboard"}`,
  ];
}

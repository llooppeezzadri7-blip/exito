import type { AnalyzerResult, Confidence, MarketPhase, OpportunityCategory, RiskLevel } from "../core/types.js";
import type { EngineConfig } from "../config/schema.js";
import type { TokenMetrics } from "../analyzers/metrics.js";
import type { ScoreBreakdownItem } from "../db/records.js";
import type { RugAssessment } from "../risk/rug-detector.js";
import type { GateResult } from "../risk/gates.js";
import type { PhaseAssessment } from "../risk/phase.js";
import type { AdversarialAnalysis } from "./adversarial.js";
import { clamp, round } from "../core/stats.js";

export interface ScoreInput {
  results: AnalyzerResult[];
  metrics: TokenMetrics;
  rug: RugAssessment;
  gates: GateResult;
  phase: PhaseAssessment;
  adversarial: AdversarialAnalysis;
  exitRisk: number | null;
  dataQuality: number;
  narrativeSaturation: number | null; // 0..1
  weights?: Partial<EngineConfig["scoring"]["weights"]>; // learned overrides (positives only)
}

export interface ScoreOutput {
  score: number | null;
  category: OpportunityCategory;
  confidence: Confidence;
  phase: MarketPhase;
  risk: RiskLevel;
  breakdown: ScoreBreakdownItem[];
  subscores: Record<string, number | null>;
  whyDetected: string[];
  risks: string[];
  independentSignals: number;
  missingSignals: string[];
  statusText: string;
}

/**
 * OPPORTUNITY SCORER. Multi-dimensional, fully explained (+/- per factor), gated by deterministic risk rules.
 * Positive weights may be tuned by the learning engine; penalties and gates may not.
 */
export function scoreOpportunity(input: ScoreInput, cfg: EngineConfig): ScoreOutput {
  const w = { ...cfg.scoring.weights, ...(input.weights ?? {}) };
  const pen = cfg.scoring.penalties;
  const r = (name: string) => input.results.find((x) => x.analyzer === name);
  const sc = (name: string) => r(name)?.score ?? null;
  const m = (k: string): number | null => input.metrics[k] ?? null;
  const breakdown: ScoreBreakdownItem[] = [];
  const missing: string[] = [];
  const subscores: Record<string, number | null> = {
    security: sc("security"),
    liquidity: sc("liquidity"),
    market_quality: sc("microstructure"),
    holder_quality: sc("holders"),
    wallet_quality: sc("wallet-cluster"),
    deployer_quality: sc("deployer"),
    social_momentum: sc("social"),
    narrative_momentum: sc("narrative"),
    early_momentum: sc("early-momentum"),
    anomaly: sc("anomaly"),
    exit_risk: input.exitRisk,
    rug_risk: input.rug.rugRisk,
  };

  const add = (factor: string, value: number | null, weight: number, reason: string, independent = false) => {
    if (value === null) {
      missing.push(factor);
      return;
    }
    const pts = round((value / 100) * weight, 1);
    if (pts !== 0) breakdown.push({ factor, points: pts, reason, independentSignal: independent && value >= 60 });
  };
  // ---- positives ----
  add("early_momentum", sc("early-momentum"), w.early_momentum, `early momentum ${sc("early-momentum") ?? "?"}/100`, true);
  const hgc = r("holders")?.metrics.holder_growth_component ?? null;
  const hgWin = m("holders_growth_15m") !== null ? "15m" : m("holders_growth_1h") !== null ? "1h" : "5m";
  add("holder_growth", hgc, w.holder_growth, `holder growth ${fmt(m(`holders_growth_${hgWin}`))}% / ${hgWin}`, true);
  add("liquidity", sc("liquidity"), w.liquidity, `liquidity score ${sc("liquidity") ?? "?"}`, true);
  add("social_momentum", sc("social"), w.social_momentum, `social momentum ${sc("social") ?? "?"}`, true);
  add("narrative", sc("narrative"), w.narrative, `narrative momentum ${sc("narrative") ?? "?"}`);
  add("market_quality", sc("microstructure"), w.market_quality, `market quality ${sc("microstructure") ?? "?"}`, true);
  add("security", sc("security"), w.security, `security ${sc("security") ?? "?"}`);
  add("deployer", sc("deployer"), w.deployer, `deployer reputation ${sc("deployer") ?? "?"}`);
  add("wallet_quality", sc("wallet-cluster"), w.wallet_quality, `wallet quality ${sc("wallet-cluster") ?? "?"}`);

  // ---- penalties (never learned) ----
  const top10 = m("top10_pct") ?? r("holders")?.metrics.top10_pct ?? null;
  if (top10 !== null && top10 > 25) breakdown.push({ factor: "wallet_concentration", points: -round(Math.min(pen.wallet_concentration_max, ((top10 - 25) / 45) * pen.wallet_concentration_max), 1), reason: `top10 hold ${top10.toFixed(0)}%` });
  const dep = sc("deployer");
  if (dep === null) breakdown.push({ factor: "deployer_uncertainty", points: -round(pen.deployer_uncertainty_max * 0.6, 1), reason: "deployer unknown" });
  else if (dep < 40) breakdown.push({ factor: "deployer_uncertainty", points: -round(pen.deployer_uncertainty_max * ((40 - dep) / 40), 1), reason: `deployer reputation ${dep}` });
  if (input.exitRisk !== null && input.exitRisk > 30) breakdown.push({ factor: "exit_risk", points: -round(((input.exitRisk - 30) / 70) * pen.exit_risk_max, 1), reason: `exit risk ${input.exitRisk}` });
  if (input.phase.phase === "LATE") breakdown.push({ factor: "late_phase", points: -round(pen.late_phase_max * Math.max(0.5, input.phase.latePenalty), 1), reason: input.phase.reasons.join("; ") || "late phase" });
  if (input.phase.phase === "EXHAUSTED") breakdown.push({ factor: "exhausted_phase", points: -round(pen.exhausted_phase_max * Math.max(0.6, input.phase.latePenalty), 1), reason: input.phase.reasons.join("; ") || "momentum exhausted" });
  if (input.narrativeSaturation !== null && input.narrativeSaturation > 0.6) breakdown.push({ factor: "narrative_saturation", points: -round(pen.narrative_saturation_max * input.narrativeSaturation, 1), reason: "narrative saturated" });
  const an = r("anomaly")?.metrics.anomaly_count ?? 0;
  if (an && an > 0) breakdown.push({ factor: "anomalies", points: -round(Math.min(pen.anomaly_max, an * 4), 1), reason: `${an} statistical anomalies` });
  if (input.adversarial.conflicts.length) breakdown.push({ factor: "conflicting_signals", points: -round(Math.min(pen.conflict_max, input.adversarial.conflicts.length * 4), 1), reason: input.adversarial.conflicts.join("; ") });
  // rug risk is a gate, but also a graded penalty below the gate
  if (input.rug.rugRisk !== null && input.rug.rugRisk > 20) breakdown.push({ factor: "rug_risk", points: -round(((input.rug.rugRisk - 20) / 80) * 25, 1), reason: `rug risk ${input.rug.rugRisk}: ${input.rug.contributions.slice(0, 3).map((c) => c.code.toLowerCase()).join(", ")}` });

  const known = input.results.filter((x) => x.score !== null).length;
  const total = known < 3 ? null : clamp(round(breakdown.reduce((a, b) => a + b.points, 0), 1), 0, 100);
  breakdown.sort((a, b) => b.points - a.points);
  const independentSignals = new Set(breakdown.filter((b) => b.independentSignal).map((b) => b.factor)).size;

  // ---- confidence ----
  const snaps = input.metrics.snapshots_count ?? 0;
  let confidence: Confidence = "LOW";
  const cc = cfg.scoring.confidence;
  if (snaps >= cc.min_snapshots_for_high && input.dataQuality >= cc.min_data_quality_for_high && known >= 6) confidence = "HIGH";
  else if (snaps >= cc.min_snapshots_for_medium && known >= 4) confidence = "MEDIUM";
  if (input.adversarial.conflicts.length >= 2) confidence = lower(confidence);
  if (input.adversarial.conflicts.length >= 4) confidence = lower(confidence);
  if (missing.length >= 4) confidence = lower(confidence);
  if (total === null) confidence = "UNKNOWN";

  // ---- category ----
  const g = cfg.risk_gates;
  let category: OpportunityCategory;
  if (input.gates.forcedCategory) category = input.gates.forcedCategory;
  else if (total === null) category = "INSUFFICIENT_DATA";
  else if (input.rug.level === "EXTREME_RISK") category = "EXTREME_RISK";
  else if (total >= g.high_conviction_min_score && independentSignals >= g.high_conviction_min_independent_signals && input.phase.phase === "EARLY" && confidence !== "LOW") category = "HIGH_CONVICTION_SETUP";
  else if (total >= g.watchlist_min_score && input.phase.phase !== "EXHAUSTED") category = "WATCHLIST";
  else category = "NO_OPPORTUNITY";
  // A high score with extreme upside but too much risk is still shown, as EXTREME_RISK (never as a setup).
  if (category === "NO_OPPORTUNITY" && total !== null && total >= g.watchlist_min_score && input.rug.level === "HIGH_RISK") category = "EXTREME_RISK";

  const why = breakdown.filter((b) => b.points > 0).slice(0, 6).map((b) => `${b.reason} (+${b.points})`);
  const risks = [...breakdown.filter((b) => b.points < 0).map((b) => `${b.reason} (${b.points})`), ...input.rug.flags.filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH").map((f) => f.message)].slice(0, 8);
  const statusText = statusFor(category, input.phase.phase, confidence);
  return { score: total, category, confidence, phase: input.phase.phase, risk: input.rug.level, breakdown, subscores, whyDetected: why, risks, independentSignals, missingSignals: missing, statusText };
}

function lower(c: Confidence): Confidence {
  return c === "HIGH" ? "MEDIUM" : c === "MEDIUM" ? "LOW" : c;
}
function fmt(v: number | null): string {
  return v === null ? "?" : v.toFixed(0);
}
export function statusFor(category: OpportunityCategory, phase: MarketPhase, confidence: Confidence): string {
  switch (category) {
    case "HIGH_CONVICTION_SETUP":
      return `SETUP DETECTED — ${phase} — REQUIRES MANUAL VERIFICATION (confidence ${confidence})`;
    case "WATCHLIST":
      return phase === "EARLY" ? "EARLY SETUP — REQUIRES CONFIRMATION" : `WATCHLIST — ${phase} PHASE`;
    case "EXTREME_RISK":
      return "EXTREME RISK — NOT AN OPPORTUNITY";
    case "INSUFFICIENT_DATA":
      return "INSUFFICIENT_DATA";
    case "SECURITY_UNVERIFIED":
      return "SECURITY_UNVERIFIED";
    case "INVESTIGATE":
      return "INVESTIGATE — wallet manipulation suspected";
    case "REJECTED":
      return "REJECTED";
    default:
      return "NO OPPORTUNITY";
  }
}

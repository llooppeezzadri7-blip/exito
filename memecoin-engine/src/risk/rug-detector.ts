import type { AnalyzerResult, Flag, RiskLevel, Severity } from "../core/types.js";
import { clamp, round } from "../core/stats.js";

/**
 * RUG PULL DETECTOR: aggregates flags from every analyzer into a deterministic rug-risk index (0..100)
 * and a classification. Weights are code-level constants on purpose (risk gates are never learned).
 * "RELATIVELY_LOW_RISK" is the best possible label — nothing is ever "safe".
 */
const FLAG_WEIGHTS: Record<string, number> = {
  MINT_AUTHORITY_ACTIVE: 35,
  FREEZE_AUTHORITY_ACTIVE: 35,
  SUSPICIOUS_PERMISSIONS: 25,
  SUSPICIOUS_PROGRAM: 25,
  REPORTED_RUGGED: 60,
  REPORTED_RISK: 6,
  SUSPICIOUS_METADATA: 3,
  UNKNOWN_CONFIGURATION: 15,
  SUPPLY_CONCENTRATION: 14,
  DEPLOYER_HOLDS_SUPPLY: 12,
  FLAGGED_INSIDERS: 10,
  WHALE_DISTRIBUTION: 12,
  TOO_FEW_HOLDERS: 8,
  HOLDERS_DECLINING: 6,
  DEPLOYER_PREVIOUS_RUGS: 30,
  DEPLOYER_SERIAL_LAUNCHER: 8,
  DEPLOYER_NEW_WALLET: 4,
  DEPLOYER_THROWAWAY: 5,
  DEPLOYER_UNKNOWN: 4,
  SUSPICIOUS_WALLET_CLUSTER: 14,
  LIQUIDITY_DROP: 40,
  LIQUIDITY_DECLINING: 8,
  LP_UNLOCKED: 10,
  LP_LOCK_UNKNOWN: 3,
  THIN_LIQUIDITY_VS_MC: 8,
  SUSPICIOUS_VOLUME_VS_LIQUIDITY: 6,
  ABNORMAL_VOLUME: 6,
  VOLUME_WITHOUT_HOLDERS: 10,
  VOLUME_WITHOUT_LIQUIDITY: 6,
  REPETITIVE_BUYS: 5,
  SYMMETRIC_FLOW: 4,
  WASH_TRADING_SUSPECTED: 12,
  SINGLE_WALLET_DOMINATES_VOLUME: 10,
  BOT_PATTERN: 5,
  LARGE_SELLS: 4,
  FAKE_ENGAGEMENT: 8,
  SOCIAL_CONCENTRATED_PROMOTION: 6,
  SOURCE_DISAGREEMENT: 4,
  ABNORMAL_LIQUIDITY: 4,
  ABNORMAL_TX_PATTERN: 4,
  HOLDER_GROWTH_ABNORMAL: 3,
};

const SEVERITY_MULT: Record<Severity, number> = { INFO: 0, LOW: 0.5, MEDIUM: 1, HIGH: 1.4, CRITICAL: 1.8 };

export interface RugAssessment {
  rugRisk: number | null;
  level: RiskLevel;
  flags: Flag[];
  contributions: { code: string; points: number }[];
  unknownSecurity: boolean;
}

export function assessRugRisk(results: AnalyzerResult[], thresholds: { extreme: number }): RugAssessment {
  const flags = results.flatMap((r) => r.flags).filter((f) => f.severity !== "INFO");
  const security = results.find((r) => r.analyzer === "security");
  const unknownSecurity = !security || security.score === null;
  if (results.every((r) => r.score === null)) return { rugRisk: null, level: "UNKNOWN", flags, contributions: [], unknownSecurity };
  // Same code may appear from several analyzers with the same evidence: count each code once at its max severity
  const byCode = new Map<string, Flag>();
  for (const f of flags) {
    const prev = byCode.get(f.code);
    if (!prev || SEVERITY_MULT[f.severity] > SEVERITY_MULT[prev.severity]) byCode.set(f.code, f);
  }
  const contributions: { code: string; points: number }[] = [];
  let risk = 0;
  for (const [code, f] of byCode) {
    const w = FLAG_WEIGHTS[code];
    if (!w) continue;
    const pts = round(w * SEVERITY_MULT[f.severity], 1);
    contributions.push({ code, points: pts });
    risk += pts;
  }
  contributions.sort((a, b) => b.points - a.points);
  risk = clamp(round(risk, 1), 0, 100);
  let level: RiskLevel;
  if (unknownSecurity) level = risk >= thresholds.extreme ? "EXTREME_RISK" : "UNKNOWN";
  else if (risk >= thresholds.extreme) level = "EXTREME_RISK";
  else if (risk >= 55) level = "HIGH_RISK";
  else if (risk >= 30) level = "MEDIUM_RISK";
  else if (risk >= 15) level = "LOW_RISK";
  else level = "RELATIVELY_LOW_RISK";
  return { rugRisk: risk, level, flags: [...byCode.values()].sort((a, b) => SEVERITY_MULT[b.severity] - SEVERITY_MULT[a.severity]), contributions, unknownSecurity };
}

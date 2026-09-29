import type { AnalyzerResult, Evidence, Flag } from "../core/types.js";
import { isKnown } from "../core/types.js";
import type { TokenSnapshot } from "../core/model.js";
import type { DeployerRecord } from "../db/records.js";
import { clamp, round } from "../core/stats.js";

/**
 * DEPLOYER ANALYSIS → DEPLOYER_REPUTATION_SCORE. A new wallet is UNKNOWN, not malicious.
 * `history` is what the engine has recorded about this deployer's earlier tokens (own DB) —
 * the only place where "previous rugs" can be counted honestly.
 */
export function analyzeDeployer(snap: TokenSnapshot, history: DeployerRecord | null): AnalyzerResult {
  const now = new Date().toISOString();
  const flags: Flag[] = [];
  const evidence: Evidence[] = [];
  const out: Record<string, number | null> = {};
  const d = snap.deployer;
  if (!d || !isKnown(d.address)) {
    flags.push({ code: "DEPLOYER_UNKNOWN", severity: "MEDIUM", message: "deployer wallet could not be determined" });
    return { analyzer: "deployer", score: null, confidence: "UNKNOWN", flags, evidence, metrics: out, computedAt: now };
  }
  const addr = d.address.value;
  evidence.push({ kind: "FACT", statement: `deployer ${addr}`, source: d.source, observedAt: d.observedAt });
  let score = 50; // UNKNOWN baseline: neither trusted nor condemned
  let knownSignals = 0;
  let confidence: AnalyzerResult["confidence"] = "LOW";

  if (isKnown(d.walletAgeDays)) {
    knownSignals++;
    const age = d.walletAgeDays.value;
    out.deployer_wallet_age_days = round(age, 1);
    evidence.push({ kind: "FACT", statement: `deployer wallet age ${round(age, 1)} days, ${d.txCount.value ?? "?"} txs`, source: d.source, observedAt: d.observedAt });
    if (age < 1) {
      flags.push({ code: "DEPLOYER_NEW_WALLET", severity: "MEDIUM", message: "deployer wallet is less than 1 day old" });
      score -= 10;
    } else if (age > 90) score += 10;
  }
  if (isKnown(d.txCount) && d.txCount.value < 5) {
    flags.push({ code: "DEPLOYER_THROWAWAY", severity: "MEDIUM", message: "deployer wallet has almost no history (possible burner)" });
    score -= 5;
  }
  if (isKnown(d.fundedBy)) {
    knownSignals++;
    out.deployer_funder_known = 1;
    evidence.push({ kind: "FACT", statement: `deployer initially funded by ${d.fundedBy.value}`, source: d.source, observedAt: d.observedAt });
  }
  if (isKnown(d.holdsPct)) {
    knownSignals++;
    out.deployer_holds_pct = d.holdsPct.value;
    if (d.holdsPct.value > 10) {
      score -= 15;
      flags.push({ code: "DEPLOYER_HOLDS_SUPPLY", severity: "HIGH", message: `deployer holds ${d.holdsPct.value.toFixed(1)}% of supply` });
    }
  }
  if (history) {
    knownSignals += 2;
    out.deployer_previous_tokens = history.tokensCreated;
    out.deployer_previous_rugs = history.tokensRugged;
    out.deployer_previous_abandoned = history.tokensAbandoned;
    if (history.tokensCreated > 1) {
      const bad = history.tokensRugged + history.tokensAbandoned;
      const badRate = bad / history.tokensCreated;
      evidence.push({ kind: "FACT", statement: `deployer created ${history.tokensCreated} tokens tracked by this engine; ${history.tokensRugged} rugged, ${history.tokensAbandoned} abandoned`, source: "engine-db", observedAt: history.lastSeenAt });
      if (history.tokensRugged > 0) {
        score -= Math.min(45, 25 + history.tokensRugged * 10);
        flags.push({ code: "DEPLOYER_PREVIOUS_RUGS", severity: "CRITICAL", message: `deployer linked to ${history.tokensRugged} previous rug/drain event(s)` });
      } else if (badRate > 0.5) {
        score -= 20;
        flags.push({ code: "DEPLOYER_SERIAL_LAUNCHER", severity: "HIGH", message: `${Math.round(badRate * 100)}% of the deployer's previous tokens were abandoned` });
      } else if (history.tokensCreated >= 5) {
        score -= 10;
        flags.push({ code: "DEPLOYER_SERIAL_LAUNCHER", severity: "MEDIUM", message: `deployer launched ${history.tokensCreated} tokens` });
      }
      if (history.tokensRugged === 0 && badRate < 0.3 && history.tokensCreated >= 2) score += 10;
      confidence = "MEDIUM";
    }
  }
  if (knownSignals >= 3) confidence = confidence === "LOW" ? "MEDIUM" : confidence;
  if (knownSignals === 0) {
    flags.push({ code: "DEPLOYER_UNKNOWN", severity: "LOW", message: "insufficient deployer information (UNKNOWN)" });
    return { analyzer: "deployer", score: null, confidence: "UNKNOWN", flags, evidence, metrics: out, computedAt: now };
  }
  score = clamp(score, 0, 100);
  out.deployer_score = score;
  return { analyzer: "deployer", score, confidence, flags, evidence, metrics: out, computedAt: now };
}

export function reputationLabel(score: number | null): DeployerRecord["reputation"] {
  if (score === null) return "UNKNOWN";
  if (score < 30) return "POOR";
  if (score < 50) return "MIXED";
  if (score < 70) return "FAIR";
  return "GOOD";
}

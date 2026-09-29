import type { AnalyzerResult, Evidence, Flag } from "../core/types.js";
import { isKnown } from "../core/types.js";
import type { TokenSnapshot } from "../core/model.js";
import { clamp } from "../core/stats.js";

/**
 * TOKEN SECURITY ENGINE.
 * Sources: on-chain mint account (authoritative) + third-party report (advisory, cross-check only).
 * Never invents safety: when the mint could not be read the result is SECURITY_UNVERIFIED (score null).
 */
export function analyzeSecurity(snap: TokenSnapshot): AnalyzerResult {
  const s = snap.security;
  const r = snap.securityReport;
  const flags: Flag[] = [];
  const evidence: Evidence[] = [];
  const metrics: Record<string, number | null> = {};
  const now = new Date().toISOString();

  const onchainKnown = !!s && isKnown(s.mintAuthorityActive) && isKnown(s.freezeAuthorityActive);
  const reportKnown = !!r && (isKnown(r.mintAuthorityActive) || isKnown(r.freezeAuthorityActive));

  if (!onchainKnown && !reportKnown) {
    flags.push({ code: "UNKNOWN_CONFIGURATION", severity: "HIGH", message: "Mint authorities could not be verified from any source" });
    return { analyzer: "security", score: null, confidence: "UNKNOWN", flags, evidence, metrics, computedAt: now };
  }

  // Prefer on-chain facts; fall back to the report with lower confidence.
  const mintActive = onchainKnown ? s!.mintAuthorityActive.value! : r!.mintAuthorityActive.value;
  const freezeActive = onchainKnown ? s!.freezeAuthorityActive.value! : r!.freezeAuthorityActive.value;
  const src = onchainKnown ? s!.source : r!.source;
  const observedAt = onchainKnown ? s!.observedAt : r!.observedAt;
  let score = 100;

  const fact = (statement: string, data?: Record<string, unknown>) => evidence.push({ kind: "FACT", statement, source: src, observedAt, data });

  if (mintActive === true) {
    score -= 45;
    flags.push({ code: "MINT_AUTHORITY_ACTIVE", severity: "CRITICAL", message: "Mint authority is active: supply can be inflated at any time" });
    fact("mint authority present on mint account");
  } else if (mintActive === false) fact("mint authority revoked (null)");
  else flags.push({ code: "UNKNOWN_CONFIGURATION", severity: "MEDIUM", message: "mint authority unknown" });

  if (freezeActive === true) {
    score -= 40;
    flags.push({ code: "FREEZE_AUTHORITY_ACTIVE", severity: "CRITICAL", message: "Freeze authority is active: holder accounts can be frozen (honeypot-style exit block)" });
    fact("freeze authority present on mint account");
  } else if (freezeActive === false) fact("freeze authority revoked (null)");
  else flags.push({ code: "UNKNOWN_CONFIGURATION", severity: "MEDIUM", message: "freeze authority unknown" });

  if (s) {
    if (s.permanentDelegate.value === true) {
      score -= 40;
      flags.push({ code: "SUSPICIOUS_PERMISSIONS", severity: "CRITICAL", message: "Token-2022 permanentDelegate: a delegate can move/burn tokens from any account" });
    }
    if (s.transferHook.value === true) {
      score -= 25;
      flags.push({ code: "SUSPICIOUS_PROGRAM", severity: "HIGH", message: "Token-2022 transferHook: custom program runs on every transfer (can block sells)" });
    }
    if ((s.transferFeeBps.value ?? 0) > 0) {
      const bps = s.transferFeeBps.value!;
      score -= bps >= 500 ? 25 : 10;
      flags.push({ code: "SUSPICIOUS_PERMISSIONS", severity: bps >= 500 ? "HIGH" : "MEDIUM", message: `Transfer fee of ${(bps / 100).toFixed(2)}% on every transfer` });
    }
    if (s.nonTransferable.value === true) {
      score -= 60;
      flags.push({ code: "SUSPICIOUS_PERMISSIONS", severity: "CRITICAL", message: "Token is non-transferable" });
    }
    if (s.metadataMutable.value === true) {
      score -= 5;
      flags.push({ code: "SUSPICIOUS_METADATA", severity: "LOW", message: "Metadata is mutable (name/symbol/image can change)" });
    }
    if (isKnown(s.tokenProgram) && s.tokenProgram.value !== "spl-token" && s.tokenProgram.value !== "spl-token-2022") {
      score -= 50;
      flags.push({ code: "SUSPICIOUS_PROGRAM", severity: "CRITICAL", message: `Mint owned by unexpected program ${s.tokenProgram.value}` });
    }
    metrics.token2022 = s.tokenProgram.value === "spl-token-2022" ? 1 : 0;
    metrics.transfer_fee_bps = s.transferFeeBps.value;
  }

  // Cross-check with the third-party report: disagreement lowers confidence, never raises the score.
  let confidence: AnalyzerResult["confidence"] = onchainKnown ? "HIGH" : "LOW";
  if (onchainKnown && reportKnown) {
    const disagree = (isKnown(r!.mintAuthorityActive) && r!.mintAuthorityActive.value !== mintActive) || (isKnown(r!.freezeAuthorityActive) && r!.freezeAuthorityActive.value !== freezeActive);
    if (disagree) {
      confidence = "MEDIUM";
      flags.push({ code: "SOURCE_DISAGREEMENT", severity: "MEDIUM", message: "On-chain authorities disagree with third-party report (using on-chain)" });
    }
  }
  if (r) {
    if (r.rugged.value === true) {
      score -= 60;
      flags.push({ code: "REPORTED_RUGGED", severity: "CRITICAL", message: "Third-party report marks token as rugged" });
    }
    for (const risk of r.risks) {
      const lvl = risk.level.toLowerCase();
      const name = risk.name.toLowerCase();
      // Only take *security-class* risks here; holder/liquidity risks are handled by their own analyzers.
      if (/(authority|mint|freeze|delegate|hook|fee|metadata|program|honeypot)/.test(name)) {
        const pen = lvl === "danger" ? 15 : lvl === "warn" ? 5 : 0;
        if (pen) {
          score -= pen;
          flags.push({ code: "REPORTED_RISK", severity: lvl === "danger" ? "HIGH" : "LOW", message: `${r.source}: ${risk.name}${risk.description ? " — " + risk.description : ""}` });
        }
      }
    }
    metrics.report_risk_index = r.riskIndex.value;
    evidence.push({ kind: "INFERENCE", statement: `third-party risk index ${r.riskIndex.value ?? "unknown"}/100`, source: r.source, observedAt: r.observedAt });
  }
  score = clamp(score, 0, 100);
  metrics.security_score = score;
  metrics.mint_authority = mintActive === null ? null : mintActive ? 1 : 0;
  metrics.freeze_authority = freezeActive === null ? null : freezeActive ? 1 : 0;
  return { analyzer: "security", score, confidence, flags, evidence, metrics, computedAt: now };
}

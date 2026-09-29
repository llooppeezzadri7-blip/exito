import type { OpportunityCategory } from "../core/types.js";
import type { EngineConfig } from "../config/schema.js";

export interface GateInput {
  rugRisk: number | null;
  exitRisk: number | null;
  dataQuality: number;
  securityScore: number | null;
  securityUnknown: boolean;
  clusterSuspected: boolean;
  mintAuthority: boolean | null;
  freezeAuthority: boolean | null;
  liquidityUsd: number | null;
  holders: number | null;
}

export interface GateResult {
  gates: { gate: string; passed: boolean; detail: string }[];
  /** Forced category when a gate fails; null when all opportunity gates pass. */
  forcedCategory: OpportunityCategory | null;
  blockAsOpportunity: boolean;
}

/**
 * RISK GATING — deterministic, evaluated before any score can promote a token.
 * Learned weights can never change these; only config.yaml can (and it is audited).
 */
export function evaluateGates(i: GateInput, cfg: EngineConfig): GateResult {
  const g = cfg.risk_gates;
  const f = cfg.filters;
  const gates: GateResult["gates"] = [];
  let forced: OpportunityCategory | null = null;
  const fail = (gate: string, detail: string, category: OpportunityCategory) => {
    gates.push({ gate, passed: false, detail });
    if (!forced) forced = category;
  };
  const pass = (gate: string, detail: string) => gates.push({ gate, passed: true, detail });

  // Hard filters first (REJECTED)
  if (f.reject_if_freeze_authority && i.freezeAuthority === true) fail("freeze_authority", "freeze authority active", "REJECTED");
  else pass("freeze_authority", i.freezeAuthority === null ? "unknown" : "revoked");
  if (f.reject_if_mint_authority && i.mintAuthority === true) fail("mint_authority", "mint authority active", "REJECTED");
  else pass("mint_authority", i.mintAuthority === null ? "unknown" : "revoked");
  if (i.liquidityUsd !== null && i.liquidityUsd < f.min_liquidity_usd) fail("min_liquidity", `liquidity $${Math.round(i.liquidityUsd)} < $${f.min_liquidity_usd}`, "REJECTED");
  else pass("min_liquidity", i.liquidityUsd === null ? "unknown" : `$${Math.round(i.liquidityUsd)}`);
  if (i.holders !== null && i.holders < f.min_holders) fail("min_holders", `${i.holders} holders < ${f.min_holders}`, "REJECTED");
  else pass("min_holders", i.holders === null ? "unknown" : `${i.holders}`);

  // Opportunity gates
  if (i.dataQuality < g.min_data_quality_for_opportunity) fail("data_quality", `data quality ${i.dataQuality.toFixed(2)} < ${g.min_data_quality_for_opportunity}`, "INSUFFICIENT_DATA");
  else pass("data_quality", i.dataQuality.toFixed(2));
  if (i.securityUnknown) fail("security_verified", "security could not be verified on-chain", "SECURITY_UNVERIFIED");
  else if (i.securityScore !== null && i.securityScore < g.min_security_score) fail("security_score", `security ${i.securityScore} < ${g.min_security_score}`, "REJECTED");
  else pass("security_score", `${i.securityScore}`);
  if (i.clusterSuspected) fail("wallet_manipulation", "coordinated wallet cluster suspected", "INVESTIGATE");
  else pass("wallet_manipulation", "no high-risk cluster");
  if (i.rugRisk !== null && i.rugRisk > g.max_rug_risk_for_opportunity) fail("rug_risk", `rug risk ${i.rugRisk} > ${g.max_rug_risk_for_opportunity}`, i.rugRisk >= g.extreme_risk_rug_threshold ? "EXTREME_RISK" : "NO_OPPORTUNITY");
  else pass("rug_risk", i.rugRisk === null ? "unknown" : `${i.rugRisk}`);
  if (i.exitRisk !== null && i.exitRisk > g.max_exit_risk_for_opportunity) fail("exit_risk", `exit risk ${i.exitRisk} > ${g.max_exit_risk_for_opportunity}`, "NO_OPPORTUNITY");
  else pass("exit_risk", i.exitRisk === null ? "unknown" : `${i.exitRisk}`);
  return { gates, forcedCategory: forced, blockAsOpportunity: forced !== null };
}

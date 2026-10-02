import type { AnalyzerResult, Evidence, Flag } from "../core/types.js";
import { isKnown } from "../core/types.js";
import type { HolderInfo, TokenSnapshot } from "../core/model.js";
import type { TokenMetrics } from "./metrics.js";
import type { EngineConfig } from "../config/schema.js";
import { clamp, gini, round, scale } from "../core/stats.js";

export interface HolderStats {
  top10Pct: number | null;
  top20Pct: number | null;
  top50Pct: number | null;
  largestNonLpPct: number | null;
  lpPct: number | null;
  nonLpHolders: HolderInfo[];
  whales: HolderInfo[];
  gini: number | null;
}

/** Pure helper: concentration stats excluding pool/LP accounts. */
export function holderStats(top: HolderInfo[], whalePct: number): HolderStats {
  const nonLp = top.filter((h) => !h.isLpPool).sort((a, b) => b.pct - a.pct);
  const lpPct = top.filter((h) => h.isLpPool).reduce((a, h) => a + h.pct, 0);
  const sum = (n: number) => (nonLp.length ? round(nonLp.slice(0, n).reduce((a, h) => a + h.pct, 0), 2) : null);
  return {
    top10Pct: sum(10),
    top20Pct: sum(20),
    top50Pct: sum(50),
    largestNonLpPct: nonLp[0]?.pct ?? null,
    lpPct: top.length ? round(lpPct, 2) : null,
    nonLpHolders: nonLp,
    whales: nonLp.filter((h) => h.pct >= whalePct),
    gini: nonLp.length >= 5 ? gini(nonLp.map((h) => h.pct)) : null,
  };
}

/**
 * HOLDER ANALYSIS. Whales are not penalized per se; concentration + behaviour are.
 * Behaviour (accumulating/distributing) is inferred from the wallet's recent trades when available.
 */
export function analyzeHolders(snap: TokenSnapshot, metrics: TokenMetrics, cfg: EngineConfig): AnalyzerResult {
  const now = new Date().toISOString();
  const flags: Flag[] = [];
  const evidence: Evidence[] = [];
  const out: Record<string, number | null> = {};
  const h = snap.holders;
  const top = h?.top?.length ? h.top : snap.securityReport?.topHolders ?? [];
  const src = h?.top?.length ? h!.source : snap.securityReport?.source ?? "unknown";
  const observedAt = h?.observedAt ?? snap.securityReport?.observedAt ?? now;
  if (!top.length) {
    return { analyzer: "holders", score: null, confidence: "UNKNOWN", flags: [{ code: "INSUFFICIENT_DATA", severity: "INFO", message: "top holders unknown" }], evidence, metrics: out, computedAt: now };
  }
  const st = holderStats(top, cfg.holders.whale_pct);
  const total = h && isKnown(h.totalHolders) ? h.totalHolders.value : snap.securityReport?.totalHolders.value ?? null;
  evidence.push({ kind: "FACT", statement: `top10 (excl. pools) hold ${st.top10Pct?.toFixed(1)}%; largest single wallet ${st.largestNonLpPct?.toFixed(1)}%; pools hold ${st.lpPct?.toFixed(1)}%`, source: src, observedAt, data: { top10: st.top10Pct, largest: st.largestNonLpPct, lp: st.lpPct } });
  if (total !== null) evidence.push({ kind: "FACT", statement: `${total} holders`, source: src, observedAt });

  // Concentration score: top10 ≤ 20% → 100, ≥ 70% → 0
  let conc = scale(st.top10Pct ?? 100, 20, cfg.filters.max_top10_holder_pct, true);
  if ((st.largestNonLpPct ?? 0) > cfg.filters.max_single_holder_pct_excl_lp) {
    conc = Math.min(conc, 10);
    flags.push({ code: "SUPPLY_CONCENTRATION", severity: "CRITICAL", message: `single wallet holds ${st.largestNonLpPct!.toFixed(1)}% of supply` });
  } else if ((st.largestNonLpPct ?? 0) > 10) {
    flags.push({ code: "SUPPLY_CONCENTRATION", severity: "MEDIUM", message: `largest wallet holds ${st.largestNonLpPct!.toFixed(1)}%` });
  }
  if ((st.top10Pct ?? 0) > cfg.filters.max_top10_holder_pct) flags.push({ code: "SUPPLY_CONCENTRATION", severity: "HIGH", message: `top10 wallets hold ${st.top10Pct!.toFixed(1)}%` });

  // Deployer share
  const deployer = snap.deployer?.address.value ?? null;
  const deployerHolding = deployer ? st.nonLpHolders.find((x) => x.owner === deployer || x.address === deployer) : undefined;
  if (deployerHolding && deployerHolding.pct > 5) flags.push({ code: "DEPLOYER_HOLDS_SUPPLY", severity: deployerHolding.pct > 15 ? "HIGH" : "MEDIUM", message: `deployer holds ${deployerHolding.pct.toFixed(1)}% of supply` });
  const insiders = top.filter((x) => x.label?.includes("insider"));
  if (insiders.length) flags.push({ code: "FLAGGED_INSIDERS", severity: "MEDIUM", message: `${insiders.length} top holders flagged as insiders by ${src}` });

  // Whale behaviour from trades (if any): net flow of whale wallets in the last hour
  const whaleAddrs = new Set(st.whales.flatMap((w) => [w.address, w.owner].filter((x): x is string => !!x)));
  // Reference time = when the snapshot was observed (deterministic replays), not the wall clock.
  const refMs = new Date(snap.observedAt).getTime() || Date.now();
  const hourAgo = refMs - 3_600_000;
  let whaleNetUsd = 0;
  let whaleSells = 0;
  let whaleBuys = 0;
  for (const t of snap.trades) {
    if (!t.wallet || !whaleAddrs.has(t.wallet) || new Date(t.ts).getTime() < hourAgo) continue;
    const usd = t.amountUsd ?? 0;
    if (t.kind === "sell") { whaleSells++; whaleNetUsd -= usd; } else { whaleBuys++; whaleNetUsd += usd; }
  }
  let behaviour = 50; // neutral when unknown
  if (whaleBuys + whaleSells > 0) {
    behaviour = whaleNetUsd > 0 ? 80 : whaleNetUsd < 0 ? 20 : 50;
    if (whaleSells > whaleBuys && whaleNetUsd < 0) flags.push({ code: "WHALE_DISTRIBUTION", severity: "HIGH", message: `whales net sold $${round(-whaleNetUsd, 0)} in the last hour (${whaleSells} sells)` });
    else if (whaleBuys > whaleSells) evidence.push({ kind: "INFERENCE", statement: `whales net accumulating (+$${round(whaleNetUsd, 0)} / 1h)`, source: snap.trades[0]?.source ?? "trades", observedAt: now });
  }

  // Growth of holder count (multi-timeframe; series-based)
  const g5 = metrics.holders_growth_5m ?? null;
  const g15 = metrics.holders_growth_15m ?? null;
  const g1h = metrics.holders_growth_1h ?? null;
  let growth = 50;
  const g = g15 ?? g1h ?? g5;
  if (g !== null) growth = g > 0 ? clamp(50 + Math.min(50, g * 1.5), 0, 100) : clamp(50 + Math.max(-50, g * 2), 0, 100);
  if (g15 !== null && g15 < -5) flags.push({ code: "HOLDERS_DECLINING", severity: "MEDIUM", message: `holders ${g15.toFixed(1)}% in 15m` });
  const minHolders = total !== null && total < cfg.filters.min_holders;
  if (minHolders) flags.push({ code: "TOO_FEW_HOLDERS", severity: "HIGH", message: `only ${total} holders` });

  const score = clamp(round(conc * 0.5 + behaviour * 0.2 + growth * 0.3, 1), 0, 100);
  Object.assign(out, { top10_pct: st.top10Pct, top20_pct: st.top20Pct, largest_wallet_pct: st.largestNonLpPct, lp_pct: st.lpPct, holders_gini: st.gini, whale_count: st.whales.length, whale_net_usd_1h: whaleBuys + whaleSells ? round(whaleNetUsd, 0) : null, holders_total: total, holder_score: score, holder_growth_component: g === null ? null : growth });
  return { analyzer: "holders", score, confidence: h?.top?.length ? "HIGH" : "MEDIUM", flags, evidence, metrics: out, computedAt: now };
}

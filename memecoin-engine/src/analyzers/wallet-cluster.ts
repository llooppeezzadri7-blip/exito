import type { AnalyzerResult, Evidence, Flag } from "../core/types.js";
import type { HolderInfo, TradeEvent, WalletProfile } from "../core/model.js";
import type { WalletClusterRecord } from "../db/records.js";
import type { Chain } from "../core/types.js";
import { clamp, round } from "../core/stats.js";

export interface ClusterInput {
  chain: Chain;
  mint: string;
  holders: HolderInfo[];
  trades: TradeEvent[];
  wallets: WalletProfile[];
  deployer: string | null;
  cfg: { minWallets: number; timeWindowSec: number };
  now?: Date;
}

/**
 * WALLET CLUSTERING → POTENTIAL_CLUSTER groups + WALLET_CLUSTER_RISK.
 * Evidence types (each independently weak, combined strong):
 *  A. same funding source (fundedBy)                  — from wallet profiles
 *  B. simultaneous buys within a short window          — from trades
 *  C. wallets funded within minutes of each other       — from wallet profiles
 *  D. wallet funded by the deployer                     — deployer link
 * Union-find merges wallets sharing any evidence; a cluster needs >= minWallets.
 * We never claim "same owner": output is POTENTIAL_CLUSTER with the evidence listed.
 */
export function detectWalletClusters(input: ClusterInput): { clusters: WalletClusterRecord[]; result: AnalyzerResult } {
  const now = input.now ?? new Date();
  const flags: Flag[] = [];
  const evidence: Evidence[] = [];
  const metrics: Record<string, number | null> = {};
  const holderByWallet = new Map<string, HolderInfo>();
  for (const h of input.holders) {
    if (h.isLpPool) continue;
    holderByWallet.set(h.owner ?? h.address, h);
  }
  const profiles = new Map(input.wallets.map((w) => [w.address, w]));
  const candidates = new Set<string>([...holderByWallet.keys(), ...input.trades.map((t) => t.wallet).filter((w): w is string => !!w), ...input.wallets.map((w) => w.address)]);
  if (candidates.size === 0) {
    return { clusters: [], result: { analyzer: "wallet-cluster", score: null, confidence: "UNKNOWN", flags: [{ code: "INSUFFICIENT_DATA", severity: "INFO", message: "no wallet data" }], evidence, metrics, computedAt: now.toISOString() } };
  }
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  const edgeEvidence = new Map<string, { statement: string; data?: Record<string, unknown> }[]>();
  const addEv = (a: string, b: string, statement: string, data?: Record<string, unknown>) => {
    union(a, b);
    const key = [a, b].sort().join("|");
    const arr = edgeEvidence.get(key) ?? [];
    arr.push({ statement, data });
    edgeEvidence.set(key, arr);
  };

  // A + C + D: funding-based evidence
  const byFunder = new Map<string, string[]>();
  for (const w of candidates) {
    const p = profiles.get(w);
    const f = p?.fundedBy.value;
    if (!f) continue;
    byFunder.set(f, [...(byFunder.get(f) ?? []), w]);
    if (input.deployer && f === input.deployer) addEv(w, input.deployer, `wallet ${short(w)} was funded by the deployer`, { wallet: w, funder: f });
  }
  for (const [funder, ws] of byFunder) {
    if (ws.length < 2) continue;
    for (let i = 1; i < ws.length; i++) addEv(ws[0]!, ws[i]!, `${ws.length} wallets share funding source ${short(funder)}`, { funder, wallets: ws });
    const times = ws.map((w) => profiles.get(w)?.fundedAt.value).filter((t): t is string => !!t).map((t) => new Date(t).getTime()).sort();
    if (times.length >= 2 && times[times.length - 1]! - times[0]! < 30 * 60_000) {
      for (let i = 1; i < ws.length; i++) addEv(ws[0]!, ws[i]!, `same funder funded these wallets within ${Math.round((times[times.length - 1]! - times[0]!) / 60_000)} min`, { funder });
    }
  }
  // B: simultaneous buys (sliding window)
  const buys = input.trades.filter((t) => t.kind === "buy" && t.wallet).sort((a, b) => a.ts.localeCompare(b.ts));
  const win = input.cfg.timeWindowSec * 1000;
  for (let i = 0; i < buys.length; i++) {
    const group = new Set<string>([buys[i]!.wallet!]);
    const t0 = new Date(buys[i]!.ts).getTime();
    for (let j = i + 1; j < buys.length && new Date(buys[j]!.ts).getTime() - t0 <= win; j++) group.add(buys[j]!.wallet!);
    if (group.size >= input.cfg.minWallets) {
      const ws = [...group];
      for (let k = 1; k < ws.length; k++) addEv(ws[0]!, ws[k]!, `${ws.length} distinct wallets bought within ${input.cfg.timeWindowSec}s of each other`, { at: buys[i]!.ts, wallets: ws });
    }
  }
  // Build clusters
  const groups = new Map<string, Set<string>>();
  for (const w of parent.keys()) {
    const r = find(w);
    groups.set(r, (groups.get(r) ?? new Set()).add(w));
  }
  const clusters: WalletClusterRecord[] = [];
  let maxRisk = 0;
  let clusteredSupply = 0;
  for (const set of groups.values()) {
    const wallets = [...set].filter((w) => w !== input.deployer);
    if (wallets.length < input.cfg.minWallets && !(input.deployer && set.has(input.deployer) && wallets.length >= 2)) continue;
    const evs: { statement: string; data?: Record<string, unknown> }[] = [];
    for (const [key, arr] of edgeEvidence) {
      const [a, b] = key.split("|");
      if (set.has(a!) && set.has(b!)) for (const e of arr) if (!evs.some((x) => x.statement === e.statement)) evs.push(e);
    }
    const supplyPct = round(wallets.reduce((a, w) => a + (holderByWallet.get(w)?.pct ?? 0), 0), 2);
    const kinds = new Set(evs.map((e) => (e.statement.includes("funded by the deployer") ? "D" : e.statement.includes("funding source") ? "A" : e.statement.includes("within") && e.statement.includes("funded") ? "C" : "B")));
    // risk: more independent evidence kinds + more wallets + more supply => higher
    let risk = 20 + kinds.size * 20 + Math.min(20, wallets.length * 3) + Math.min(30, supplyPct * 1.5);
    if (kinds.has("D")) risk += 10;
    // Timing alone (B) is weak evidence in an active market: cap it at MEDIUM unless the group holds real supply.
    if (kinds.size === 1 && kinds.has("B") && supplyPct < 10) risk = Math.min(risk, 40);
    risk = clamp(round(risk, 1), 0, 100);
    maxRisk = Math.max(maxRisk, risk);
    clusteredSupply += supplyPct;
    clusters.push({
      id: `${input.chain}:${input.mint}:${wallets.slice().sort()[0]!.slice(0, 8)}`,
      chain: input.chain,
      mint: input.mint,
      wallets,
      kind: "POTENTIAL_CLUSTER",
      riskScore: risk,
      supplyPct,
      evidence: evs,
      detectedAt: now.toISOString(),
    });
  }
  clusters.sort((a, b) => b.riskScore - a.riskScore);
  for (const c of clusters) {
    const sev = c.riskScore >= 75 ? "CRITICAL" : c.riskScore >= 55 ? "HIGH" : "MEDIUM";
    flags.push({ code: "SUSPICIOUS_WALLET_CLUSTER", severity: sev, message: `POTENTIAL_CLUSTER of ${c.wallets.length} wallets (${c.supplyPct}% supply): ${c.evidence.map((e) => e.statement).join("; ")}` });
    for (const e of c.evidence) evidence.push({ kind: "INFERENCE", statement: e.statement, source: "wallet-cluster", observedAt: now.toISOString(), data: e.data });
  }
  metrics.cluster_count = clusters.length;
  metrics.cluster_max_risk = clusters.length ? maxRisk : 0;
  metrics.clustered_supply_pct = round(clusteredSupply, 2);
  metrics.wallets_profiled = input.wallets.length;
  // wallet quality score: 100 = no clusters, decreases with risk and clustered supply.
  // Without wallet profiles AND without a usable tape there is no evidence either way: UNKNOWN, not "clean".
  if (input.wallets.length === 0 && input.trades.length < 10 && clusters.length === 0) {
    flags.push({ code: "INSUFFICIENT_DATA", severity: "INFO", message: "no wallet profiles or trade tape to check for clusters (UNKNOWN)" });
    return { clusters, result: { analyzer: "wallet-cluster", score: null, confidence: "UNKNOWN", flags, evidence, metrics, computedAt: now.toISOString() } };
  }
  const score = clamp(round(100 - maxRisk * 0.6 - Math.min(40, clusteredSupply * 1.2), 1), 0, 100);
  const confidence: AnalyzerResult["confidence"] = input.wallets.length >= 5 && input.trades.length >= 10 ? "MEDIUM" : "LOW";
  return { clusters, result: { analyzer: "wallet-cluster", score, confidence, flags, evidence, metrics, computedAt: now.toISOString() } };
}

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

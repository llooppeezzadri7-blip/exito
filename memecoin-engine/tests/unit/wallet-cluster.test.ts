import { describe, it, expect } from "vitest";
import { detectWalletClusters } from "../../src/analyzers/wallet-cluster.js";
import { makeTrade, makeWallet, makeHolders, at } from "../fixtures/factory.js";

const W = (i: number) => `W${i}${"z".repeat(40)}`.slice(0, 44);
const base = { chain: "solana" as const, mint: "MINT", cfg: { minWallets: 3, timeWindowSec: 90 }, now: new Date(at(0)) };

describe("wallet clustering", () => {
  it("detects wallets sharing a funder AND buying simultaneously as a high-risk POTENTIAL_CLUSTER", () => {
    const wallets = [1, 2, 3, 4, 5].map((i) => makeWallet(W(i), { fundedBy: "FUNDER", fundedAt: at(-120 + i) }));
    const trades = [1, 2, 3, 4, 5].map((i) => makeTrade({ wallet: W(i), kind: "buy", ts: new Date(new Date(at(-30)).getTime() + i * 5000).toISOString() }));
    const holders = makeHolders([3, 3, 3, 3, 3], { owners: [W(1), W(2), W(3), W(4), W(5)] })!.top;
    const { clusters, result } = detectWalletClusters({ ...base, holders, trades, wallets, deployer: null });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.kind).toBe("POTENTIAL_CLUSTER");
    expect(clusters[0]!.wallets).toHaveLength(5);
    expect(clusters[0]!.riskScore).toBeGreaterThanOrEqual(75);
    expect(clusters[0]!.supplyPct).toBe(15);
    expect(clusters[0]!.evidence.map((e) => e.statement).join(" ")).toMatch(/share funding source/);
    expect(clusters[0]!.evidence.map((e) => e.statement).join(" ")).toMatch(/bought within 90s/);
    expect(result.flags[0]!.severity).toBe("CRITICAL");
  });
  it("does not cluster unrelated wallets", () => {
    const wallets = [1, 2, 3].map((i) => makeWallet(W(i), { fundedBy: `F${i}` }));
    const trades = [1, 2, 3].map((i) => makeTrade({ wallet: W(i), kind: "buy", minute: -i * 30 }));
    const { clusters, result } = detectWalletClusters({ ...base, holders: [], trades, wallets, deployer: null });
    expect(clusters).toHaveLength(0);
    expect(result.score).toBe(100);
  });
  it("links wallets funded by the deployer even with only two wallets", () => {
    const wallets = [1, 2].map((i) => makeWallet(W(i), { fundedBy: "DEPLOYER" }));
    const { clusters } = detectWalletClusters({ ...base, holders: [], trades: [], wallets, deployer: "DEPLOYER" });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.evidence.some((e) => e.statement.includes("funded by the deployer"))).toBe(true);
  });
  it("returns UNKNOWN with no wallet data", () => {
    const { result } = detectWalletClusters({ ...base, holders: [], trades: [], wallets: [], deployer: null });
    expect(result.score).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { toMarketSnapshot } from "../../src/providers/dexscreener/provider.js";
import { detectWalletClusters } from "../../src/analyzers/wallet-cluster.js";
import { analyzeHolders } from "../../src/analyzers/holders.js";
import { analyzeNarrative } from "../../src/analyzers/narrative.js";
import { computeMetrics } from "../../src/analyzers/metrics.js";
import { MemoryStore } from "../../src/db/memory-store.js";
import { cfg, makeSnapshot, makeHolders, makeToken, at } from "../fixtures/factory.js";

/** Bugs found when the engine first ran against live Solana data (2026-10-02). */
describe("live-data regressions", () => {
  it("token symbol comes from the base token, never the quote asset (was showing every token as SOL)", () => {
    const m = toMarketSnapshot([{ chainId: "solana", dexId: "pumpswap", pairAddress: "P", baseToken: { address: "M", symbol: "FROGGY", name: "Froggy" }, quoteToken: { symbol: "SOL" }, priceUsd: "0.0001", liquidity: { usd: 20000 } }] as any);
    expect(m.baseSymbol).toBe("FROGGY");
    expect(m.baseName).toBe("Froggy");
    expect(m.primaryPair?.quoteSymbol).toBe("SOL");
  });
  it("wallet quality is UNKNOWN (not 100) when no wallets were profiled and there is no tape", () => {
    const { result } = detectWalletClusters({ chain: "solana", mint: "M", holders: makeHolders([4, 3, 2])!.top, trades: [], wallets: [], deployer: null, cfg: { minWallets: 3, timeWindowSec: 90 } });
    expect(result.score).toBeNull();
    expect(result.confidence).toBe("UNKNOWN");
  });
  it("holder growth component is null without history (no invented +points)", () => {
    const r = analyzeHolders(makeSnapshot(), computeMetrics([]), cfg);
    expect(r.metrics.holder_growth_component).toBeNull();
    expect(r.score).not.toBeNull();
  });
  it("narrative is UNKNOWN when there are no narrative statistics yet", () => {
    expect(analyzeNarrative({ symbol: "PEPE2", name: "pepe frog" }, []).score).toBeNull();
    expect(analyzeNarrative({ symbol: "SOL", name: null }, []).narratives).toEqual([]);
  });
  it("REJECTED is not double counted (status + category share the name)", async () => {
    const s = new MemoryStore();
    await s.upsertToken(makeToken({ status: "REJECTED", category: "REJECTED", nextAnalyzeAt: at(0) }));
    expect((await s.countTokens()).REJECTED).toBe(1);
  });
});

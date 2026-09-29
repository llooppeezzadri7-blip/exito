import { describe, it, expect } from "vitest";
import { analyzeToken } from "../../src/pipeline/analyze-token.js";
import { world, fakeContext, advance } from "../fixtures/fake-providers.js";
import { makeToken, makeTrade, MINT } from "../fixtures/factory.js";
import type { World } from "../fixtures/fake-providers.js";

/**
 * HISTORICAL ARCHETYPES — synthetic replays of well-known memecoin failure/success shapes
 * (values are representative of real cases, not copies of any specific token's data).
 * They guard the core promise: the engine must be good at saying "NO".
 */
async function run(w: World, steps: Partial<World>[], tier: 2 | 3 = 3) {
  const ctx = fakeContext(w);
  await ctx.store.upsertToken(makeToken({ tier }));
  advance(w, 1);
  let out = await analyzeToken(ctx, (await ctx.store.getToken("solana", MINT))!);
  for (const s of steps) {
    advance(w, 10, s);
    out = await analyzeToken(ctx, (await ctx.store.getToken("solana", MINT))!);
  }
  return { out, ctx };
}

describe("historical archetypes", () => {
  it("HONEYPOT (freeze authority kept): rejected before any momentum counts", async () => {
    const { out } = await run(world({ freezeAuthority: true, holders: 1500, liq: 120_000, v1: 400_000, pc1: 250 }), [{ holders: 2500, v1: 900_000, pc1: 400 }]);
    expect(out.opportunity.category).toBe("REJECTED");
    expect(out.opportunity.risk).toMatch(/HIGH_RISK|EXTREME_RISK/);
  });
  it("CLASSIC LP PULL: liquidity 60k -> 4k within 15 minutes after a run-up", async () => {
    const { out } = await run(world({ holders: 700, liq: 60_000, v1: 40_000, lpLocked: 0 }), [{ holders: 760, liq: 62_000, v1: 45_000, pc1: 40 }, { holders: 790, liq: 4_000, v1: 90_000, price: 0.0002, pc5: -70, pc1: -75 }]);
    expect(out.opportunity.flags).toContain("LIQUIDITY_DROP");
    expect(out.opportunity.risk).toBe("EXTREME_RISK");
    expect(out.opportunity.exitRisk!).toBeGreaterThanOrEqual(85);
    expect(out.opportunity.category).not.toMatch(/WATCHLIST|HIGH_CONVICTION/);
  });
  it("INSIDER-HEAVY LAUNCH: one wallet holds 38%, deployer holds 12%", async () => {
    const w = world({ holders: 400, liq: 70_000, v1: 90_000, holderPcts: [38, 12, 3, 2, 2, 1, 1, 1, 1, 1], holderOwners: ["INSIDER1", "DEPLOYER1111111111111111111111111111111111"] });
    const { out } = await run(w, [{ holders: 500, v1: 120_000, pc1: 90 }], 2);
    expect(out.opportunity.flags).toEqual(expect.arrayContaining(["SUPPLY_CONCENTRATION", "DEPLOYER_HOLDS_SUPPLY"]));
    expect(out.opportunity.category).not.toMatch(/WATCHLIST|HIGH_CONVICTION/);
    expect(out.opportunity.bearCase.join(" ")).toMatch(/concentrated/);
  });
  it("LATE VERTICAL PUMP: +400% in 1h with price-only momentum is LATE, not a setup", async () => {
    const w = world({ holders: 3000, liq: 150_000, v1: 900_000, pc1: 400, pc5: 70, pc24: 900, price: 0.05, mc: 12_000_000 });
    const { out } = await run(w, [{ holders: 3010, pc1: 420, pc5: 65, liq: 148_000 }, { holders: 3015, pc1: 450, pc5: 60, liq: 146_000 }]);
    expect(out.opportunity.phase).toBe("LATE");
    expect(out.opportunity.category).not.toBe("HIGH_CONVICTION_SETUP");
    expect(out.opportunity.breakdown.find((b) => b.factor === "late_phase")!.points).toBeLessThan(0);
  });
  it("WASH-TRADED TOKEN: volume without holders + same-wallet round trips lowers market quality", async () => {
    const w = world({ holders: 200, liq: 20_000, v1: 250_000, v24: 900_000, b1: 800, s1: 780 });
    const t0 = w.now.getTime() - 40 * 60_000;
    for (let i = 0; i < 25; i++) w.trades.push(makeTrade({ wallet: "BOT1", kind: "buy", ts: new Date(t0 + i * 90_000).toISOString(), amountUsd: 400 }), makeTrade({ wallet: "BOT1", kind: "sell", ts: new Date(t0 + i * 90_000 + 15_000).toISOString(), amountUsd: 400 }));
    const { out } = await run(w, [{ holders: 202, v1: 300_000 }]);
    const mq = out.results.find((r) => r.analyzer === "microstructure")!;
    expect(mq.score!).toBeLessThan(45);
    expect(mq.flags.map((f) => f.code)).toEqual(expect.arrayContaining(["WASH_TRADING_SUSPECTED", "ABNORMAL_VOLUME"]));
    expect(out.opportunity.category).not.toBe("HIGH_CONVICTION_SETUP");
  });
  it("ORGANIC EARLY RUNNER: broad participation, growing liquidity, revoked authorities -> watchlist or setup, EARLY, with bull AND bear case", async () => {
    const w = world({ holders: 400, liq: 60_000, v1: 30_000, b1: 300, s1: 120, pc1: 18 });
    const steps: Partial<World>[] = [];
    for (let i = 1; i <= 6; i++) steps.push({ holders: 400 + i * 150, liq: 60_000 + i * 10_000, v1: 30_000 + i * 15_000, v5: 2000 + i * 2000, b1: 300 + i * 100, s1: 120 + i * 25, price: 0.001 * (1 + i * 0.07), mc: 250_000 * (1 + i * 0.07), pc1: 15 + i * 5, pc5: 3 });
    const buyers = Array.from({ length: 40 }, (_, i) => `ORG${i}${"o".repeat(40)}`.slice(0, 44));
    w.trades = buyers.map((b, i) => makeTrade({ wallet: b, kind: i % 4 === 3 ? "sell" : "buy", ts: new Date(w.now.getTime() + (i - 40) * 60_000 + 70 * 60_000).toISOString(), amountUsd: 40 + (i * 71) % 500 }));
    const { out } = await run(w, steps);
    expect(["WATCHLIST", "HIGH_CONVICTION_SETUP"]).toContain(out.opportunity.category);
    expect(out.opportunity.phase).toBe("EARLY");
    expect(out.opportunity.bullCase.length).toBeGreaterThanOrEqual(2);
    expect(out.opportunity.bearCase.length).toBeGreaterThanOrEqual(2);
    expect(out.opportunity.statusText).toMatch(/REQUIRES/);
  });
  it("SERIAL DEPLOYER: prior rugged tokens tracked by the engine sink the deployer score and rug level", async () => {
    const w = world({ holders: 800, liq: 80_000, v1: 50_000 });
    const ctx = fakeContext(w);
    await ctx.store.upsertDeployer({ chain: "solana", address: w.deployer, tokensCreated: 4, tokensRugged: 3, tokensAbandoned: 1, reputationScore: 5, reputation: "POOR", firstSeenAt: null, lastSeenAt: w.now.toISOString(), data: {} });
    await ctx.store.upsertToken(makeToken({ tier: 2 }));
    const out = await analyzeToken(ctx, (await ctx.store.getToken("solana", MINT))!);
    expect(out.opportunity.flags).toContain("DEPLOYER_PREVIOUS_RUGS");
    expect(out.results.find((r) => r.analyzer === "deployer")!.score!).toBeLessThan(25);
    expect(out.opportunity.category).not.toMatch(/WATCHLIST|HIGH_CONVICTION/);
  });
  it("UNKNOWN deployer is uncertainty, not guilt: penalized moderately, never REJECTED for that alone", async () => {
    const w = world({ holders: 800, liq: 80_000, v1: 50_000, deployerAge: null });
    const ctx = fakeContext(w);
    ctx.registry.get<any>("solana-rpc")!.getDeployer = async () => null;
    ctx.registry.get<any>("rugcheck")!.getReport = async () => null;
    await ctx.store.upsertToken(makeToken({ tier: 2 }));
    const out = await analyzeToken(ctx, (await ctx.store.getToken("solana", MINT))!);
    const dep = out.results.find((r) => r.analyzer === "deployer")!;
    expect(dep.confidence).not.toBe("HIGH");
    expect(out.opportunity.category).not.toBe("REJECTED");
    expect(out.opportunity.breakdown.find((b) => b.factor === "deployer_uncertainty")).toBeDefined();
  });
});

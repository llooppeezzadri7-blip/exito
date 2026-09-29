import { describe, it, expect } from "vitest";
import { MemoryStore } from "../../src/db/memory-store.js";
import { makeToken, at } from "../fixtures/factory.js";

describe("memory store semantics (mirrors postgres)", () => {
  it("dedupes tokens by (chain, mint) and merges discovery sources via patch", async () => {
    const s = new MemoryStore();
    await s.upsertToken(makeToken({ discoverySources: ["a"] }));
    await s.upsertToken(makeToken({ discoverySources: ["b"], symbol: "X" }));
    expect((await s.listTokens()).length).toBe(1);
    expect((await s.getToken("solana", makeToken().mint))!.symbol).toBe("X");
  });
  it("job queue: dedupe key, retry with backoff, dead-letter after max attempts, requeue", async () => {
    const s = new MemoryStore();
    const id = await s.enqueueJob("analyze", { mint: "m" }, { dedupeKey: "analyze:m", maxAttempts: 2, runAt: at(-1) });
    expect(await s.enqueueJob("analyze", { mint: "m" }, { dedupeKey: "analyze:m" })).toBeNull();
    const claimed = await s.claimJobs("analyze", at(0), 10);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.attempts).toBe(1);
    await s.failJob(id!, "boom", at(5));
    expect((await s.claimJobs("analyze", at(1), 10))).toHaveLength(0); // not yet due
    const again = await s.claimJobs("analyze", at(6), 10);
    expect(again).toHaveLength(1);
    await s.failJob(id!, "boom2", at(10));
    expect((await s.queueStats()).DEAD).toBe(1);
    expect((await s.listDeadJobs())[0]!.lastError).toBe("boom2");
    await s.requeueDeadJob(id!);
    expect((await s.queueStats()).PENDING).toBe(1);
  });
  it("lists due tokens by tier priority and time", async () => {
    const s = new MemoryStore();
    await s.upsertToken(makeToken({ mint: "A".repeat(32), tier: 1, nextAnalyzeAt: at(-5) }));
    await s.upsertToken(makeToken({ mint: "B".repeat(32), tier: 4, nextAnalyzeAt: at(-1) }));
    await s.upsertToken(makeToken({ mint: "C".repeat(32), tier: 2, nextAnalyzeAt: at(10) }));
    const due = await s.listDueTokens(at(0), 10);
    expect(due.map((t) => t.mint[0])).toEqual(["B", "A"]);
  });
});

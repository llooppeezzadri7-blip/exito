import { describe, it, expect } from "vitest";
import { ProviderRegistry } from "../../src/providers/registry.js";
import type { DEXProvider } from "../../src/providers/types.js";

function fakeDex(id: string, fail: boolean): DEXProvider {
  return { id, capability: "dex", chains: ["solana"], isConfigured: () => true, ping: async () => true, getNewPools: async () => [], getMarket: async () => { if (fail) throw new Error(`${id} down`); return null; } };
}

describe("provider registry (API failures)", () => {
  it("fails over to the next provider and reports the degraded one", async () => {
    const reg = new ProviderRegistry().register(fakeDex("a", true)).register(fakeDex("b", false));
    const r = await reg.call<DEXProvider, unknown>("dex", (p) => p.getMarket("solana", "m"));
    expect(r.providerId).toBe("b");
    expect(r.degraded).toEqual(["a"]);
  });
  it("marks a provider DEGRADED after 3 consecutive failures and DOWN after 8, without stopping the engine", async () => {
    const reg = new ProviderRegistry().register(fakeDex("a", true)).register(fakeDex("b", false));
    for (let i = 0; i < 3; i++) await reg.call<DEXProvider, unknown>("dex", (p) => p.getMarket("solana", "m"));
    expect(reg.health().find((h) => h.id === "a")!.status).toBe("DEGRADED");
    expect(reg.degradedIds()).toEqual(["a"]);
    // healthy providers are ranked first, so "a" is no longer hammered once "b" works
    const r = await reg.call<DEXProvider, unknown>("dex", (p) => p.getMarket("solana", "m"));
    expect(r.providerId).toBe("b");
    expect(reg.health().find((h) => h.id === "a")!.failures).toBe(3);
    // a lone failing provider goes DOWN after 8 consecutive failures and is cooled off for 60s
    const solo = new ProviderRegistry().register(fakeDex("a", true));
    for (let i = 0; i < 8; i++) await solo.call<DEXProvider, unknown>("dex", (p) => p.getMarket("solana", "m")).catch(() => {});
    expect(solo.health()[0]!.status).toBe("DOWN");
    await expect(solo.call<DEXProvider, unknown>("dex", (p) => p.getMarket("solana", "m"))).rejects.toThrow(/no configured provider|down/);
    expect(solo.health()[0]!.failures).toBe(8); // cooled off: not called again
  });
  it("throws when every provider fails", async () => {
    const reg = new ProviderRegistry().register(fakeDex("a", true));
    await expect(reg.call<DEXProvider, unknown>("dex", (p) => p.getMarket("solana", "m"))).rejects.toThrow(/down/);
  });
  it("skips unconfigured providers", () => {
    const p = fakeDex("c", false);
    p.isConfigured = () => false;
    const reg = new ProviderRegistry().register(p);
    expect(reg.byCapability("dex")).toHaveLength(0);
    expect(reg.health()[0]!.status).toBe("UNCONFIGURED");
  });
});

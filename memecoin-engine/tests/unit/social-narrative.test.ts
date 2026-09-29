import { describe, it, expect } from "vitest";
import { analyzeSocial } from "../../src/analyzers/social.js";
import { analyzeNarrative, classifyNarrative, aggregateNarratives } from "../../src/analyzers/narrative.js";
import { dp, unknown } from "../../src/core/types.js";
import type { SocialSnapshot } from "../../src/core/model.js";
import { at } from "../fixtures/factory.js";

const social = (o: Partial<{ m1h: number; m24: number; authors: number; newShare: number | null; tg: number | null }> = {}): SocialSnapshot => ({
  mentions1h: dp(o.m1h ?? 5, "reddit", "LOW", at(0)), mentions24h: dp(o.m24 ?? 40, "reddit", "LOW", at(0)), uniqueAuthors24h: dp(o.authors ?? 30, "reddit", "LOW", at(0)), newAccountShare: o.newShare === null ? unknown("reddit") : dp(o.newShare ?? 0.2, "reddit", "LOW", at(0)),
  engagement24h: dp(200, "reddit", "LOW", at(0)), sentiment: unknown("reddit"), telegramMembers: o.tg === null || o.tg === undefined ? unknown("telegram") : dp(o.tg, "telegram", "MEDIUM", at(0)), twitterFollowers: unknown("x"), hasWebsite: true, hasTwitter: true, hasTelegram: true, keywords: [], sources: ["reddit"], observedAt: at(0),
});
const cfgS = { spikeZ: 3, saturationPerHour: 400 };

describe("social intelligence", () => {
  it("UNKNOWN without data", () => {
    expect(analyzeSocial(null, [], cfgS).score).toBeNull();
  });
  it("rewards accelerating mentions, not follower counts", () => {
    const flat = analyzeSocial(social({ m1h: 2, m24: 48 }), [], cfgS).score!;
    const accel = analyzeSocial(social({ m1h: 10, m24: 48 }), [], cfgS).score!;
    expect(accel).toBeGreaterThan(flat + 15);
  });
  it("flags fake engagement when most authors are brand-new accounts", () => {
    const r = analyzeSocial(social({ newShare: 0.8 }), [], cfgS);
    expect(r.flags.map((f) => f.code)).toContain("FAKE_ENGAGEMENT");
  });
  it("flags concentrated promotion (few authors, many posts)", () => {
    const r = analyzeSocial(social({ m24: 100, authors: 5 }), [], cfgS);
    expect(r.flags.map((f) => f.code)).toContain("SOCIAL_CONCENTRATED_PROMOTION");
  });
  it("detects a social spike against the token's own history", () => {
    const hist = Array.from({ length: 8 }, (_, i) => ({ chain: "solana" as const, mint: "m", observedAt: at(-80 + i * 10), mentions1h: 2 + (i % 2), mentions24h: 40, uniqueAuthors24h: 30, newAccountShare: 0.2, engagement24h: 100, sentiment: null, telegramMembers: null, twitterFollowers: null, score: 40, sources: ["reddit"] }));
    const r = analyzeSocial(social({ m1h: 40 }), hist, cfgS);
    expect(r.flags.map((f) => f.code)).toContain("SOCIAL_SPIKE");
  });
});

describe("narrative engine", () => {
  it("classifies tokens into narratives by keywords", () => {
    expect(classifyNarrative("TRUMP MAGA coin").map((n) => n.key)).toContain("politics");
    expect(classifyNarrative("Pepe the frog").map((n) => n.key)).toContain("animals");
    expect(classifyNarrative("AI agent for solana").map((n) => n.key)).toEqual(expect.arrayContaining(["ai", "tech"]));
    expect(classifyNarrative("xyzabc")).toHaveLength(0);
  });
  it("penalizes saturated narratives", () => {
    const recs = [{ key: "animals", label: "Animals", keywords: [], tokensCount: 300, mentions24h: 0, momentum: 60, freshness: 30, saturation: 0.95, firstSeenAt: at(-5000), updatedAt: at(0) }];
    const r = analyzeNarrative({ symbol: "DOGE2", name: "dog coin" }, recs);
    expect(r.flags.map((f) => f.code)).toContain("NARRATIVE_SATURATED");
    expect(r.saturation).toBe(0.95);
    const fresh = analyzeNarrative({ symbol: "DOGE2", name: "dog coin" }, [{ ...recs[0]!, saturation: 0.1, freshness: 90, momentum: 80 }]);
    expect(fresh.score!).toBeGreaterThan(r.score!);
  });
  it("aggregates narratives from discovered tokens with momentum/freshness/saturation", () => {
    const tokens = [...Array.from({ length: 12 }, (_, i) => ({ symbol: `DOG${i}`, name: "dog", discoveredAt: at(-i * 60) })), { symbol: "AIX", name: "ai agent", discoveredAt: at(-30) }, { symbol: "CAT1", name: "cat", discoveredAt: at(-30 * 60) }];
    const recs = aggregateNarratives(tokens, [], new Date(at(0)));
    const animals = recs.find((r) => r.key === "animals")!;
    expect(animals.tokensCount).toBe(12); // CAT1 (30h ago) belongs to the previous day
    expect(animals.saturation!).toBeGreaterThan(0.5);
    expect(animals.momentum!).toBeGreaterThan(50); // growing vs previous day
    expect(recs.find((r) => r.key === "ai")!.tokensCount).toBe(1);
  });
});

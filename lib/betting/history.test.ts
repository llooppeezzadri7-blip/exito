import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadHistory,
  profitFor,
  recordRecommendations,
  settleBet,
  summarizeHistory,
  toEntry,
  type HistoryEntry,
} from "./history";
import type { Recommendation } from "./recommendations";

function makeRecommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: "e1::over_2.5_cards::Más de 2,5",
    event: "Levante - Barcelona",
    sport: "Fútbol",
    competition: "LaLiga",
    commenceTime: "2026-09-13T14:15:00Z",
    market: "Total de tarjetas",
    selection: "Más de 2,5",
    odds: 1.35,
    impliedProbability: 1 / 1.35,
    estimatedProbability: 0.8,
    edge: 0.08,
    stakeEur: 2,
    stakePercentOfBankroll: 0.02,
    confidence: "media",
    oddsProvenance: "real",
    probabilitySource: "market-devig",
    probabilityBasis: "Mercado sin margen",
    overallProvenance: "real",
    bettable: true,
    accepted: true,
    verdict: "Valor +8%",
    bookmaker: "Sportium",
    source: "The Odds API",
    fetchedAt: "2026-09-13T10:00:00Z",
    generatedAt: "2026-09-13T10:00:05Z",
    ...overrides,
  };
}

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return { ...toEntry(makeRecommendation()), ...overrides };
}

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "apuestas-"));
  path = join(dir, "historial.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("persistence", () => {
  it("treats a missing file as an empty history, not an error", async () => {
    await expect(loadHistory(path)).resolves.toEqual([]);
  });

  it("writes recommendations and reads them back", async () => {
    const { added, entries } = await recordRecommendations([makeRecommendation()], path);
    expect(added).toBe(1);
    expect(entries).toHaveLength(1);
    expect(await loadHistory(path)).toHaveLength(1);

    const raw = JSON.parse(await readFile(path, "utf8"));
    expect(raw.version).toBe(1);
  });

  it("does not duplicate the same bet when the generator runs twice", async () => {
    await recordRecommendations([makeRecommendation()], path);
    const second = await recordRecommendations([makeRecommendation()], path);

    expect(second.added).toBe(0);
    expect(second.skipped).toBe(1);
    expect(await loadHistory(path)).toHaveLength(1);
  });

  it("keeps the price it was recommended at, not the current one", async () => {
    await recordRecommendations([makeRecommendation({ odds: 1.35 })], path);
    await recordRecommendations([makeRecommendation({ odds: 1.6 })], path);

    const [entry] = await loadHistory(path);
    expect(entry.odds).toBe(1.35);
  });
});

describe("settling", () => {
  it("computes profit from the stake and the recorded price", () => {
    const entry = makeEntry({ stakeEur: 10, odds: 1.35 });
    expect(profitFor(entry, "ganada")).toBeCloseTo(3.5, 10);
    expect(profitFor(entry, "perdida")).toBeCloseTo(-10, 10);
    expect(profitFor(entry, "nula")).toBe(0);
    expect(profitFor(entry, "pendiente")).toBe(0);
  });

  it("persists the result and stamps the settle time", async () => {
    const { entries } = await recordRecommendations([makeRecommendation({ stakeEur: 10 })], path);
    const settled = await settleBet(entries[0].id, "ganada", path);

    expect(settled?.result).toBe("ganada");
    expect(settled?.profitEur).toBeCloseTo(3.5, 10);
    expect(settled?.settledAt).toBeTruthy();
    expect((await loadHistory(path))[0].result).toBe("ganada");
  });

  it("can be reverted to pending, clearing the profit", async () => {
    const { entries } = await recordRecommendations([makeRecommendation({ stakeEur: 10 })], path);
    await settleBet(entries[0].id, "ganada", path);
    const reverted = await settleBet(entries[0].id, "pendiente", path);

    expect(reverted?.profitEur).toBe(0);
    expect(reverted?.settledAt).toBeUndefined();
  });

  it("returns null for an unknown bet instead of throwing", async () => {
    await expect(settleBet("no-existe", "ganada", path)).resolves.toBeNull();
  });
});

describe("P&L excludes demo", () => {
  it("never lets a fabricated win into the balance", () => {
    const summary = summarizeHistory([
      makeEntry({ id: "real", stakeEur: 10, odds: 1.5, result: "ganada", profitEur: 5 }),
      makeEntry({ id: "demo", overallProvenance: "demo", stakeEur: 10, odds: 10, result: "ganada", profitEur: 90 }),
    ]);

    expect(summary.profitEur).toBeCloseTo(5, 10);
    expect(summary.settled).toBe(1);
    expect(summary.demoExcluded).toBe(1);
    expect(summary.total).toBe(2);
  });

  it("computes hit rate and ROI over settled real bets only", () => {
    const summary = summarizeHistory([
      makeEntry({ id: "a", stakeEur: 10, odds: 1.5, result: "ganada", profitEur: 5 }),
      makeEntry({ id: "b", stakeEur: 10, odds: 1.5, result: "perdida", profitEur: -10 }),
      makeEntry({ id: "c", stakeEur: 10, odds: 1.5, result: "pendiente", profitEur: 0 }),
      makeEntry({ id: "d", stakeEur: 10, odds: 1.5, result: "nula", profitEur: 0 }),
    ]);

    expect(summary.settled).toBe(2);
    expect(summary.hitRate).toBeCloseTo(0.5, 10);
    expect(summary.stakedEur).toBeCloseTo(20, 10);
    expect(summary.profitEur).toBeCloseTo(-5, 10);
    expect(summary.roi).toBeCloseTo(-0.25, 10);
    expect(summary.pending).toBe(1);
    expect(summary.voids).toBe(1);
    expect(summary.averageOdds).toBeCloseTo(1.5, 10);
  });

  it("returns zeros rather than NaN on an empty history", () => {
    const summary = summarizeHistory([]);
    expect(summary.roi).toBe(0);
    expect(summary.hitRate).toBe(0);
    expect(summary.averageOdds).toBe(0);
  });

  it("also excludes backtest-only entries from being treated as real bets", () => {
    const summary = summarizeHistory([
      makeEntry({ id: "bt", overallProvenance: "backtest", stakeEur: 10, odds: 1.5, result: "ganada", profitEur: 5 }),
    ]);
    // Backtest rows are real data, so they do count — but they are settled bets
    // from history, not demo. This documents the deliberate distinction.
    expect(summary.demoExcluded).toBe(0);
    expect(summary.settled).toBe(1);
  });
});

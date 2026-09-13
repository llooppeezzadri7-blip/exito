import { describe, expect, it } from "vitest";
import { demoEstimates, devigEstimates, sharpestBookmaker } from "./estimates";
import type { OddsQuote } from "./providers/types";
import { estimateKey } from "./recommendations";

function makeQuote(overrides: Partial<OddsQuote> = {}): OddsQuote {
  return {
    eventId: "e1",
    sport: "Fútbol",
    competition: "LaLiga",
    homeTeam: "Levante",
    awayTeam: "Barcelona",
    commenceTime: "2026-09-13T14:15:00Z",
    marketKey: "totals",
    marketLabel: "Total de goles 2.5",
    selection: "Más de 2,5",
    odds: 1.9,
    bookmaker: "Pinnacle",
    fetchedAt: "2026-09-13T10:00:00Z",
    provenance: "real",
    ...overrides,
  };
}

/** A two-sided market from one bookmaker. */
function market(bookmaker: string, over: number, under: number, eventId = "e1"): OddsQuote[] {
  return [
    makeQuote({ bookmaker, odds: over, selection: "Más de 2,5", eventId }),
    makeQuote({ bookmaker, odds: under, selection: "Menos de 2,5", eventId }),
  ];
}

describe("picking the sharp book", () => {
  it("chooses the bookmaker with the least margin", () => {
    const quotes = [...market("Pinnacle", 1.97, 1.97), ...market("Casa Cara", 1.75, 1.85)];
    expect(sharpestBookmaker(quotes)).toBe("Pinnacle");
  });

  it("returns null when no market is complete", () => {
    expect(sharpestBookmaker([makeQuote()])).toBeNull();
    expect(sharpestBookmaker([])).toBeNull();
  });
});

describe("de-vigging a market", () => {
  it("produces probabilities that sum to 1", () => {
    const quotes = market("Pinnacle", 1.9, 2.1);
    const { estimates, reference } = devigEstimates(quotes);

    expect(reference).toBe("Pinnacle");
    const values = [...estimates.values()].map((e) => e.value);
    expect(values).toHaveLength(2);
    expect(values.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8);
  });

  it("labels the estimates as coming from the market, not from a model", () => {
    const { estimates } = devigEstimates(market("Pinnacle", 1.9, 2.1));
    for (const estimate of estimates.values()) {
      expect(estimate.source).toBe("market-devig");
      expect(estimate.basis).toMatch(/Pinnacle/);
    }
  });

  it("keys estimates so they apply to another bookmaker's price on the same selection", () => {
    const sharp = market("Pinnacle", 1.97, 1.97);
    const soft = makeQuote({ bookmaker: "Sportium", odds: 2.2, selection: "Más de 2,5" });

    const { estimates } = devigEstimates([...sharp, soft]);
    // The Sportium quote finds the estimate derived from Pinnacle.
    expect(estimates.get(estimateKey(soft))).toBeDefined();
    expect(estimates.get(estimateKey(soft))?.value).toBeCloseTo(0.5, 6);
  });

  it("finds no edge when there is only one bookmaker to compare against itself", () => {
    const quotes = market("Sportium", 1.8, 1.9);
    const { estimates } = devigEstimates(quotes);

    for (const quote of quotes) {
      const estimate = estimates.get(estimateKey(quote));
      expect(estimate).toBeDefined();
      // Fair probability times its own quoted price is below 1 by the margin.
      expect((estimate?.value ?? 0) * quote.odds).toBeLessThan(1.0001);
    }
  });

  it("reports markets it could not handle instead of dropping them", () => {
    const arbitrage = market("Rara", 2.5, 2.5);
    const { skipped } = devigEstimates(arbitrage, "Rara");
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/arbitraje/);
  });

  it("says so when nothing can be de-vigged", () => {
    const { estimates, reference, skipped } = devigEstimates([makeQuote()]);
    expect(reference).toBeNull();
    expect(estimates.size).toBe(0);
    expect(skipped).toHaveLength(1);
  });

  it("separates markets of different events", () => {
    const quotes = [...market("Pinnacle", 1.9, 2.1, "e1"), ...market("Pinnacle", 1.5, 2.7, "e2")];
    const { estimates } = devigEstimates(quotes);
    expect(estimates.size).toBe(4);
  });
});

describe("demo estimates", () => {
  it("only touches demo quotes and labels itself as invented", () => {
    const real = makeQuote();
    const demo = makeQuote({ eventId: "d1", provenance: "demo" });
    const estimates = demoEstimates([real, demo]);

    expect(estimates.size).toBe(1);
    expect(estimates.get(estimateKey(real))).toBeUndefined();
    expect(estimates.get(estimateKey(demo))?.source).toBe("demo");
    expect(estimates.get(estimateKey(demo))?.basis).toMatch(/inventado/i);
  });

  it("never produces a probability above 1", () => {
    const demo = makeQuote({ provenance: "demo", odds: 1.001 });
    const estimate = demoEstimates([demo]).get(estimateKey(demo));
    expect(estimate?.value).toBeLessThanOrEqual(0.97);
  });
});

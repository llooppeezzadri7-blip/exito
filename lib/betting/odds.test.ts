import { describe, expect, it } from "vitest";
import {
  assessValue,
  bookmakerMargin,
  breakEvenOdds,
  breakEvenProbability,
  expectedValue,
  fairOdds,
  fairOddsForMarket,
  impliedProbability,
  kellyFraction,
  parlayOdds,
  parlayProbability,
  removeMargin,
  roiAt,
} from "./odds";

describe("implied probability and fair odds", () => {
  it("converts both ways", () => {
    expect(impliedProbability(2)).toBe(0.5);
    expect(impliedProbability(1.25)).toBe(0.8);
    expect(fairOdds(0.8)).toBeCloseTo(1.25, 10);
    expect(fairOdds(impliedProbability(1.37))).toBeCloseTo(1.37, 10);
  });

  it("rejects impossible prices", () => {
    expect(() => impliedProbability(1)).toThrow(RangeError);
    expect(() => impliedProbability(0.5)).toThrow(RangeError);
    expect(() => fairOdds(0)).toThrow(RangeError);
    expect(() => fairOdds(1.2)).toThrow(RangeError);
  });
});

describe("the 1.25 rule", () => {
  it("puts break-even for an 80% hit rate at exactly 1.25", () => {
    expect(breakEvenOdds(0.8)).toBeCloseTo(1.25, 10);
    expect(breakEvenProbability(1.25)).toBeCloseTo(0.8, 10);
  });

  it("turns an 80% hit rate into a loss below 1.25 and a profit above it", () => {
    expect(roiAt(0.8, 1.2)).toBeCloseTo(-0.04, 10);
    expect(roiAt(0.8, 1.25)).toBeCloseTo(0, 10);
    expect(roiAt(0.8, 1.3)).toBeCloseTo(0.04, 10);
    expect(roiAt(0.8, 1.35)).toBeCloseTo(0.08, 10);
  });
});

describe("bookmaker margin", () => {
  it("measures the overround of a complete market", () => {
    expect(bookmakerMargin([2, 2])).toBeCloseTo(0, 10);
    expect(bookmakerMargin([1.9, 1.9])).toBeCloseTo(0.05263, 4);
  });

  it("refuses an incomplete market or an arbitrage", () => {
    expect(() => bookmakerMargin([1.5])).toThrow(RangeError);
    expect(() => bookmakerMargin([2.5, 2.5])).toThrow(/arbitraje/);
  });
});

describe("de-vigging", () => {
  const market = [1.9, 1.9];

  it("returns probabilities summing to 1 for every method", () => {
    for (const method of ["proportional", "power", "shin"] as const) {
      const fair = removeMargin(market, method);
      expect(fair.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8);
    }
  });

  it("keeps a symmetric market symmetric", () => {
    for (const method of ["proportional", "power", "shin"] as const) {
      const [home, away] = removeMargin(market, method);
      expect(home).toBeCloseTo(0.5, 8);
      expect(away).toBeCloseTo(0.5, 8);
    }
  });

  it("handles three-way markets", () => {
    const fair = removeMargin([1.5, 4.5, 7.0], "shin");
    expect(fair.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8);
    expect(fair[0]).toBeGreaterThan(fair[1]);
    expect(fair[1]).toBeGreaterThan(fair[2]);
  });

  it("taxes the longshot harder than proportional does, as Shin intends", () => {
    const skewed = [1.2, 5.5];
    const proportional = removeMargin(skewed, "proportional");
    const shin = removeMargin(skewed, "shin");
    // Shin attributes more of the margin to the longshot, so the favourite's
    // fair probability comes out higher than under a flat proportional split.
    expect(shin[0]).toBeGreaterThan(proportional[0]);
    expect(shin[1]).toBeLessThan(proportional[1]);
  });

  it("produces fair odds longer than the quoted ones", () => {
    const [home, away] = fairOddsForMarket([1.9, 1.9]);
    expect(home).toBeCloseTo(2, 6);
    expect(away).toBeCloseTo(2, 6);
  });
});

describe("value and Kelly", () => {
  it("prices edge correctly", () => {
    expect(expectedValue(0.8, 1.3)).toBeCloseTo(0.04, 10);
    expect(expectedValue(0.8, 1.2)).toBeCloseTo(-0.04, 10);
  });

  it("returns a positive Kelly stake only when there is an edge", () => {
    expect(kellyFraction(0.8, 1.3)).toBeGreaterThan(0);
    expect(kellyFraction(0.8, 1.2)).toBeLessThan(0);
    expect(kellyFraction(0.5, 2)).toBeCloseTo(0, 10);
  });

  it("assembles a full assessment", () => {
    const assessment = assessValue(0.8, 1.3);
    expect(assessment.impliedProbability).toBeCloseTo(0.769, 3);
    expect(assessment.breakEvenProbability).toBeCloseTo(0.769, 3);
    expect(assessment.edge).toBeCloseTo(0.04, 10);
    expect(assessment.kellyFull).toBeCloseTo(0.1333, 3);
  });
});

describe("accumulators", () => {
  it("multiplies odds and probabilities", () => {
    expect(parlayOdds([1.2, 1.2, 1.2])).toBeCloseTo(1.728, 10);
    expect(parlayProbability([0.8, 0.8, 0.8])).toBeCloseTo(0.512, 10);
  });

  it("shows that three 80% legs priced at 1.20 lose money despite hitting 51%", () => {
    const probability = parlayProbability([0.8, 0.8, 0.8]);
    const odds = parlayOdds([1.2, 1.2, 1.2]);
    expect(probability).toBeGreaterThan(0.5);
    expect(expectedValue(probability, odds)).toBeCloseTo(-0.115264, 8);
  });

  it("rejects an empty accumulator", () => {
    expect(() => parlayOdds([])).toThrow(RangeError);
  });
});

import { describe, expect, it } from "vitest";
import { MIN_SAMPLE, oddsNeededForRoi, runBacktest, summarize, wilsonInterval } from "./backtest";
import { inDivision, OVER_1_5_GOALS, OVER_2_5_CARDS, totalCards } from "./markets";
import type { MatchRow } from "./types";

function makeMatch(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    division: "SP1",
    date: "2025-01-01",
    homeTeam: "Barcelona",
    awayTeam: "Sevilla",
    goals: { home: 2, away: 1 },
    corners: { home: 6, away: 3 },
    yellows: { home: 2, away: 3 },
    reds: { home: 0, away: 0 },
    shotsOnTarget: { home: 7, away: 2 },
    fouls: { home: 10, away: 14 },
    odds: { "MaxC>1.5": 1.3 },
    ...overrides,
  };
}

/** `wins` matches where the total clears 1.5, then `losses` where it does not. */
function goalSeries(wins: number, losses: number, odds = 1.3): MatchRow[] {
  const matches: MatchRow[] = [];
  for (let i = 0; i < wins; i += 1) {
    matches.push(makeMatch({ goals: { home: 2, away: 1 }, odds: { "MaxC>1.5": odds } }));
  }
  for (let i = 0; i < losses; i += 1) {
    matches.push(makeMatch({ goals: { home: 1, away: 0 }, odds: { "MaxC>1.5": odds } }));
  }
  return matches;
}

describe("wilson interval", () => {
  it("matches the published value for 80 of 100", () => {
    const { low, high } = wilsonInterval(80, 100);
    expect(low).toBeCloseTo(0.7111, 3);
    expect(high).toBeCloseTo(0.8667, 3);
  });

  it("tightens as the sample grows", () => {
    const small = wilsonInterval(80, 100);
    const large = wilsonInterval(800, 1000);
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });

  it("returns the full range with no data", () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
  });
});

describe("backtest arithmetic", () => {
  it("measures hit rate, average odds and ROI", () => {
    const result = runBacktest(goalSeries(80, 20), { market: OVER_1_5_GOALS });
    expect(result.settled).toBe(100);
    expect(result.wins).toBe(80);
    expect(result.hitRate).toBeCloseTo(0.8, 10);
    expect(result.averageOdds).toBeCloseTo(1.3, 10);
    expect(result.profit).toBeCloseTo(4, 6);
    expect(result.roi).toBeCloseTo(0.04, 6);
    expect(result.breakEvenHitRate).toBeCloseTo(0.7692, 4);
    expect(result.breakEvenOdds).toBeCloseTo(1.25, 10);
  });

  it("tracks the losing streak and drawdown that an 80% system really has", () => {
    const result = runBacktest(goalSeries(80, 20), { market: OVER_1_5_GOALS });
    // The synthetic series ends with every loss in a block, so the worst case
    // is the whole tail — the point is that the metric is being captured.
    expect(result.longestLosingStreak).toBe(20);
    expect(result.maxDrawdown).toBeCloseTo(20, 6);
  });

  it("calls 100 bets at 80% noise, and 1000 bets at 80% an edge", () => {
    const small = runBacktest(goalSeries(80, 20), { market: OVER_1_5_GOALS });
    expect(small.hitRate).toBeCloseTo(0.8, 10);
    expect(small.sampleIsSufficient).toBe(false);
    expect(small.edgeIsSignificant).toBe(false);

    const large = runBacktest(goalSeries(800, 200), { market: OVER_1_5_GOALS });
    expect(large.hitRate).toBeCloseTo(0.8, 10);
    expect(large.sampleIsSufficient).toBe(true);
    expect(large.edgeIsSignificant).toBe(true);
  });
});

describe("band enforcement", () => {
  it("skips prices below the band instead of counting them", () => {
    const result = runBacktest(goalSeries(80, 20, 1.2), { market: OVER_1_5_GOALS });
    expect(result.settled).toBe(0);
    expect(result.skipped.outOfBand).toBe(100);
  });

  it("measures everything when the band is disabled", () => {
    const result = runBacktest(goalSeries(80, 20, 1.2), { market: OVER_1_5_GOALS, band: null });
    expect(result.settled).toBe(100);
    expect(result.roi).toBeCloseTo(-0.04, 6);
  });
});

describe("missing data", () => {
  it("skips matches with no result rather than scoring them as losses", () => {
    const result = runBacktest([makeMatch({ goals: null })], { market: OVER_1_5_GOALS, band: null });
    expect(result.settled).toBe(0);
    expect(result.skipped.noOutcome).toBe(1);
  });

  it("skips matches with no price unless one is assumed", () => {
    const matches = [makeMatch({ odds: {} })];
    expect(runBacktest(matches, { market: OVER_1_5_GOALS }).skipped.noOdds).toBe(1);

    const assumed = runBacktest(matches, { market: OVER_1_5_GOALS, assumedOdds: 1.33 });
    expect(assumed.settled).toBe(1);
    expect(assumed.pricesWereAssumed).toBe(true);
    expect(summarize(assumed)).toMatch(/cuotas son asumidas/);
  });

  it("backtests card markets on assumed prices, since the data carries none", () => {
    const matches = [
      makeMatch({ yellows: { home: 2, away: 2 }, reds: { home: 0, away: 0 } }),
      makeMatch({ yellows: { home: 1, away: 1 }, reds: { home: 0, away: 0 } }),
    ];
    expect(totalCards(matches[0])).toBe(4);
    expect(totalCards(matches[1])).toBe(2);

    const result = runBacktest(matches, { market: OVER_2_5_CARDS, assumedOdds: 1.35 });
    expect(result.settled).toBe(2);
    expect(result.wins).toBe(1);
    expect(result.pricesWereAssumed).toBe(true);
  });
});

describe("filters", () => {
  it("counts only matches the filter lets through", () => {
    const matches = [...goalSeries(5, 0), makeMatch({ division: "E0", goals: { home: 3, away: 0 } })];
    const result = runBacktest(matches, { market: OVER_1_5_GOALS, filter: inDivision("SP1") });
    expect(result.settled).toBe(5);
    expect(result.skipped.filtered).toBe(1);
  });
});

describe("planning helpers", () => {
  it("says what price an 80% hit rate needs for a target ROI", () => {
    expect(oddsNeededForRoi(0.8, 0)).toBeCloseTo(1.25, 10);
    expect(oddsNeededForRoi(0.8, 0.05)).toBeCloseTo(1.3125, 10);
    expect(oddsNeededForRoi(0.8, 0.1)).toBeCloseTo(1.375, 10);
  });
});

describe("summary", () => {
  it("warns about a thin sample and refuses to claim an edge", () => {
    const text = summarize(runBacktest(goalSeries(8, 2), { market: OVER_1_5_GOALS }));
    expect(text).toMatch(new RegExp(`mínimo recomendado ${MIN_SAMPLE}`));
    expect(text).toMatch(/no puedes distinguir esto de la suerte/i);
  });

  it("explains an empty result instead of printing zeros", () => {
    expect(summarize(runBacktest([], { market: OVER_1_5_GOALS }))).toMatch(/0 apuestas tras los filtros/);
  });
});

import { describe, expect, it } from "vitest";
import {
  all,
  any,
  bookingPoints,
  BTTS,
  findMarket,
  firstOdds,
  hasHeavyFavourite,
  inDivision,
  involves,
  isAway,
  isHome,
  MARKETS,
  noHeavyFavourite,
  not,
  OVER_1_5_GOALS,
  OVER_2_5_CARDS,
  OVER_8_5_CORNERS,
  totalCards,
  totalCorners,
  totalGoals,
} from "./markets";
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
    reds: { home: 0, away: 1 },
    shotsOnTarget: { home: 7, away: 2 },
    fouls: { home: 10, away: 14 },
    odds: { B365H: 1.25, B365A: 11, MaxCH: 1.22, MaxCA: 13 },
    ...overrides,
  };
}

describe("totals", () => {
  it("adds both sides", () => {
    const match = makeMatch();
    expect(totalGoals(match)).toBe(3);
    expect(totalCorners(match)).toBe(9);
    expect(totalCards(match)).toBe(6); // 5 amarillas + 1 roja
    expect(bookingPoints(match)).toBe(75); // 5 x 10 + 1 x 25
  });

  it("returns null when the data is missing rather than guessing zero", () => {
    expect(totalGoals(makeMatch({ goals: null }))).toBeNull();
    expect(totalCorners(makeMatch({ corners: null }))).toBeNull();
    expect(totalCards(makeMatch({ reds: null }))).toBeNull();
    expect(bookingPoints(makeMatch({ yellows: null }))).toBeNull();
  });
});

describe("settling", () => {
  it("settles over markets strictly above the line", () => {
    expect(OVER_1_5_GOALS.settle(makeMatch({ goals: { home: 1, away: 1 } }))).toBe(true);
    expect(OVER_1_5_GOALS.settle(makeMatch({ goals: { home: 1, away: 0 } }))).toBe(false);
    expect(OVER_1_5_GOALS.settle(makeMatch({ goals: { home: 0, away: 0 } }))).toBe(false);
  });

  it("settles corners and cards on the combined total", () => {
    expect(OVER_8_5_CORNERS.settle(makeMatch({ corners: { home: 5, away: 4 } }))).toBe(true);
    expect(OVER_8_5_CORNERS.settle(makeMatch({ corners: { home: 4, away: 4 } }))).toBe(false);
    expect(OVER_2_5_CARDS.settle(makeMatch({ yellows: { home: 1, away: 1 }, reds: { home: 0, away: 0 } }))).toBe(false);
    // Una roja cuenta como tarjeta: 2 amarillas + 1 roja superan la línea de 2,5.
    expect(OVER_2_5_CARDS.settle(makeMatch({ yellows: { home: 1, away: 1 }, reds: { home: 1, away: 0 } }))).toBe(true);
    expect(OVER_2_5_CARDS.settle(makeMatch({ yellows: { home: 2, away: 2 }, reds: { home: 0, away: 0 } }))).toBe(true);
  });

  it("settles both teams to score", () => {
    expect(BTTS.settle(makeMatch({ goals: { home: 1, away: 1 } }))).toBe(true);
    expect(BTTS.settle(makeMatch({ goals: { home: 3, away: 0 } }))).toBe(false);
    expect(BTTS.settle(makeMatch({ goals: null }))).toBeNull();
  });

  it("returns null rather than false when the stat is absent", () => {
    expect(OVER_8_5_CORNERS.settle(makeMatch({ corners: null }))).toBeNull();
    expect(OVER_2_5_CARDS.settle(makeMatch({ yellows: null }))).toBeNull();
  });
});

describe("registry", () => {
  it("exposes every market under a unique key", () => {
    const keys = MARKETS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(findMarket("over_2.5_cards")).toBe(OVER_2_5_CARDS);
    expect(findMarket("no_existe")).toBeUndefined();
  });
});

describe("odds lookup", () => {
  it("takes the first usable column in order of preference", () => {
    const match = makeMatch({ odds: { "Avg>2.5": 1.5, "MaxC>2.5": 1.6 } });
    expect(firstOdds(match, ["MaxC>2.5", "Avg>2.5"])).toBe(1.6);
    expect(firstOdds(match, ["NoExiste", "Avg>2.5"])).toBe(1.5);
  });

  it("ignores unusable values instead of returning them", () => {
    const match = makeMatch({ odds: { A: 1, B: 0, C: 1.4 } });
    expect(firstOdds(match, ["A", "B", "C"])).toBe(1.4);
    expect(firstOdds(match, ["A", "B"])).toBeNull();
  });
});

describe("match filters", () => {
  it("filters by division and team", () => {
    const match = makeMatch();
    expect(inDivision("SP1")(match)).toBe(true);
    expect(inDivision("E0")(match)).toBe(false);
    expect(involves("barcelona")(match)).toBe(true);
    expect(involves("Getafe")(match)).toBe(false);
    expect(isHome("Barcelona")(match)).toBe(true);
    expect(isAway("Barcelona")(match)).toBe(false);
    expect(isAway("Sevilla")(match)).toBe(true);
  });

  it("detects a heavy favourite from the price", () => {
    const lopsided = makeMatch();
    expect(hasHeavyFavourite()(lopsided)).toBe(true);
    expect(noHeavyFavourite()(lopsided)).toBe(false);

    const even = makeMatch({ odds: { MaxCH: 2.6, MaxCA: 2.8 } });
    expect(hasHeavyFavourite()(even)).toBe(false);
    expect(noHeavyFavourite()(even)).toBe(true);
  });

  it("excludes matches with no price rather than assuming one", () => {
    const unpriced = makeMatch({ odds: {} });
    expect(hasHeavyFavourite()(unpriced)).toBe(false);
    expect(noHeavyFavourite()(unpriced)).toBe(false);
  });

  it("combines filters", () => {
    const match = makeMatch();
    expect(all(inDivision("SP1"), isHome("Barcelona"))(match)).toBe(true);
    expect(all(inDivision("E0"), isHome("Barcelona"))(match)).toBe(false);
    expect(any(inDivision("E0"), isHome("Barcelona"))(match)).toBe(true);
    expect(not(inDivision("E0"))(match)).toBe(true);
  });
});

import type { Market, MarketOutcome, MatchRow } from "./types";

/**
 * The markets this system bets. Deliberately narrow: these are the families
 * where a ~80% hit rate can coexist with a price of 1.28 or better.
 *
 * A note on cards: football-data.co.uk does not say whether a red card came
 * from a second yellow, and providers differ on whether that player's first
 * yellow is also recorded. Totals computed here can therefore over-count by
 * one in matches with a second-yellow dismissal. Treat measured hit rates on
 * card markets as a slight OVER-estimate, and build in margin accordingly.
 */

export function totalGoals(match: MatchRow): number | null {
  return match.goals ? match.goals.home + match.goals.away : null;
}

export function totalCorners(match: MatchRow): number | null {
  return match.corners ? match.corners.home + match.corners.away : null;
}

/** Yellow cards plus red cards. See the second-yellow caveat above. */
export function totalCards(match: MatchRow): number | null {
  if (!match.yellows || !match.reds) return null;
  return match.yellows.home + match.yellows.away + match.reds.home + match.reds.away;
}

/** Booking points under the common 10/25 scheme, used by some card markets. */
export function bookingPoints(match: MatchRow): number | null {
  if (!match.yellows || !match.reds) return null;
  return (match.yellows.home + match.yellows.away) * 10 + (match.reds.home + match.reds.away) * 25;
}

function over(line: number, value: number | null): MarketOutcome {
  if (value === null) return null;
  return value > line;
}

function overMarket(
  key: string,
  label: string,
  line: number,
  extract: (match: MatchRow) => number | null,
  oddsColumns: string[] = []
): Market {
  return { key, label, oddsColumns, settle: (match) => over(line, extract(match)) };
}

/** Goal totals. Priced by football-data, so ROI here is measured, not assumed. */
export const OVER_1_5_GOALS = overMarket("over_1.5_goals", "Más de 1,5 goles", 1.5, totalGoals, [
  "MaxC>1.5",
  "AvgC>1.5",
  "Max>1.5",
  "Avg>1.5",
  "B365>1.5",
]);

export const OVER_2_5_GOALS = overMarket("over_2.5_goals", "Más de 2,5 goles", 2.5, totalGoals, [
  "MaxC>2.5",
  "AvgC>2.5",
  "Max>2.5",
  "Avg>2.5",
  "B365>2.5",
  "P>2.5",
]);

export const OVER_3_5_GOALS = overMarket("over_3.5_goals", "Más de 3,5 goles", 3.5, totalGoals, [
  "MaxC>3.5",
  "AvgC>3.5",
]);

export const BTTS: Market = {
  key: "btts",
  label: "Ambos equipos marcan",
  oddsColumns: [],
  settle: (match) => (match.goals ? match.goals.home > 0 && match.goals.away > 0 : null),
};

/**
 * Corner totals. football-data carries no corner prices, so a backtest of
 * these reports hit rate only; feed `assumedOdds` to turn it into ROI.
 */
export const OVER_7_5_CORNERS = overMarket("over_7.5_corners", "Más de 7,5 córners", 7.5, totalCorners);
export const OVER_8_5_CORNERS = overMarket("over_8.5_corners", "Más de 8,5 córners", 8.5, totalCorners);
export const OVER_9_5_CORNERS = overMarket("over_9.5_corners", "Más de 9,5 córners", 9.5, totalCorners);
export const OVER_10_5_CORNERS = overMarket("over_10.5_corners", "Más de 10,5 córners", 10.5, totalCorners);

/** Card totals — the flagship LaLiga market for this system. */
export const OVER_2_5_CARDS = overMarket("over_2.5_cards", "Más de 2,5 tarjetas", 2.5, totalCards);
export const OVER_3_5_CARDS = overMarket("over_3.5_cards", "Más de 3,5 tarjetas", 3.5, totalCards);
export const OVER_4_5_CARDS = overMarket("over_4.5_cards", "Más de 4,5 tarjetas", 4.5, totalCards);
export const OVER_5_5_CARDS = overMarket("over_5.5_cards", "Más de 5,5 tarjetas", 5.5, totalCards);

export const MARKETS: Market[] = [
  OVER_1_5_GOALS,
  OVER_2_5_GOALS,
  OVER_3_5_GOALS,
  BTTS,
  OVER_7_5_CORNERS,
  OVER_8_5_CORNERS,
  OVER_9_5_CORNERS,
  OVER_10_5_CORNERS,
  OVER_2_5_CARDS,
  OVER_3_5_CARDS,
  OVER_4_5_CARDS,
  OVER_5_5_CARDS,
];

export function findMarket(key: string): Market | undefined {
  return MARKETS.find((m) => m.key === key);
}

// ---------------------------------------------------------------------------
// Match filters — the other half of the system
// ---------------------------------------------------------------------------

export type MatchFilter = (match: MatchRow) => boolean;

export const DIVISIONS = { laLiga: "SP1", premierLeague: "E0" } as const;

export function inDivision(...divisions: string[]): MatchFilter {
  return (match) => divisions.includes(match.division);
}

export function involves(...teams: string[]): MatchFilter {
  const wanted = teams.map((t) => t.toLowerCase());
  return (match) =>
    wanted.includes(match.homeTeam.toLowerCase()) || wanted.includes(match.awayTeam.toLowerCase());
}

export function isHome(team: string): MatchFilter {
  return (match) => match.homeTeam.toLowerCase() === team.toLowerCase();
}

export function isAway(team: string): MatchFilter {
  return (match) => match.awayTeam.toLowerCase() === team.toLowerCase();
}

/**
 * Matches where the pre-game price says nobody is a heavy favourite.
 * Blowouts kill card and corner markets: once a game is decided, fouls stop.
 */
export function noHeavyFavourite(maxImpliedProbability = 0.65): MatchFilter {
  return (match) => {
    const home = firstOdds(match, ["MaxCH", "AvgCH", "B365H", "PSH"]);
    const away = firstOdds(match, ["MaxCA", "AvgCA", "B365A", "PSA"]);
    if (home === null || away === null) return false;
    return 1 / home <= maxImpliedProbability && 1 / away <= maxImpliedProbability;
  };
}

/** Matches with a heavy favourite — where corner volume concentrates. */
export function hasHeavyFavourite(minImpliedProbability = 0.7): MatchFilter {
  return (match) => {
    const home = firstOdds(match, ["MaxCH", "AvgCH", "B365H", "PSH"]);
    const away = firstOdds(match, ["MaxCA", "AvgCA", "B365A", "PSA"]);
    if (home === null || away === null) return false;
    return 1 / home >= minImpliedProbability || 1 / away >= minImpliedProbability;
  };
}

export function all(...filters: MatchFilter[]): MatchFilter {
  return (match) => filters.every((f) => f(match));
}

export function any(...filters: MatchFilter[]): MatchFilter {
  return (match) => filters.some((f) => f(match));
}

export function not(filter: MatchFilter): MatchFilter {
  return (match) => !filter(match);
}

/** First non-empty odds column from `columns`, or null when none are present. */
export function firstOdds(match: MatchRow, columns: string[]): number | null {
  for (const column of columns) {
    const value = match.odds[column];
    if (typeof value === "number" && Number.isFinite(value) && value > 1) return value;
  }
  return null;
}

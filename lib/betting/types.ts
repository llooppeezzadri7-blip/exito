/**
 * Shared types for the betting engine.
 *
 * Everything here is expressed in DECIMAL (European) odds, which is what
 * Sportium and the rest of the Spanish market quote.
 */

/** Decimal odds, e.g. 1.85. Always > 1. A 1.00 quote pays nothing. */
export type DecimalOdds = number;

/** A probability in the 0-1 range. */
export type Probability = number;

/** How a set of quoted odds is converted back into fair probabilities. */
export type DevigMethod = "proportional" | "power" | "shin";

export interface Selection {
  /** Stable id so results can be traced back to the bet. */
  id: string;
  /** Human label, e.g. "Over 8.5 córners". */
  label: string;
  /** The price Sportium is offering. */
  odds: DecimalOdds;
  /** Your estimated true probability of it landing, 0-1. */
  probability: Probability;
}

export interface ValueAssessment {
  /** Probability the odds themselves imply (1 / odds), margin included. */
  impliedProbability: Probability;
  /** probability * odds - 1. Positive means the price is in your favour. */
  edge: number;
  /** Expected profit per 1u staked. Same number as `edge` for a simple bet. */
  expectedValue: number;
  /** Minimum win rate that breaks even at these odds (1 / odds). */
  breakEvenProbability: Probability;
  /** Full Kelly stake as a fraction of bankroll. Negative means do not bet. */
  kellyFull: number;
}

/** One historical match, normalised from a football-data.co.uk row. */
export interface MatchRow {
  /** Division code, e.g. "SP1" (LaLiga) or "E0" (Premier League). */
  division: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  homeTeam: string;
  awayTeam: string;
  goals: { home: number; away: number } | null;
  corners: { home: number; away: number } | null;
  yellows: { home: number; away: number } | null;
  reds: { home: number; away: number } | null;
  shotsOnTarget: { home: number; away: number } | null;
  fouls: { home: number; away: number } | null;
  /** Raw odds columns, keyed by the original CSV header (e.g. "B365>2.5"). */
  odds: Record<string, number>;
}

/** How a market settled for one match. `null` = the row lacks the data to tell. */
export type MarketOutcome = boolean | null;

export interface Market {
  /** Stable key, e.g. "over_2.5_cards". */
  key: string;
  /** Spanish label shown to the user. */
  label: string;
  /** Did this market win for this match? */
  settle: (match: MatchRow) => MarketOutcome;
  /**
   * CSV headers holding the price for this market, best first. Markets with no
   * price column in football-data can still be backtested for hit rate, but
   * ROI then needs an assumed price.
   */
  oddsColumns: string[];
}

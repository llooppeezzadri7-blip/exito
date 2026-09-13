import type { DecimalOdds } from "../types";

/**
 * Where a number came from. This is the most important type in the betting
 * module: it is attached to every quote and every recommendation, and it is
 * never optional, so nothing can be displayed without saying what it is.
 */
export type Provenance =
  /** Fetched live from a real odds source. Safe to bet on. */
  | "real"
  /** Measured from historical results. Real data, but about the past. */
  | "backtest"
  /** Invented to exercise the system. NEVER bet on this. */
  | "demo";

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  real: "REAL",
  backtest: "BACKTEST",
  demo: "DEMO",
};

export const PROVENANCE_DESCRIPTION: Record<Provenance, string> = {
  real: "Cuota obtenida en vivo de una fuente real.",
  backtest: "Medido sobre resultados históricos. Es dato real, pero del pasado, no del partido de hoy.",
  demo: "Dato inventado para probar el sistema. NO apuestes con esto.",
};

/** A single price for a single selection, as offered by one bookmaker. */
export interface OddsQuote {
  /** Stable id of the event, from the source. */
  eventId: string;
  sport: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  /** ISO timestamp of kick-off. */
  commenceTime: string;
  /** Market key, e.g. "h2h", "totals", "over_2.5_cards". */
  marketKey: string;
  /** Spanish label of the market. */
  marketLabel: string;
  /** The selection being priced, e.g. "Barcelona" or "Más de 2,5". */
  selection: string;
  odds: DecimalOdds;
  /** Which bookmaker is quoting this. */
  bookmaker: string;
  /** ISO timestamp of when this price was read. */
  fetchedAt: string;
  provenance: Provenance;
}

export interface OddsSnapshot {
  quotes: OddsQuote[];
  /** The source that produced these quotes. */
  source: string;
  provenance: Provenance;
  fetchedAt: string;
  /** Set when the source could not be reached, so the UI can say why. */
  error?: string;
}

export interface OddsProvider {
  /** Short id, e.g. "the-odds-api". */
  readonly id: string;
  /** Human name shown as "Fuente de la cuota". */
  readonly name: string;
  readonly provenance: Provenance;
  /** False when the provider is missing its API key or is otherwise unusable. */
  isConfigured(): boolean;
  /** Why it is not configured, for the UI to display. */
  configurationHint(): string;
  fetchOdds(options: FetchOptions): Promise<OddsSnapshot>;
}

export interface FetchOptions {
  /** Sport key as the source spells it, e.g. "soccer_spain_la_liga". */
  sport: string;
  /** Restrict to one bookmaker, e.g. "sportium". */
  bookmaker?: string;
  /** Markets to request. */
  markets?: string[];
}

export const LA_LIGA = "soccer_spain_la_liga";
export const PREMIER_LEAGUE = "soccer_epl";

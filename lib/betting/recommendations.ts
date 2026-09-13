import { expectedValue, impliedProbability } from "./odds";
import type { OddsQuote, Provenance } from "./providers/types";
import { screenSelection, SYSTEM_BAND } from "./sportium";
import { fractionalKellyStake } from "./staking";
import type { DecimalOdds, Probability } from "./types";

/**
 * Turning prices into recommendations.
 *
 * The rule that shapes this whole module: a recommendation needs BOTH a price
 * and a probability, and each has to say where it came from. There is no
 * default probability and no fallback estimate — without an estimate the quote
 * is reported as unanalysable rather than guessed at. An invented number that
 * looks like a model output is worse than no output.
 */

export type ProbabilitySource =
  /** Base rate measured over historical results. */
  | "backtest"
  /** Derived by stripping the margin from another bookmaker's market. */
  | "market-devig"
  /** Typed in by the user. */
  | "manual"
  /** Fabricated for the demo. */
  | "demo";

export const PROBABILITY_SOURCE_LABEL: Record<ProbabilitySource, string> = {
  backtest: "Backtest histórico",
  "market-devig": "Mercado sin margen",
  manual: "Estimación manual",
  demo: "DEMO (inventada)",
};

export interface ProbabilityEstimate {
  value: Probability;
  source: ProbabilitySource;
  /** One line explaining how this number was reached. Shown in the UI. */
  basis: string;
  /** Number of historical bets behind it, when it comes from a backtest. */
  sampleSize?: number;
  /** Lower bound of the 95% interval, when known. */
  confidenceLow?: number;
}

export type ConfidenceLevel = "alta" | "media" | "baja" | "ninguna";

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  alta: "Alta",
  media: "Media",
  baja: "Baja",
  ninguna: "Ninguna",
};

export interface Recommendation {
  id: string;
  // --- Event ---
  event: string;
  sport: string;
  competition: string;
  /** ISO kick-off time. */
  commenceTime: string;
  // --- The bet ---
  market: string;
  selection: string;
  odds: DecimalOdds;
  // --- The numbers ---
  impliedProbability: Probability;
  estimatedProbability: Probability;
  /** probability * odds - 1. */
  edge: number;
  stakeEur: number;
  stakePercentOfBankroll: number;
  confidence: ConfidenceLevel;
  // --- Provenance, never optional ---
  oddsProvenance: Provenance;
  probabilitySource: ProbabilitySource;
  probabilityBasis: string;
  /** The weakest link of the two above. `real` only when everything is real. */
  overallProvenance: Provenance;
  /** True only when this is safe to actually bet. */
  bettable: boolean;
  // --- Verdict ---
  accepted: boolean;
  verdict: string;
  // --- Traceability ---
  bookmaker: string;
  source: string;
  fetchedAt: string;
  generatedAt: string;
}

/** A quote that could not be analysed, and why. Surfaced, never dropped. */
export interface UnanalysedQuote {
  quote: OddsQuote;
  reason: string;
}

export interface AnalysisResult {
  recommendations: Recommendation[];
  unanalysed: UnanalysedQuote[];
  /** Weakest provenance across all recommendations. */
  overallProvenance: Provenance;
  bettableCount: number;
  generatedAt: string;
}

export interface AnalysisOptions {
  /** Bankroll used to size stakes, in euros. */
  bankrollEur: number;
  /** Odds band to enforce. Pass null to analyse everything. */
  band?: { min: number; max: number } | null;
  /** Name of the source, for the "Fuente de la cuota" column. */
  source: string;
  /** Fraction of Kelly to stake. */
  kellyFraction?: number;
  /** Hard cap on stake as a share of bankroll. */
  maxStakePercent?: number;
}

/** Key identifying which estimate applies to which quote. */
export function estimateKey(quote: OddsQuote): string {
  return `${quote.eventId}::${quote.marketKey}::${quote.selection}`;
}

/** `demo` beats everything, then `backtest`; `real` only when all are real. */
export function combineProvenance(...values: Provenance[]): Provenance {
  if (values.includes("demo")) return "demo";
  if (values.includes("backtest")) return "backtest";
  return "real";
}

function provenanceOfSource(source: ProbabilitySource): Provenance {
  switch (source) {
    case "demo":
      return "demo";
    case "backtest":
      return "backtest";
    case "market-devig":
    case "manual":
      return "real";
  }
}

/**
 * How much weight the estimate deserves.
 *
 * A hand-typed probability is never more than "baja" however confident it
 * feels, and anything touching demo data is "ninguna".
 */
export function confidenceFor(estimate: ProbabilityEstimate, odds: DecimalOdds): ConfidenceLevel {
  if (estimate.source === "demo") return "ninguna";
  if (estimate.source === "manual") return "baja";

  if (estimate.source === "backtest") {
    const breakEven = impliedProbability(odds);
    const { sampleSize = 0, confidenceLow } = estimate;
    if (sampleSize >= 300 && confidenceLow !== undefined && confidenceLow > breakEven) return "alta";
    if (sampleSize >= 100) return "media";
    return "baja";
  }

  // market-devig: a real market's own opinion, stripped of margin.
  return "media";
}

/**
 * Build recommendations from quotes plus the estimates that apply to them.
 *
 * Quotes with no estimate are NOT dropped: they come back in `unanalysed` so
 * the dashboard can show that the system saw them and declined to score them.
 */
export function analyseQuotes(
  quotes: OddsQuote[],
  estimates: Map<string, ProbabilityEstimate>,
  options: AnalysisOptions
): AnalysisResult {
  const {
    bankrollEur,
    band = SYSTEM_BAND,
    source,
    kellyFraction = 0.25,
    maxStakePercent = 0.02,
  } = options;
  const generatedAt = new Date().toISOString();

  const recommendations: Recommendation[] = [];
  const unanalysed: UnanalysedQuote[] = [];

  for (const quote of quotes) {
    const estimate = estimates.get(estimateKey(quote));
    if (!estimate) {
      unanalysed.push({
        quote,
        reason:
          "Sin probabilidad estimada para este mercado. El sistema no inventa una: " +
          "hace falta un backtest con datos históricos o una estimación manual.",
      });
      continue;
    }

    const verdict = screenSelection(estimate.value, quote.odds, band ?? { min: 1, max: Infinity });
    const edge = expectedValue(estimate.value, quote.odds);
    const overallProvenance = combineProvenance(
      quote.provenance,
      provenanceOfSource(estimate.source)
    );
    const stakeEur = verdict.accepted
      ? fractionalKellyStake(bankrollEur, estimate.value, quote.odds, kellyFraction, maxStakePercent)
      : 0;

    recommendations.push({
      id: estimateKey(quote),
      event: `${quote.homeTeam} - ${quote.awayTeam}`,
      sport: quote.sport,
      competition: quote.competition,
      commenceTime: quote.commenceTime,
      market: quote.marketLabel,
      selection: quote.selection,
      odds: quote.odds,
      impliedProbability: impliedProbability(quote.odds),
      estimatedProbability: estimate.value,
      edge,
      stakeEur,
      stakePercentOfBankroll: bankrollEur > 0 ? stakeEur / bankrollEur : 0,
      confidence: confidenceFor(estimate, quote.odds),
      oddsProvenance: quote.provenance,
      probabilitySource: estimate.source,
      probabilityBasis: estimate.basis,
      overallProvenance,
      // Only a fully real chain is bettable. Backtest probabilities describe
      // the past, so they inform a bet but do not by themselves justify one.
      bettable: overallProvenance === "real" && verdict.accepted,
      accepted: verdict.accepted,
      verdict: verdict.reason,
      bookmaker: quote.bookmaker,
      source,
      fetchedAt: quote.fetchedAt,
      generatedAt,
    });
  }

  // Best expected value first — that is the ranking that matters, not hit rate.
  recommendations.sort((a, b) => b.edge - a.edge);

  return {
    recommendations,
    unanalysed,
    overallProvenance: combineProvenance(...recommendations.map((r) => r.overallProvenance)),
    bettableCount: recommendations.filter((r) => r.bettable).length,
    generatedAt,
  };
}

/**
 * Estimates derived from the other side of the same market.
 *
 * This is the one way the system can produce a real probability without a
 * backtest: take a complete market, strip the margin, and use the result. It
 * is honest but circular — it can only find value against a DIFFERENT
 * bookmaker's price, never against the same one it was derived from.
 */
export function devigEstimate(
  fairProbability: Probability,
  bookmaker: string
): ProbabilityEstimate {
  return {
    value: fairProbability,
    source: "market-devig",
    basis: `Probabilidad real del mercado de ${bookmaker}, quitado su margen (método de Shin).`,
  };
}

/** Estimate backed by a measured historical base rate. */
export function backtestEstimate(
  hitRate: Probability,
  sampleSize: number,
  confidenceLow: number,
  basis: string
): ProbabilityEstimate {
  return { value: hitRate, source: "backtest", sampleSize, confidenceLow, basis };
}

/** Estimate the user typed in. Always low confidence. */
export function manualEstimate(value: Probability, basis = "Introducida a mano."): ProbabilityEstimate {
  return { value, source: "manual", basis };
}

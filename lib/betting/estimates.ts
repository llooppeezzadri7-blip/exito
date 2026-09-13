import { removeMargin } from "./odds";
import type { OddsQuote } from "./providers/types";
import { devigEstimate, estimateKey, manualEstimate, type ProbabilityEstimate } from "./recommendations";

/**
 * Where probability estimates come from.
 *
 * The system has no fitted predictive model — it does not forecast matches. It
 * has exactly two honest sources of a probability: a base rate measured over
 * history (the backtester), and the opinion of a sharp market with its margin
 * removed. This module builds the second.
 */

interface MarketGroup {
  eventId: string;
  marketKey: string;
  bookmaker: string;
  quotes: OddsQuote[];
}

function groupByMarket(quotes: OddsQuote[]): MarketGroup[] {
  const groups = new Map<string, MarketGroup>();

  for (const quote of quotes) {
    const key = `${quote.eventId}::${quote.marketKey}::${quote.bookmaker}::${quote.marketLabel}`;
    const group = groups.get(key);
    if (group) group.quotes.push(quote);
    else
      groups.set(key, {
        eventId: quote.eventId,
        marketKey: quote.marketKey,
        bookmaker: quote.bookmaker,
        quotes: [quote],
      });
  }

  // Only complete markets can be de-vigged.
  return [...groups.values()].filter((group) => group.quotes.length >= 2);
}

function overround(group: MarketGroup): number {
  return group.quotes.reduce((sum, quote) => sum + 1 / quote.odds, 0) - 1;
}

/**
 * The bookmaker whose prices carry the least margin, across the markets it
 * quotes. That is the closest thing to the market's true opinion available.
 */
export function sharpestBookmaker(quotes: OddsQuote[]): string | null {
  const byBookmaker = new Map<string, { total: number; count: number }>();

  for (const group of groupByMarket(quotes)) {
    const margin = overround(group);
    if (!Number.isFinite(margin) || margin < 0) continue;
    const current = byBookmaker.get(group.bookmaker) ?? { total: 0, count: 0 };
    byBookmaker.set(group.bookmaker, { total: current.total + margin, count: current.count + 1 });
  }

  let best: { bookmaker: string; average: number } | null = null;
  for (const [bookmaker, { total, count }] of byBookmaker) {
    const average = total / count;
    if (!best || average < best.average) best = { bookmaker, average };
  }

  return best?.bookmaker ?? null;
}

export interface DevigResult {
  estimates: Map<string, ProbabilityEstimate>;
  /** The bookmaker used as the reference opinion. */
  reference: string | null;
  /** Markets that could not be de-vigged, and why. */
  skipped: { market: string; reason: string }[];
}

/**
 * Build estimates by stripping the margin from a reference bookmaker.
 *
 * The estimates are keyed so they apply to EVERY bookmaker's quote on the same
 * selection — which is the point: you compare the sharp book's true opinion
 * against the price Sportium is offering. Comparing a book against itself can
 * only ever return zero edge, so passing a single-bookmaker snapshot here is
 * valid but will find nothing.
 */
export function devigEstimates(quotes: OddsQuote[], referenceBookmaker?: string): DevigResult {
  const reference = referenceBookmaker ?? sharpestBookmaker(quotes);
  const estimates = new Map<string, ProbabilityEstimate>();
  const skipped: { market: string; reason: string }[] = [];

  if (!reference) {
    return { estimates, reference: null, skipped: [{ market: "todos", reason: "Ningún mercado completo para quitar el margen." }] };
  }

  for (const group of groupByMarket(quotes)) {
    if (group.bookmaker !== reference) continue;

    const label = `${group.quotes[0].marketLabel} (${group.quotes[0].homeTeam} - ${group.quotes[0].awayTeam})`;
    try {
      const fair = removeMargin(group.quotes.map((quote) => quote.odds));
      group.quotes.forEach((quote, index) => {
        const probability = fair[index];
        if (probability === undefined || !(probability > 0)) return;
        // Key without the bookmaker so the estimate applies to every book's price.
        estimates.set(estimateKey(quote), devigEstimate(probability, reference));
      });
    } catch (cause) {
      skipped.push({ market: label, reason: cause instanceof Error ? cause.message : String(cause) });
    }
  }

  return { estimates, reference, skipped };
}

/**
 * Estimates for the demo provider.
 *
 * Deliberately sits in its own function, tagged `demo`, so that a fabricated
 * probability can never reach the dashboard wearing a real label.
 */
export function demoEstimates(quotes: OddsQuote[]): Map<string, ProbabilityEstimate> {
  const estimates = new Map<string, ProbabilityEstimate>();

  for (const quote of quotes) {
    if (quote.provenance !== "demo") continue;
    // A fixed offset above the implied probability, purely so the pipeline has
    // something to rank. It means nothing about any real match.
    const implied = 1 / quote.odds;
    estimates.set(estimateKey(quote), {
      value: Math.min(0.97, implied + 0.05),
      source: "demo",
      basis: "Valor inventado (implícita + 5 puntos) solo para que el pipeline produzca filas.",
    });
  }

  return estimates;
}

/** Estimates typed in by hand, keyed the same way as the automatic ones. */
export function manualEstimates(
  entries: { quote: OddsQuote; probability: number; basis?: string }[]
): Map<string, ProbabilityEstimate> {
  const estimates = new Map<string, ProbabilityEstimate>();
  for (const entry of entries) {
    estimates.set(estimateKey(entry.quote), manualEstimate(entry.probability, entry.basis));
  }
  return estimates;
}

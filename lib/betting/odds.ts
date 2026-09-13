import type { DecimalOdds, DevigMethod, Probability, ValueAssessment } from "./types";

/**
 * Core odds mathematics.
 *
 * Everything is a pure function of numbers so it can be unit tested and reused
 * from the UI, the backtester and any script.
 */

/** Raw probability the price implies, bookmaker margin included. */
export function impliedProbability(odds: DecimalOdds): Probability {
  if (!(odds > 1)) throw new RangeError(`Cuota inválida: ${odds}. Debe ser mayor que 1.`);
  return 1 / odds;
}

/** Decimal odds that would be fair for a given probability. */
export function fairOdds(probability: Probability): DecimalOdds {
  if (!(probability > 0 && probability <= 1)) {
    throw new RangeError(`Probabilidad inválida: ${probability}. Debe estar en (0, 1].`);
  }
  return 1 / probability;
}

/**
 * Bookmaker overround for a complete market (all outcomes).
 * 0.05 means the book is charging a 5% margin.
 */
export function bookmakerMargin(oddsList: DecimalOdds[]): number {
  assertCompleteMarket(oddsList);
  return oddsList.reduce((sum, o) => sum + impliedProbability(o), 0) - 1;
}

/**
 * The minimum win rate that breaks even at these odds.
 * At 1.25 you need 80%; this is the number that decides whether a
 * high-hit-rate system is profitable at all.
 */
export function breakEvenProbability(odds: DecimalOdds): Probability {
  return impliedProbability(odds);
}

/** The minimum odds that break even at a given win rate. 80% -> 1.25. */
export function breakEvenOdds(hitRate: Probability): DecimalOdds {
  return fairOdds(hitRate);
}

/**
 * Return on investment of a flat-staked strategy.
 * roi(0.80, 1.30) = +0.04, i.e. +4% of everything staked.
 */
export function roiAt(hitRate: Probability, averageOdds: DecimalOdds): number {
  return hitRate * averageOdds - 1;
}

/** Expected profit per unit staked. Positive = the bet is worth making. */
export function expectedValue(probability: Probability, odds: DecimalOdds): number {
  return probability * odds - 1;
}

/**
 * Full Kelly stake as a fraction of bankroll.
 * Negative means the bet has no edge and should not be placed.
 */
export function kellyFraction(probability: Probability, odds: DecimalOdds): number {
  const b = odds - 1;
  if (b <= 0) return 0;
  return (probability * b - (1 - probability)) / b;
}

/** Full assessment of a single price against your estimated probability. */
export function assessValue(probability: Probability, odds: DecimalOdds): ValueAssessment {
  const ev = expectedValue(probability, odds);
  return {
    impliedProbability: impliedProbability(odds),
    edge: ev,
    expectedValue: ev,
    breakEvenProbability: breakEvenProbability(odds),
    kellyFull: kellyFraction(probability, odds),
  };
}

/** Combined decimal odds of an accumulator (assumes independent legs). */
export function parlayOdds(oddsList: DecimalOdds[]): DecimalOdds {
  if (oddsList.length === 0) throw new RangeError("Una combinada necesita al menos una selección.");
  return oddsList.reduce((product, o) => product * o, 1);
}

/** Probability all legs land (assumes independence — see APUESTAS.md). */
export function parlayProbability(probabilities: Probability[]): Probability {
  return probabilities.reduce((product, p) => product * p, 1);
}

// ---------------------------------------------------------------------------
// De-vigging: stripping the bookmaker margin out of a complete market
// ---------------------------------------------------------------------------

/**
 * Remove the bookmaker margin from a complete market to recover fair
 * probabilities.
 *
 * - `proportional` divides every implied probability by the overround. Simple,
 *   but it over-taxes favourites and under-taxes longshots.
 * - `power` solves for k in p_i = π_i^k. Better behaved on 2-way markets.
 * - `shin` models the margin as protection against insider money. This is the
 *   standard in the literature and the default here, because it handles the
 *   favourite-longshot bias that matters most in the 1.28-1.45 band.
 */
export function removeMargin(oddsList: DecimalOdds[], method: DevigMethod = "shin"): Probability[] {
  assertCompleteMarket(oddsList);
  const implied = oddsList.map(impliedProbability);

  switch (method) {
    case "proportional":
      return devigProportional(implied);
    case "power":
      return devigPower(implied);
    case "shin":
      return devigShin(implied);
  }
}

/** Fair odds for a complete market, margin removed. */
export function fairOddsForMarket(oddsList: DecimalOdds[], method: DevigMethod = "shin"): DecimalOdds[] {
  return removeMargin(oddsList, method).map(fairOdds);
}

function devigProportional(implied: Probability[]): Probability[] {
  const total = implied.reduce((sum, p) => sum + p, 0);
  return implied.map((p) => p / total);
}

function devigPower(implied: Probability[]): Probability[] {
  // Solve for k so that sum(π_i^k) = 1. Overround > 1 means k > 1.
  const k = bisect(
    (exponent) => implied.reduce((sum, p) => sum + Math.pow(p, exponent), 0) - 1,
    0.5,
    20
  );
  if (k === null) return devigProportional(implied);
  return implied.map((p) => Math.pow(p, k));
}

function devigShin(implied: Probability[]): Probability[] {
  const total = implied.reduce((sum, p) => sum + p, 0);
  // z is the implied share of insider money. z = 0 collapses to proportional.
  const z = bisect((candidate) => shinSum(implied, total, candidate) - 1, 0, 0.95);
  if (z === null) return devigProportional(implied);
  return implied.map((p) => shinProbability(p, total, z));
}

function shinProbability(implied: Probability, total: number, z: number): Probability {
  // At z = 0 this reduces to implied / sqrt(total), which still sums to more
  // than 1 while the market carries margin — that is exactly why a root for z
  // exists. Do not special-case z = 0: it makes the function discontinuous and
  // the solver latches onto a spurious root at the bracket edge.
  const inner = z * z + (4 * (1 - z) * (implied * implied)) / total;
  return (Math.sqrt(inner) - z) / (2 * (1 - z));
}

function shinSum(implied: Probability[], total: number, z: number): number {
  return implied.reduce((sum, p) => sum + shinProbability(p, total, z), 0);
}

/**
 * Bisection root finder. Returns null when the bracket does not contain a sign
 * change, so callers can fall back instead of returning a bogus root.
 */
function bisect(fn: (x: number) => number, lo: number, hi: number, tolerance = 1e-10): number | null {
  let low = lo;
  let high = hi;
  let fLow = fn(low);
  let fHigh = fn(high);
  if (Number.isNaN(fLow) || Number.isNaN(fHigh) || fLow * fHigh > 0) return null;

  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    const fMid = fn(mid);
    if (Number.isNaN(fMid)) return null;
    if (Math.abs(fMid) < tolerance || high - low < tolerance) return mid;
    if (fLow * fMid <= 0) {
      high = mid;
      fHigh = fMid;
    } else {
      low = mid;
      fLow = fMid;
    }
  }
  return (low + high) / 2;
}

function assertCompleteMarket(oddsList: DecimalOdds[]): void {
  if (oddsList.length < 2) {
    throw new RangeError("Se necesitan al menos 2 resultados para quitar el margen de un mercado.");
  }
  const total = oddsList.reduce((sum, o) => sum + impliedProbability(o), 0);
  if (total < 1) {
    throw new RangeError(
      `Estas cuotas suman ${total.toFixed(4)} (<1): hay arbitraje o falta algún resultado del mercado.`
    );
  }
}

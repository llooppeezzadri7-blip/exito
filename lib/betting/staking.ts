import { kellyFraction, removeMargin } from "./odds";
import type { DecimalOdds, Probability } from "./types";

/**
 * Stake sizing and Closing Line Value.
 *
 * CLV is the only metric that tells you whether you have an edge BEFORE the
 * results arrive. If the price you took is consistently better than the price
 * the market closed at, you are ahead of the market; if it is not, a good run
 * of results was luck.
 */

/** Flat stake as a percentage of bankroll. The default for a thin edge. */
export function flatStake(bankroll: number, percentOfBankroll = 0.01): number {
  return bankroll * percentOfBankroll;
}

/**
 * Fractional Kelly, capped.
 *
 * Full Kelly is far too aggressive when the probability is an estimate rather
 * than a known quantity, and in this system it always is. Quarter Kelly with a
 * hard cap is the sane default.
 */
export function fractionalKellyStake(
  bankroll: number,
  probability: Probability,
  odds: DecimalOdds,
  fraction = 0.25,
  maxPercentOfBankroll = 0.02
): number {
  const full = kellyFraction(probability, odds);
  if (full <= 0) return 0;
  return bankroll * Math.min(full * fraction, maxPercentOfBankroll);
}

// ---------------------------------------------------------------------------
// Closing Line Value
// ---------------------------------------------------------------------------

export interface ClvBet {
  id: string;
  /** The price you actually took. */
  takenOdds: DecimalOdds;
  /** The price the sharpest market closed at (Pinnacle or Betfair). */
  closingOdds: DecimalOdds;
}

/**
 * Raw CLV of a single bet: how much better your price was than the close.
 * +0.04 means you beat the closing line by 4%.
 */
export function closingLineValue(takenOdds: DecimalOdds, closingOdds: DecimalOdds): number {
  if (!(takenOdds > 1) || !(closingOdds > 1)) {
    throw new RangeError("Ambas cuotas deben ser mayores que 1 para calcular el CLV.");
  }
  return takenOdds / closingOdds - 1;
}

/**
 * CLV measured against the closing price with the margin stripped out.
 *
 * This is the stricter and more useful version: beating a closing price that
 * still carries a 5% margin is not the same as beating the true market. Pass
 * both sides of the closing market.
 */
export function trueClosingLineValue(
  takenOdds: DecimalOdds,
  closingOddsBothSides: DecimalOdds[],
  sideIndex = 0
): number {
  const fair = removeMargin(closingOddsBothSides);
  const fairProbability = fair[sideIndex];
  if (fairProbability === undefined) throw new RangeError("Índice de selección fuera de rango.");
  return takenOdds * fairProbability - 1;
}

export interface ClvSummary {
  bets: number;
  /** Mean CLV across the sample. Sustained positive values mean a real edge. */
  averageClv: number;
  /** Share of bets that beat the closing price. Aim above 50%. */
  beatCloseRate: number;
  verdict: string;
}

export function summarizeClv(bets: ClvBet[]): ClvSummary {
  if (bets.length === 0) {
    return { bets: 0, averageClv: 0, beatCloseRate: 0, verdict: "Sin apuestas registradas todavía." };
  }

  const values = bets.map((b) => closingLineValue(b.takenOdds, b.closingOdds));
  const averageClv = values.reduce((sum, v) => sum + v, 0) / values.length;
  const beatCloseRate = values.filter((v) => v > 0).length / values.length;

  const verdict =
    averageClv > 0.01
      ? `CLV medio +${(averageClv * 100).toFixed(2)}%: vas por delante del mercado. Esto sí es edge.`
      : averageClv > 0
        ? `CLV medio +${(averageClv * 100).toFixed(2)}%: marginal. Sigue midiendo antes de subir stakes.`
        : `CLV medio ${(averageClv * 100).toFixed(2)}%: no bates la línea de cierre. Los aciertos que lleves son suerte.`;

  return { bets: bets.length, averageClv, beatCloseRate, verdict };
}

// ---------------------------------------------------------------------------
// Variance
// ---------------------------------------------------------------------------

export interface DrawdownEstimate {
  /** Probability of at least one losing run of `streak` bets. */
  probabilityOfStreak: number;
  /** The losing streak you should expect at least once over `bets`. */
  expectedWorstStreak: number;
}

/**
 * What a given hit rate actually feels like.
 *
 * At an 80% hit rate over 500 bets, a run of 4 losses is close to a coin flip
 * (~55%) and a run of 5 still happens about one time in seven. If a run like
 * that would make you abandon the system or chase, the system is wrong for you
 * regardless of its ROI.
 */
export function drawdownEstimate(hitRate: Probability, bets: number, streak: number): DrawdownEstimate {
  const lossRate = 1 - hitRate;
  // Expected number of starting positions for a run of `streak` losses.
  const expectedRuns = Math.max(0, bets - streak + 1) * Math.pow(lossRate, streak);
  const probabilityOfStreak = 1 - Math.exp(-expectedRuns);

  // Standard approximation for the longest expected run of losses.
  const expectedWorstStreak =
    lossRate > 0 && lossRate < 1 ? Math.log(bets * (1 - lossRate)) / Math.log(1 / lossRate) : 0;

  return { probabilityOfStreak, expectedWorstStreak: Math.max(0, expectedWorstStreak) };
}

import { firstOdds, type MatchFilter } from "./markets";
import { breakEvenOdds, roiAt } from "./odds";
import { SYSTEM_BAND } from "./sportium";
import type { DecimalOdds, Market, MatchRow } from "./types";

/**
 * Backtest engine.
 *
 * The point of this module is not to produce a nice number. It is to answer
 * one question honestly: is the hit rate you measured distinguishable from
 * luck, and does it still clear break-even at the prices you actually got?
 */

/** Below this many settled bets, a hit rate says nothing about the next one. */
export const MIN_SAMPLE = 300;

/** 95% two-sided normal quantile, used for the Wilson interval. */
const Z_95 = 1.959963985;

export interface BacktestOptions {
  market: Market;
  /** Restrict which matches count as a bet. */
  filter?: MatchFilter;
  /** Override the market's own odds columns. */
  oddsColumns?: string[];
  /**
   * Price to assume when the dataset carries no odds for this market (corners
   * and cards have none). Results are then hypothetical — say so out loud.
   */
  assumedOdds?: DecimalOdds;
  /** Reject bets priced outside the band. Pass null to measure everything. */
  band?: { min: number; max: number } | null;
  /** Flat stake per bet, in units. */
  stake?: number;
}

export interface BacktestBet {
  date: string;
  homeTeam: string;
  awayTeam: string;
  odds: DecimalOdds;
  won: boolean;
  profit: number;
  /** Running profit after this bet, in units. */
  bankroll: number;
}

export interface ConfidenceInterval {
  low: number;
  high: number;
}

export interface BacktestResult {
  market: string;
  bets: BacktestBet[];
  settled: number;
  wins: number;
  hitRate: number;
  /** Wilson score interval — correct at the small samples a season gives you. */
  hitRate95: ConfidenceInterval;
  averageOdds: DecimalOdds;
  /** Hit rate needed to break even at `averageOdds`. */
  breakEvenHitRate: number;
  /** Odds needed to break even at the measured hit rate. */
  breakEvenOdds: DecimalOdds;
  staked: number;
  profit: number;
  roi: number;
  maxDrawdown: number;
  longestLosingStreak: number;
  /** Matches skipped for missing results or missing prices. */
  skipped: { noOutcome: number; noOdds: number; outOfBand: number; filtered: number };
  /** True only when the LOWER bound of the interval still clears break-even. */
  edgeIsSignificant: boolean;
  /** True when the sample is big enough to mean anything. */
  sampleIsSufficient: boolean;
  /** Set when prices were assumed rather than read from the data. */
  pricesWereAssumed: boolean;
}

/**
 * Wilson score interval for a binomial proportion.
 * Preferred over the normal approximation because hit rates near 0.8 with a
 * few hundred samples are exactly where the normal interval misbehaves.
 */
export function wilsonInterval(successes: number, n: number, z = Z_95): ConfidenceInterval {
  if (n === 0) return { low: 0, high: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denominator;
  const margin = (z / denominator) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

export function runBacktest(matches: MatchRow[], options: BacktestOptions): BacktestResult {
  const { market, filter, oddsColumns, assumedOdds, band = SYSTEM_BAND, stake = 1 } = options;
  const columns = oddsColumns ?? market.oddsColumns;

  const bets: BacktestBet[] = [];
  const skipped = { noOutcome: 0, noOdds: 0, outOfBand: 0, filtered: 0 };
  let pricesWereAssumed = false;
  let bankroll = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let losingStreak = 0;
  let longestLosingStreak = 0;

  for (const match of matches) {
    if (filter && !filter(match)) {
      skipped.filtered += 1;
      continue;
    }

    const outcome = market.settle(match);
    if (outcome === null) {
      skipped.noOutcome += 1;
      continue;
    }

    const priced = columns.length > 0 ? firstOdds(match, columns) : null;
    const odds = priced ?? assumedOdds ?? null;
    if (odds === null) {
      skipped.noOdds += 1;
      continue;
    }
    if (priced === null) pricesWereAssumed = true;

    if (band && (odds < band.min || odds > band.max)) {
      skipped.outOfBand += 1;
      continue;
    }

    const profit = outcome ? stake * (odds - 1) : -stake;
    bankroll += profit;
    peak = Math.max(peak, bankroll);
    maxDrawdown = Math.max(maxDrawdown, peak - bankroll);
    losingStreak = outcome ? 0 : losingStreak + 1;
    longestLosingStreak = Math.max(longestLosingStreak, losingStreak);

    bets.push({
      date: match.date,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      odds,
      won: outcome,
      profit,
      bankroll,
    });
  }

  const settled = bets.length;
  const wins = bets.filter((b) => b.won).length;
  const hitRate = settled > 0 ? wins / settled : 0;
  const averageOdds = settled > 0 ? bets.reduce((sum, b) => sum + b.odds, 0) / settled : 0;
  const staked = settled * stake;
  const hitRate95 = wilsonInterval(wins, settled);

  // The honest test: the worst case of the interval must still beat the price.
  const breakEvenHitRate = averageOdds > 0 ? 1 / averageOdds : 1;
  const edgeIsSignificant = settled > 0 && hitRate95.low > breakEvenHitRate;

  return {
    market: market.key,
    bets,
    settled,
    wins,
    hitRate,
    hitRate95,
    averageOdds,
    breakEvenHitRate,
    breakEvenOdds: hitRate > 0 ? breakEvenOdds(hitRate) : Infinity,
    staked,
    profit: bankroll,
    roi: staked > 0 ? bankroll / staked : 0,
    maxDrawdown,
    longestLosingStreak,
    skipped,
    edgeIsSignificant,
    sampleIsSufficient: settled >= MIN_SAMPLE,
    pricesWereAssumed,
  };
}

/**
 * The price you would have needed for the measured hit rate to yield a target
 * ROI. Use it to know what to hunt for, rather than taking what is offered.
 */
export function oddsNeededForRoi(hitRate: number, targetRoi: number): DecimalOdds {
  if (hitRate <= 0) return Infinity;
  return (1 + targetRoi) / hitRate;
}

/** Human-readable verdict, in Spanish, ready to print or render. */
export function summarize(result: BacktestResult): string {
  if (result.settled === 0) {
    return `${result.market}: 0 apuestas tras los filtros. Revisa el filtro, la banda de cuota o si el dataset trae ese dato.`;
  }

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const lines = [
    `${result.market}: ${result.settled} apuestas, ${result.wins} aciertos.`,
    `Acierto: ${pct(result.hitRate)} (IC 95%: ${pct(result.hitRate95.low)} – ${pct(result.hitRate95.high)}).`,
    `Cuota media: ${result.averageOdds.toFixed(3)} → necesitas acertar ${pct(result.breakEvenHitRate)} para empatar.`,
    `ROI: ${pct(result.roi)} | Beneficio: ${result.profit.toFixed(2)}u | Racha perdedora máxima: ${result.longestLosingStreak} | Drawdown máx: ${result.maxDrawdown.toFixed(2)}u`,
  ];

  if (!result.sampleIsSufficient) {
    lines.push(`AVISO: solo ${result.settled} apuestas (mínimo recomendado ${MIN_SAMPLE}). Esto todavía es ruido.`);
  }
  if (result.pricesWereAssumed) {
    lines.push("AVISO: parte de las cuotas son asumidas, no reales. El ROI es hipotético.");
  }
  lines.push(
    result.edgeIsSignificant
      ? "VEREDICTO: incluso en el peor caso del intervalo el sistema gana. Hay edge medible."
      : "VEREDICTO: el intervalo incluye el punto de equilibrio. No puedes distinguir esto de la suerte todavía."
  );

  return lines.join("\n");
}

/** ROI a strategy would produce at a hypothetical hit rate and price. */
export function projectRoi(hitRate: number, averageOdds: DecimalOdds): number {
  return roiAt(hitRate, averageOdds);
}

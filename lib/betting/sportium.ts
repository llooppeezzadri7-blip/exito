import { expectedValue, impliedProbability, parlayOdds, parlayProbability } from "./odds";
import type { DecimalOdds, Probability } from "./types";

/**
 * Sportium-specific mechanics.
 *
 * The numbers in `SPORTIUM_DEFAULTS` are typical terms, not guarantees:
 * Sportium changes caps and freebet rules per promotion. Always read the terms
 * of the specific supercuota and override the defaults when they differ.
 */

interface SportiumDefaults {
  readonly supercuotaStakeCapEur: number;
  readonly boostPaidAsFreebet: boolean;
  readonly freebetRetention: number;
  readonly typicalMarginMainMarkets: number;
  readonly typicalMarginSideMarkets: number;
}

export const SPORTIUM_DEFAULTS: SportiumDefaults = {
  /** Most supercuotas only pay the boosted price on the first N euros staked. */
  supercuotaStakeCapEur: 10,
  /**
   * The part of the win above the base price is normally paid as a free bet,
   * not as cash. See `freebetRetention` for what a free bet is really worth.
   */
  boostPaidAsFreebet: true,
  /** Conservative default: a free bet cashed around odds 4 on a 5% market. */
  freebetRetention: 0.7,
  /** Typical two-way margin on Sportium's main football markets. */
  typicalMarginMainMarkets: 0.05,
  /** Side markets (corners, cards) carry more margin and more error. */
  typicalMarginSideMarkets: 0.08,
};

/**
 * The odds band this system lives in.
 *
 * At an 80% hit rate the break-even price is exactly 1.25, so anything below
 * 1.28 has no room for error. Above ~1.45 an 80% hit rate is not realistic,
 * which means a price that high is usually telling you your estimate is wrong.
 */
export const SYSTEM_BAND = { min: 1.28, max: 1.45 } as const;

export interface BandVerdict {
  /** True when the price sits inside the band and the bet has positive edge. */
  accepted: boolean;
  /** Spanish explanation of the decision, ready to show in the UI. */
  reason: string;
  edge: number;
}

/**
 * The single filter that decides whether a selection enters the system.
 * A high hit rate below 1.28 is a losing system, however safe it feels.
 */
export function screenSelection(
  probability: Probability,
  odds: DecimalOdds,
  band: { min: number; max: number } = SYSTEM_BAND
): BandVerdict {
  const edge = expectedValue(probability, odds);

  if (odds < band.min) {
    return {
      accepted: false,
      reason: `Cuota ${odds.toFixed(2)} por debajo de ${band.min.toFixed(2)}: no hay margen para el error aunque aciertes el 80%.`,
      edge,
    };
  }
  if (odds > band.max) {
    return {
      accepted: false,
      reason: `Cuota ${odds.toFixed(2)} por encima de ${band.max.toFixed(2)}: si de verdad fuera 80% el mercado no lo pagaría así. Revisa tu estimación.`,
      edge,
    };
  }
  if (edge <= 0) {
    return {
      accepted: false,
      reason: `Sin valor: necesitas acertar el ${(impliedProbability(odds) * 100).toFixed(1)}% y tu estimación es ${(probability * 100).toFixed(1)}%.`,
      edge,
    };
  }
  return {
    accepted: true,
    reason: `Valor +${(edge * 100).toFixed(2)}% a cuota ${odds.toFixed(2)}.`,
    edge,
  };
}

// ---------------------------------------------------------------------------
// Free bets
// ---------------------------------------------------------------------------

/**
 * What a free bet is actually worth per euro of face value.
 *
 * A free bet returns winnings but not the stake, so its value depends on the
 * odds you cash it at: the higher the odds, the more of the face value you keep.
 */
export function freebetRetention(
  cashOutOdds: DecimalOdds,
  margin = SPORTIUM_DEFAULTS.typicalMarginMainMarkets
): number {
  if (!(cashOutOdds > 1)) throw new RangeError(`Cuota inválida para la apuesta gratis: ${cashOutOdds}.`);
  return (1 - 1 / cashOutOdds) / (1 + margin);
}

/** Expected cash value of a free bet of `face` euros played at given odds. */
export function freebetValue(
  face: number,
  cashOutOdds: DecimalOdds,
  margin = SPORTIUM_DEFAULTS.typicalMarginMainMarkets
): number {
  return face * freebetRetention(cashOutOdds, margin);
}

// ---------------------------------------------------------------------------
// Supercuotas
// ---------------------------------------------------------------------------

export interface SupercuotaInput {
  /** What you stake, in euros. */
  stakeEur: number;
  /** The advertised boosted price. */
  boostedOdds: DecimalOdds;
  /** The normal price for the same selection (what the cash part pays). */
  baseOdds: DecimalOdds;
  /** Your estimated true probability of it landing. */
  probability: Probability;
  /** Euros that actually get the boosted price. */
  stakeCapEur?: number;
  /** What a euro of free bet is really worth to you. */
  freebetRetention?: number;
  /** Set false for the rare promo that pays the boost in cash. */
  boostPaidAsFreebet?: boolean;
}

export interface SupercuotaResult {
  /** Headline number in the banner. Almost always overstates the value. */
  nominalReturnEur: number;
  /** Part of the win paid in withdrawable cash. */
  cashReturnEur: number;
  /** Part of the win paid as a free bet, at face value. */
  freebetFaceEur: number;
  /** The free bet discounted to what it is really worth. */
  realReturnEur: number;
  /** Expected profit in euros. */
  expectedValueEur: number;
  /** Expected profit per euro staked. */
  expectedValuePerEur: number;
  /**
   * The price you are effectively getting once the free bet is discounted.
   * Compare this against the band, not the advertised one.
   */
  effectiveOdds: DecimalOdds;
  notes: string[];
}

/**
 * Work out what a supercuota is really worth.
 *
 * Sportium's typical structure pays the base price in cash and the boost as a
 * free bet, capped to the first ~10 EUR staked. The advertised odds are
 * therefore not the odds you are getting.
 */
export function evaluateSupercuota(input: SupercuotaInput): SupercuotaResult {
  const {
    stakeEur,
    boostedOdds,
    baseOdds,
    probability,
    stakeCapEur = SPORTIUM_DEFAULTS.supercuotaStakeCapEur,
    freebetRetention: retention = SPORTIUM_DEFAULTS.freebetRetention,
    boostPaidAsFreebet = SPORTIUM_DEFAULTS.boostPaidAsFreebet,
  } = input;

  if (stakeEur <= 0) throw new RangeError("El importe apostado debe ser mayor que 0.");
  if (boostedOdds < baseOdds) {
    throw new RangeError("La supercuota no puede ser menor que la cuota base.");
  }

  const boostedStake = Math.min(stakeEur, stakeCapEur);
  const notes: string[] = [];

  // The whole stake settles at the base price in cash; only the capped part
  // earns the extra, and that extra normally arrives as a free bet.
  const cashReturnEur = stakeEur * baseOdds;
  const boostExtraEur = boostedStake * (boostedOdds - baseOdds);
  const freebetFaceEur = boostPaidAsFreebet ? boostExtraEur : 0;
  const cashTotalEur = cashReturnEur + (boostPaidAsFreebet ? 0 : boostExtraEur);

  const realReturnEur = cashTotalEur + freebetFaceEur * retention;
  const nominalReturnEur = cashReturnEur + boostExtraEur;
  const expectedValueEur = probability * realReturnEur - stakeEur;

  if (stakeEur > stakeCapEur) {
    notes.push(
      `Solo los primeros ${stakeCapEur.toFixed(2)} € van a supercuota; los otros ${(stakeEur - stakeCapEur).toFixed(2)} € se pagan a ${baseOdds.toFixed(2)}.`
    );
  }
  if (boostPaidAsFreebet && freebetFaceEur > 0) {
    notes.push(
      `${freebetFaceEur.toFixed(2)} € del premio llegan como apuesta gratis, que valen ~${(freebetFaceEur * retention).toFixed(2)} € reales.`
    );
  }
  notes.push(
    `Cuota efectiva real: ${(realReturnEur / stakeEur).toFixed(2)} (anunciada: ${boostedOdds.toFixed(2)}).`
  );

  return {
    nominalReturnEur,
    cashReturnEur: cashTotalEur,
    freebetFaceEur,
    realReturnEur,
    expectedValueEur,
    expectedValuePerEur: expectedValueEur / stakeEur,
    effectiveOdds: realReturnEur / stakeEur,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Cash out
// ---------------------------------------------------------------------------

export interface CashOutResult {
  /** What the open position is actually worth right now. */
  fairValueEur: number;
  /** What Sportium is offering. */
  offerEur: number;
  /** Fraction of fair value the book is keeping. Positive = you lose by taking it. */
  bookCutPercent: number;
  takeIt: boolean;
  reason: string;
}

/**
 * Compare a cash-out offer against the fair value of the open position.
 * Cash out is priced with a second margin on top of the original one, so it is
 * a losing move unless your estimate of the current win probability has moved
 * hard against the book's.
 */
export function evaluateCashOut(
  stakeEur: number,
  odds: DecimalOdds,
  currentWinProbability: Probability,
  offerEur: number
): CashOutResult {
  const fairValueEur = currentWinProbability * stakeEur * odds;
  const bookCutPercent = fairValueEur > 0 ? 1 - offerEur / fairValueEur : 1;
  const takeIt = offerEur > fairValueEur;

  return {
    fairValueEur,
    offerEur,
    bookCutPercent,
    takeIt,
    reason: takeIt
      ? `La oferta supera el valor real (${fairValueEur.toFixed(2)} €): cerrar es correcto.`
      : `Sportium se queda el ${(bookCutPercent * 100).toFixed(1)}% del valor real (${fairValueEur.toFixed(2)} €). No cierres.`,
  };
}

// ---------------------------------------------------------------------------
// Combinadas and combi boosts
// ---------------------------------------------------------------------------

/**
 * The boost a combi promo must give just to cancel the margin it compounds.
 *
 * With a 5% margin per leg a 4-leg combo needs a +21.6% boost to break even.
 * Books that advertise +5% or +10% are still taking money off you.
 */
export function requiredCombiBoost(legs: number, marginPerLeg: number): number {
  if (legs < 1) throw new RangeError("Una combinada necesita al menos una selección.");
  return Math.pow(1 + marginPerLeg, legs) - 1;
}

export interface CombiResult {
  combinedOdds: DecimalOdds;
  boostedOdds: DecimalOdds;
  combinedProbability: Probability;
  expectedValue: number;
  /** Boost that would be needed to break even at this number of legs. */
  requiredBoost: number;
  verdict: string;
}

/**
 * Evaluate an accumulator, optionally with a combi boost.
 *
 * Legs are treated as independent. Legs from the same match are NOT
 * independent — for those use Sportium's bet builder price directly, which
 * already prices the correlation (in the book's favour).
 */
export function evaluateCombi(
  legOdds: DecimalOdds[],
  legProbabilities: Probability[],
  boostPercent = 0,
  marginPerLeg = SPORTIUM_DEFAULTS.typicalMarginMainMarkets
): CombiResult {
  if (legOdds.length !== legProbabilities.length) {
    throw new RangeError("Cada selección necesita su cuota y su probabilidad.");
  }

  const combinedOdds = parlayOdds(legOdds);
  const boostedOdds = combinedOdds * (1 + boostPercent);
  const combinedProbability = parlayProbability(legProbabilities);
  const ev = expectedValue(combinedProbability, boostedOdds);
  const requiredBoost = requiredCombiBoost(legOdds.length, marginPerLeg);

  const verdict =
    ev > 0
      ? `Combinada con valor: +${(ev * 100).toFixed(2)}% con ${legOdds.length} selecciones.`
      : `Sin valor: ${(ev * 100).toFixed(2)}%. Con ${legOdds.length} selecciones necesitarías un boost del ${(requiredBoost * 100).toFixed(1)}% solo para empatar.`;

  return { combinedOdds, boostedOdds, combinedProbability, expectedValue: ev, requiredBoost, verdict };
}

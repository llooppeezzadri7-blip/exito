import { describe, expect, it } from "vitest";
import {
  evaluateCashOut,
  evaluateCombi,
  evaluateSupercuota,
  freebetRetention,
  freebetValue,
  requiredCombiBoost,
  screenSelection,
  SPORTIUM_DEFAULTS,
  SYSTEM_BAND,
} from "./sportium";

describe("band filter", () => {
  it("rejects prices below the band even when the pick is strong", () => {
    const verdict = screenSelection(0.88, 1.2);
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toMatch(/por debajo/);
  });

  it("rejects prices above the band as a sign the estimate is wrong", () => {
    const verdict = screenSelection(0.8, 1.9);
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toMatch(/por encima/);
  });

  it("rejects an in-band price with no edge", () => {
    // 1.30 needs 76.9%; 75% is not enough.
    const verdict = screenSelection(0.75, 1.3);
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toMatch(/Sin valor/);
    expect(verdict.edge).toBeLessThan(0);
  });

  it("accepts an in-band price with edge", () => {
    const verdict = screenSelection(0.8, 1.32);
    expect(verdict.accepted).toBe(true);
    expect(verdict.edge).toBeCloseTo(0.056, 6);
  });

  it("puts the band floor above the 1.25 break-even for an 80% system", () => {
    expect(SYSTEM_BAND.min).toBeGreaterThan(1 / 0.8);
  });
});

describe("free bets", () => {
  it("is worth more the longer the odds it is cashed at", () => {
    expect(freebetRetention(2, 0)).toBeCloseTo(0.5, 10);
    expect(freebetRetention(5, 0)).toBeCloseTo(0.8, 10);
    expect(freebetRetention(10, 0)).toBeCloseTo(0.9, 10);
  });

  it("is worth less once the market carries margin", () => {
    expect(freebetRetention(5, 0.05)).toBeLessThan(freebetRetention(5, 0));
    expect(freebetRetention(4, 0.05)).toBeCloseTo(0.7143, 4);
  });

  it("justifies the conservative default retention", () => {
    // The default should sit near what a real free bet cashed at odds ~4 gives.
    expect(SPORTIUM_DEFAULTS.freebetRetention).toBeLessThanOrEqual(freebetRetention(4, 0.05));
    expect(freebetValue(51, 4, 0.05)).toBeCloseTo(36.43, 2);
  });

  it("rejects an impossible cash-out price", () => {
    expect(() => freebetRetention(1)).toThrow(RangeError);
  });
});

describe("supercuotas", () => {
  // Sportium's own worked example: 10 EUR at a base 1.90 boosted to 7.00 pays
  // 19 EUR cash and 51 EUR as a free bet, for a 70 EUR headline.
  const input = { stakeEur: 10, boostedOdds: 7, baseOdds: 1.9, probability: 0.2, freebetRetention: 0.75 };

  it("reproduces the advertised split", () => {
    const result = evaluateSupercuota(input);
    expect(result.cashReturnEur).toBeCloseTo(19, 10);
    expect(result.freebetFaceEur).toBeCloseTo(51, 10);
    expect(result.nominalReturnEur).toBeCloseTo(70, 10);
  });

  it("shows the effective price is far below the advertised one", () => {
    const result = evaluateSupercuota(input);
    expect(result.realReturnEur).toBeCloseTo(57.25, 10);
    expect(result.effectiveOdds).toBeCloseTo(5.725, 10);
    expect(result.effectiveOdds).toBeLessThan(input.boostedOdds);
  });

  it("dilutes the boost when you stake past the cap", () => {
    const capped = evaluateSupercuota({ ...input, stakeEur: 50 });
    expect(capped.effectiveOdds).toBeLessThan(evaluateSupercuota(input).effectiveOdds);
    expect(capped.notes.join(" ")).toMatch(/Solo los primeros/);
  });

  it("pays more when the promo is settled in cash instead of free bets", () => {
    const cash = evaluateSupercuota({ ...input, boostPaidAsFreebet: false });
    expect(cash.effectiveOdds).toBeCloseTo(7, 10);
    expect(cash.freebetFaceEur).toBe(0);
  });

  it("still finds value when the true probability beats the effective price", () => {
    // 5.725 effective needs 17.5%; 20% clears it.
    expect(evaluateSupercuota(input).expectedValueEur).toBeGreaterThan(0);
    expect(evaluateSupercuota({ ...input, probability: 0.15 }).expectedValueEur).toBeLessThan(0);
  });

  it("rejects incoherent inputs", () => {
    expect(() => evaluateSupercuota({ ...input, stakeEur: 0 })).toThrow(RangeError);
    expect(() => evaluateSupercuota({ ...input, boostedOdds: 1.5 })).toThrow(RangeError);
  });
});

describe("cash out", () => {
  it("flags the book's cut and says no", () => {
    // 10 EUR at 3.00 with a 60% live chance is worth 18 EUR.
    const result = evaluateCashOut(10, 3, 0.6, 16);
    expect(result.fairValueEur).toBeCloseTo(18, 10);
    expect(result.bookCutPercent).toBeCloseTo(0.1111, 4);
    expect(result.takeIt).toBe(false);
  });

  it("says yes on the rare generous offer", () => {
    const result = evaluateCashOut(10, 3, 0.5, 16);
    expect(result.takeIt).toBe(true);
  });
});

describe("combinadas", () => {
  it("quantifies how much boost a combi needs just to break even", () => {
    expect(requiredCombiBoost(1, 0.05)).toBeCloseTo(0.05, 10);
    expect(requiredCombiBoost(4, 0.05)).toBeCloseTo(0.2155, 4);
    expect(requiredCombiBoost(5, 0.05)).toBeCloseTo(0.2763, 4);
  });

  it("shows a typical 10% combi boost does not cover a 4-leg margin", () => {
    expect(requiredCombiBoost(4, 0.05)).toBeGreaterThan(0.1);
  });

  it("rates three 80% legs priced at 1.20 as a losing bet", () => {
    const result = evaluateCombi([1.2, 1.2, 1.2], [0.8, 0.8, 0.8]);
    expect(result.combinedOdds).toBeCloseTo(1.728, 10);
    expect(result.combinedProbability).toBeCloseTo(0.512, 10);
    expect(result.expectedValue).toBeLessThan(0);
    expect(result.verdict).toMatch(/Sin valor/);
  });

  it("finds value when every leg is priced in the band", () => {
    const result = evaluateCombi([1.32, 1.32], [0.8, 0.8]);
    expect(result.expectedValue).toBeGreaterThan(0);
    expect(result.verdict).toMatch(/con valor/);
  });

  it("applies a boost to the combined price", () => {
    const plain = evaluateCombi([1.3, 1.3, 1.3], [0.8, 0.8, 0.8]);
    const boosted = evaluateCombi([1.3, 1.3, 1.3], [0.8, 0.8, 0.8], 0.2);
    expect(boosted.boostedOdds).toBeCloseTo(plain.combinedOdds * 1.2, 10);
    expect(boosted.expectedValue).toBeGreaterThan(plain.expectedValue);
  });

  it("rejects mismatched inputs", () => {
    expect(() => evaluateCombi([1.3, 1.3], [0.8])).toThrow(RangeError);
    expect(() => requiredCombiBoost(0, 0.05)).toThrow(RangeError);
  });
});

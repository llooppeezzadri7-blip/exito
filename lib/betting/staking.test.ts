import { describe, expect, it } from "vitest";
import {
  closingLineValue,
  drawdownEstimate,
  flatStake,
  fractionalKellyStake,
  summarizeClv,
  trueClosingLineValue,
} from "./staking";

describe("stake sizing", () => {
  it("takes a flat percentage of bankroll", () => {
    expect(flatStake(1000)).toBeCloseTo(10, 10);
    expect(flatStake(1000, 0.02)).toBeCloseTo(20, 10);
  });

  it("stakes nothing when there is no edge", () => {
    expect(fractionalKellyStake(1000, 0.75, 1.3)).toBe(0);
    expect(fractionalKellyStake(1000, 0.5, 2)).toBe(0);
  });

  it("caps fractional Kelly so an estimate error cannot wreck the bankroll", () => {
    // Full Kelly at 80% / 1.30 is 13.3% of bankroll — far too much for an estimate.
    const uncapped = fractionalKellyStake(1000, 0.8, 1.3, 0.25, 1);
    expect(uncapped).toBeCloseTo(33.33, 1);
    expect(fractionalKellyStake(1000, 0.8, 1.3)).toBeCloseTo(20, 6);
  });
});

describe("closing line value", () => {
  it("is positive when you took a better price than the close", () => {
    expect(closingLineValue(1.35, 1.3)).toBeCloseTo(0.0385, 4);
    expect(closingLineValue(1.3, 1.3)).toBeCloseTo(0, 10);
    expect(closingLineValue(1.25, 1.3)).toBeCloseTo(-0.0385, 4);
  });

  it("is stricter once the closing margin is stripped out", () => {
    // Beating a 1.90/1.90 close at 1.95 is still not beating the true market.
    expect(closingLineValue(1.95, 1.9)).toBeGreaterThan(0);
    expect(trueClosingLineValue(1.95, [1.9, 1.9])).toBeCloseTo(-0.025, 6);
    expect(trueClosingLineValue(2.1, [1.9, 1.9])).toBeGreaterThan(0);
  });

  it("rejects impossible prices", () => {
    expect(() => closingLineValue(1, 1.3)).toThrow(RangeError);
    expect(() => trueClosingLineValue(1.5, [1.9, 1.9], 5)).toThrow(RangeError);
  });
});

describe("clv summary", () => {
  it("calls a losing record what it is, however many bets landed", () => {
    const summary = summarizeClv([
      { id: "1", takenOdds: 1.25, closingOdds: 1.3 },
      { id: "2", takenOdds: 1.28, closingOdds: 1.32 },
    ]);
    expect(summary.averageClv).toBeLessThan(0);
    expect(summary.beatCloseRate).toBe(0);
    expect(summary.verdict).toMatch(/suerte/);
  });

  it("confirms a real edge when you consistently beat the close", () => {
    const summary = summarizeClv([
      { id: "1", takenOdds: 1.38, closingOdds: 1.3 },
      { id: "2", takenOdds: 1.4, closingOdds: 1.34 },
    ]);
    expect(summary.averageClv).toBeGreaterThan(0.01);
    expect(summary.beatCloseRate).toBe(1);
    expect(summary.verdict).toMatch(/por delante del mercado/);
  });

  it("handles an empty log", () => {
    expect(summarizeClv([]).verdict).toMatch(/Sin apuestas registradas/);
  });
});

describe("variance", () => {
  it("shows an 80% system still produces long losing runs", () => {
    // Over 500 bets at 80%, a 4-loss run is roughly a coin flip and a 5-loss
    // run still lands about one time in seven. Neither means the system broke.
    expect(drawdownEstimate(0.8, 500, 4).probabilityOfStreak).toBeCloseTo(0.549, 2);
    expect(drawdownEstimate(0.8, 500, 5).probabilityOfStreak).toBeCloseTo(0.147, 2);
    expect(drawdownEstimate(0.8, 500, 5).expectedWorstStreak).toBeCloseTo(3.72, 1);
  });

  it("makes longer runs rarer", () => {
    const five = drawdownEstimate(0.8, 500, 5).probabilityOfStreak;
    const ten = drawdownEstimate(0.8, 500, 10).probabilityOfStreak;
    expect(ten).toBeLessThan(five);
  });
});

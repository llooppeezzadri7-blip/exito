import { describe, expect, it } from "vitest";
import type { OddsQuote, Provenance } from "./providers/types";
import {
  analyseQuotes,
  backtestEstimate,
  combineProvenance,
  confidenceFor,
  devigEstimate,
  estimateKey,
  manualEstimate,
  type ProbabilityEstimate,
} from "./recommendations";

function makeQuote(overrides: Partial<OddsQuote> = {}): OddsQuote {
  return {
    eventId: "e1",
    sport: "Fútbol",
    competition: "LaLiga",
    homeTeam: "Levante",
    awayTeam: "Barcelona",
    commenceTime: "2026-09-13T14:15:00Z",
    marketKey: "over_2.5_cards",
    marketLabel: "Total de tarjetas",
    selection: "Más de 2,5",
    odds: 1.35,
    bookmaker: "Sportium",
    fetchedAt: "2026-09-13T10:00:00Z",
    provenance: "real",
    ...overrides,
  };
}

function estimatesFor(quote: OddsQuote, estimate: ProbabilityEstimate) {
  return new Map([[estimateKey(quote), estimate]]);
}

const OPTIONS = { bankrollEur: 100, source: "Test" };

describe("provenance is the weakest link", () => {
  it("collapses to demo whenever anything is demo", () => {
    expect(combineProvenance("real", "real")).toBe("real");
    expect(combineProvenance("real", "backtest")).toBe("backtest");
    expect(combineProvenance("real", "demo")).toBe("demo");
    expect(combineProvenance("backtest", "demo")).toBe("demo");
  });

  it("treats an empty set as real rather than inventing a worse label", () => {
    expect(combineProvenance()).toBe("real");
  });
});

describe("the system never invents a probability", () => {
  it("reports a quote with no estimate instead of scoring it", () => {
    const quote = makeQuote();
    const result = analyseQuotes([quote], new Map(), OPTIONS);

    expect(result.recommendations).toHaveLength(0);
    expect(result.unanalysed).toHaveLength(1);
    expect(result.unanalysed[0].reason).toMatch(/no inventa/i);
  });

  it("never silently drops a quote it cannot analyse", () => {
    const quotes = [makeQuote(), makeQuote({ selection: "Menos de 2,5", odds: 3.2 })];
    const result = analyseQuotes(quotes, estimatesFor(quotes[0], manualEstimate(0.8)), OPTIONS);

    expect(result.recommendations).toHaveLength(1);
    expect(result.unanalysed).toHaveLength(1);
    expect(result.recommendations.length + result.unanalysed.length).toBe(quotes.length);
  });
});

describe("demo data can never be bet on", () => {
  it("marks a demo quote as not bettable even with a strong edge", () => {
    const quote = makeQuote({ provenance: "demo" });
    const result = analyseQuotes([quote], estimatesFor(quote, manualEstimate(0.9)), OPTIONS);

    const [rec] = result.recommendations;
    expect(rec.edge).toBeGreaterThan(0);
    expect(rec.accepted).toBe(true);
    expect(rec.overallProvenance).toBe("demo");
    expect(rec.bettable).toBe(false);
  });

  it("marks a real quote with a demo probability as not bettable", () => {
    const quote = makeQuote();
    const demoProbability: ProbabilityEstimate = { value: 0.9, source: "demo", basis: "inventada" };
    const [rec] = analyseQuotes([quote], estimatesFor(quote, demoProbability), OPTIONS).recommendations;

    expect(rec.oddsProvenance).toBe("real");
    expect(rec.overallProvenance).toBe("demo");
    expect(rec.bettable).toBe(false);
  });

  it("only calls a bet bettable when the whole chain is real and it has value", () => {
    const quote = makeQuote();
    const [rec] = analyseQuotes([quote], estimatesFor(quote, devigEstimate(0.8, "Pinnacle")), OPTIONS)
      .recommendations;

    expect(rec.overallProvenance).toBe("real");
    expect(rec.bettable).toBe(true);
  });

  it("refuses to call a backtest probability bettable on its own", () => {
    const quote = makeQuote();
    const estimate = backtestEstimate(0.85, 500, 0.82, "Base rate histórica");
    const [rec] = analyseQuotes([quote], estimatesFor(quote, estimate), OPTIONS).recommendations;

    expect(rec.overallProvenance).toBe("backtest");
    expect(rec.bettable).toBe(false);
    expect(rec.confidence).toBe("alta");
  });
});

describe("the band still applies", () => {
  it("rejects a price below the band and stakes nothing on it", () => {
    const quote = makeQuote({ odds: 1.2 });
    const [rec] = analyseQuotes([quote], estimatesFor(quote, manualEstimate(0.9)), OPTIONS).recommendations;

    expect(rec.accepted).toBe(false);
    expect(rec.bettable).toBe(false);
    expect(rec.stakeEur).toBe(0);
    expect(rec.verdict).toMatch(/por debajo/);
  });

  it("can be disabled to inspect everything", () => {
    const quote = makeQuote({ odds: 1.2 });
    const [rec] = analyseQuotes([quote], estimatesFor(quote, manualEstimate(0.9)), {
      ...OPTIONS,
      band: null,
    }).recommendations;

    expect(rec.accepted).toBe(true);
  });
});

describe("confidence", () => {
  const odds = 1.35; // break-even 74.1%

  it("is high only for a large backtest whose lower bound clears break-even", () => {
    expect(confidenceFor(backtestEstimate(0.85, 500, 0.82, ""), odds)).toBe("alta");
    expect(confidenceFor(backtestEstimate(0.85, 500, 0.7, ""), odds)).toBe("media");
    expect(confidenceFor(backtestEstimate(0.85, 150, 0.82, ""), odds)).toBe("media");
    expect(confidenceFor(backtestEstimate(0.85, 40, 0.82, ""), odds)).toBe("baja");
  });

  it("caps a hand-typed estimate at low however sure it looks", () => {
    expect(confidenceFor(manualEstimate(0.99), odds)).toBe("baja");
  });

  it("gives demo no confidence at all", () => {
    expect(confidenceFor({ value: 0.99, source: "demo", basis: "" }, odds)).toBe("ninguna");
  });

  it("treats a de-vigged market as medium", () => {
    expect(confidenceFor(devigEstimate(0.8, "Pinnacle"), odds)).toBe("media");
  });
});

describe("ordering and totals", () => {
  it("ranks by expected value, not by hit rate", () => {
    const safe = makeQuote({ selection: "Segura", odds: 1.3 });
    const juicy = makeQuote({ selection: "Jugosa", odds: 1.44 });
    const estimates = new Map([
      [estimateKey(safe), devigEstimate(0.8, "Pinnacle")], // valor 4.0%
      [estimateKey(juicy), devigEstimate(0.75, "Pinnacle")], // valor 8.0%
    ]);

    const { recommendations } = analyseQuotes([safe, juicy], estimates, OPTIONS);
    expect(recommendations.map((r) => r.selection)).toEqual(["Jugosa", "Segura"]);
    expect(recommendations[0].estimatedProbability).toBeLessThan(recommendations[1].estimatedProbability);
  });

  it("counts only bettable rows and exposes every promised field", () => {
    const real = makeQuote();
    const demo = makeQuote({ eventId: "e2", provenance: "demo" });
    const estimates = new Map([
      [estimateKey(real), devigEstimate(0.8, "Pinnacle")],
      [estimateKey(demo), devigEstimate(0.8, "Pinnacle")],
    ]);

    const result = analyseQuotes([real, demo], estimates, OPTIONS);
    expect(result.recommendations).toHaveLength(2);
    expect(result.bettableCount).toBe(1);
    expect(result.overallProvenance).toBe("demo");

    const [rec] = result.recommendations;
    for (const field of [
      "event", "sport", "commenceTime", "market", "selection", "odds",
      "impliedProbability", "estimatedProbability", "edge", "stakeEur",
      "confidence", "verdict", "fetchedAt", "bookmaker", "source",
    ] as const) {
      expect(rec[field], `falta el campo ${field}`).toBeDefined();
    }
  });

  it("sizes the stake off the bankroll and caps it", () => {
    const quote = makeQuote();
    const [rec] = analyseQuotes([quote], estimatesFor(quote, devigEstimate(0.85, "Pinnacle")), {
      ...OPTIONS,
      bankrollEur: 100,
    }).recommendations;

    expect(rec.stakeEur).toBeLessThanOrEqual(2);
    expect(rec.stakePercentOfBankroll).toBeLessThanOrEqual(0.02);
  });
});

describe("provenance labels are exhaustive", () => {
  it("covers every variant", () => {
    const all: Provenance[] = ["real", "backtest", "demo"];
    for (const provenance of all) {
      expect(combineProvenance(provenance)).toBeDefined();
    }
  });
});

import { describe, it, expect } from "vitest";
import { assessPhase } from "../../src/risk/phase.js";
import { cfg } from "../fixtures/factory.js";

describe("NO FOMO phase classifier", () => {
  it("EARLY with moderate move and growing participation", () => {
    expect(assessPhase({ price_change_h1: 25, holders_growth_15m: 20, volume_growth_1h: 50 }, cfg.no_fomo, false).phase).toBe("EARLY");
  });
  it("LATE after +150%/1h even if price still rises", () => {
    const p = assessPhase({ price_change_h1: 180, holders_growth_15m: 10 }, cfg.no_fomo, false);
    expect(p.phase).toBe("LATE");
    expect(p.reasons[0]).toMatch(/already \+180%/);
  });
  it("LATE when price rises without new holders", () => {
    const p = assessPhase({ price_change_h1: 60, holders_growth_15m: 0, liquidity_growth_1h: -2 }, cfg.no_fomo, false);
    expect(p.phase).toBe("LATE");
  });
  it("EXHAUSTED when insiders sell and volume collapses", () => {
    const p = assessPhase({ price_change_h1: 10, volume_growth_1h: -70 }, cfg.no_fomo, true);
    expect(p.phase).toBe("EXHAUSTED");
  });
  it("UNKNOWN with no data", () => {
    expect(assessPhase({}, cfg.no_fomo, false).phase).toBe("UNKNOWN");
  });
});

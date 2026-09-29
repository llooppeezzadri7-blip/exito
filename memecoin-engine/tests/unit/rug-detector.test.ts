import { describe, it, expect } from "vitest";
import { assessRugRisk } from "../../src/risk/rug-detector.js";
import type { AnalyzerResult } from "../../src/core/types.js";

const r = (analyzer: string, score: number | null, flags: AnalyzerResult["flags"]): AnalyzerResult => ({ analyzer, score, confidence: "HIGH", flags, evidence: [], metrics: {}, computedAt: "" });

describe("rug detector", () => {
  it("never labels anything SAFE — best label is RELATIVELY_LOW_RISK", () => {
    const a = assessRugRisk([r("security", 100, []), r("holders", 90, [])], { extreme: 80 });
    expect(a.level).toBe("RELATIVELY_LOW_RISK");
    expect(a.rugRisk).toBe(0);
  });
  it("counts the same flag code only once across analyzers (no duplicated signals)", () => {
    const a = assessRugRisk([r("holders", 50, [{ code: "SUPPLY_CONCENTRATION", severity: "HIGH", message: "" }]), r("wallet-cluster", 50, [{ code: "SUPPLY_CONCENTRATION", severity: "MEDIUM", message: "" }])], { extreme: 80 });
    expect(a.contributions).toHaveLength(1);
    expect(a.contributions[0]!.points).toBeCloseTo(14 * 1.4, 1);
  });
  it("mint + freeze authority alone push into EXTREME_RISK", () => {
    const a = assessRugRisk([r("security", 15, [{ code: "MINT_AUTHORITY_ACTIVE", severity: "CRITICAL", message: "" }, { code: "FREEZE_AUTHORITY_ACTIVE", severity: "CRITICAL", message: "" }])], { extreme: 80 });
    expect(a.level).toBe("EXTREME_RISK");
    expect(a.rugRisk).toBe(100);
  });
  it("UNKNOWN when nothing could be analyzed", () => {
    const a = assessRugRisk([r("security", null, [{ code: "UNKNOWN_CONFIGURATION", severity: "HIGH", message: "" }])], { extreme: 80 });
    expect(a.level).toBe("UNKNOWN");
    expect(a.rugRisk).toBeNull();
  });
  it("unknown security with other risk flags stays UNKNOWN (not falsely low)", () => {
    const a = assessRugRisk([r("security", null, [{ code: "UNKNOWN_CONFIGURATION", severity: "HIGH", message: "" }]), r("holders", 40, [{ code: "SUPPLY_CONCENTRATION", severity: "MEDIUM", message: "" }])], { extreme: 80 });
    expect(a.unknownSecurity).toBe(true);
    expect(["UNKNOWN", "EXTREME_RISK"]).toContain(a.level);
  });
});

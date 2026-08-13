import { describe, expect, it } from "vitest";
import {
  InvalidWeightsError,
  LEAD_SCORE_WEIGHT_KEYS,
  OPPORTUNITY_WEIGHT_KEYS,
  normalizeGroup,
  parseScoringWeightsForm,
} from "./weights";

function formOf(opportunity: Record<string, number>, leadScore: Record<string, number>): FormData {
  const formData = new FormData();
  for (const key of OPPORTUNITY_WEIGHT_KEYS) {
    formData.set(`opportunity.${key}`, String(opportunity[key] ?? 0));
  }
  for (const key of LEAD_SCORE_WEIGHT_KEYS) {
    formData.set(`lead_score.${key}`, String(leadScore[key] ?? 0));
  }
  return formData;
}

const EVEN_OPPORTUNITY = Object.fromEntries(OPPORTUNITY_WEIGHT_KEYS.map((k) => [k, 10]));
const EVEN_LEAD_SCORE = Object.fromEntries(LEAD_SCORE_WEIGHT_KEYS.map((k) => [k, 25]));

function total(group: Record<string, number>): number {
  return Object.values(group).reduce((sum, value) => sum + value, 0);
}

describe("normalizeGroup", () => {
  it("scales a group that doesn't add up to 1", () => {
    const result = normalizeGroup({ a: 2, b: 2 });
    expect(result).toEqual({ a: 0.5, b: 0.5 });
  });

  it("sums to 1 (within float precision) even when the split doesn't divide evenly", () => {
    const result = normalizeGroup({ a: 1, b: 1, c: 1 });
    expect(total(result)).toBeCloseTo(1, 9);
  });

  it("preserves proportions", () => {
    const result = normalizeGroup({ a: 30, b: 10 });
    expect(result.a / result.b).toBeCloseTo(3, 5);
  });

  it("rejects an all-zero group instead of dividing by zero", () => {
    expect(() => normalizeGroup({ a: 0, b: 0 })).toThrow(InvalidWeightsError);
  });
});

describe("parseScoringWeightsForm", () => {
  it("reads percentages into fractions that sum to 1 per group", () => {
    const weights = parseScoringWeightsForm(formOf(EVEN_OPPORTUNITY, EVEN_LEAD_SCORE));

    expect(total(weights.opportunity)).toBeCloseTo(1, 9);
    expect(total(weights.lead_score)).toBeCloseTo(1, 9);
    expect(weights.lead_score.opportunity).toBe(0.25);
  });

  it("normalizes percentages that don't add up to 100", () => {
    const weights = parseScoringWeightsForm(
      formOf({ ...EVEN_OPPORTUNITY, seo: 40 }, EVEN_LEAD_SCORE)
    );

    expect(total(weights.opportunity)).toBeCloseTo(1, 9);
    // seo was 40 of a 100-point total (10*6 + 40) -> 0.4
    expect(weights.opportunity.seo).toBeCloseTo(0.4, 3);
  });

  it("accepts a comma as the decimal separator", () => {
    const formData = formOf(EVEN_OPPORTUNITY, EVEN_LEAD_SCORE);
    formData.set("opportunity.seo", "12,5");
    const weights = parseScoringWeightsForm(formData);

    expect(total(weights.opportunity)).toBeCloseTo(1, 9);
    expect(weights.opportunity.seo).toBeGreaterThan(weights.opportunity.performance);
  });

  it("rejects out-of-range percentages", () => {
    expect(() => parseScoringWeightsForm(formOf({ ...EVEN_OPPORTUNITY, seo: 140 }, EVEN_LEAD_SCORE))).toThrow(
      InvalidWeightsError
    );
    expect(() => parseScoringWeightsForm(formOf({ ...EVEN_OPPORTUNITY, seo: -5 }, EVEN_LEAD_SCORE))).toThrow(
      InvalidWeightsError
    );
  });

  it("rejects non-numeric and missing fields", () => {
    const formData = formOf(EVEN_OPPORTUNITY, EVEN_LEAD_SCORE);
    formData.set("opportunity.seo", "mucho");
    expect(() => parseScoringWeightsForm(formData)).toThrow(InvalidWeightsError);

    const incomplete = formOf(EVEN_OPPORTUNITY, EVEN_LEAD_SCORE);
    incomplete.delete("lead_score.business_value");
    expect(() => parseScoringWeightsForm(incomplete)).toThrow(InvalidWeightsError);
  });

  it("rejects a group where every weight is zero", () => {
    const allZeroLeadScore = Object.fromEntries(LEAD_SCORE_WEIGHT_KEYS.map((k) => [k, 0]));
    expect(() => parseScoringWeightsForm(formOf(EVEN_OPPORTUNITY, allZeroLeadScore))).toThrow(
      InvalidWeightsError
    );
  });
});

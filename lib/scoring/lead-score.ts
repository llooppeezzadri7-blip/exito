import type { LeadScoreResult, ScoringInput } from "./types";

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

/** Proxy for "how valuable is this client likely to be", from review volume + rating. */
export function computeBusinessValueScore(input: ScoringInput): number {
  const { business } = input;
  const reviewComponent = clamp(((business.review_count ?? 0) / 500) * 70);
  const ratingComponent = business.rating !== null ? (business.rating / 5) * 30 : 0;
  return Math.round(clamp(reviewComponent + ratingComponent));
}

export function computeLeadScore(
  input: ScoringInput,
  opportunityScore: number,
  buyingIntentScore: number,
  competitiveGapScore: number
): LeadScoreResult {
  const businessValueScore = computeBusinessValueScore(input);
  const w = input.weights.lead_score;

  const breakdown = {
    opportunity: opportunityScore,
    buying_intent: buyingIntentScore,
    business_value: businessValueScore,
    competitive_gap: competitiveGapScore,
  };

  const score = clamp(
    w.opportunity * opportunityScore +
      w.buying_intent * buyingIntentScore +
      w.business_value * businessValueScore +
      w.competitive_gap * competitiveGapScore
  );

  return { score: Math.round(score), breakdown };
}

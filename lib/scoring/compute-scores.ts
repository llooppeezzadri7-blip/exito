import type { ScoringInput } from "./types";
import { computeOpportunityScore } from "./opportunity-score";
import { computeBuyingIntentScore } from "./buying-intent-score";
import { computeLeadScore } from "./lead-score";
import type { Score } from "@/lib/database/types";

export function computeScores(input: ScoringInput): Omit<Score, "id" | "business_id" | "computed_at"> {
  const opportunity = computeOpportunityScore(input);
  const buyingIntent = computeBuyingIntentScore(input);
  const leadScore = computeLeadScore(
    input,
    opportunity.score,
    buyingIntent.score,
    opportunity.breakdown.competitive_gap.value
  );

  const opportunityBreakdown = Object.fromEntries(
    Object.entries(opportunity.breakdown).map(([key, sub]) => [key, sub.value])
  ) as Record<string, number>;

  const buyingIntentBreakdown = Object.fromEntries(
    buyingIntent.signals.filter((s) => s.triggered).map((s) => [s.label, s.weight])
  );

  return {
    opportunity_score: opportunity.score,
    opportunity_breakdown: opportunityBreakdown,
    buying_intent_score: buyingIntent.score,
    buying_intent_breakdown: buyingIntentBreakdown,
    lead_score: leadScore.score,
    lead_score_breakdown: leadScore.breakdown,
    weights_snapshot: input.weights,
  };
}

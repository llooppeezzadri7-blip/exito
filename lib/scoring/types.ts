import type { Business, WebsiteScan } from "@/lib/database/types";
import type { Settings } from "@/lib/database/types";

export interface ScoringInput {
  business: Business;
  scan: WebsiteScan | null;
  weights: Settings["scoring_weights"];
}

export interface SubScore {
  /** 0-100. Higher = more opportunity / more likely to buy, depending on the score. */
  value: number;
  /** Why this number, in terms a salesperson can repeat to the prospect. */
  reasons: string[];
  /** true when this sub-score is a rough proxy because the real signal isn't available yet. */
  limitedSignal: boolean;
}

export type OpportunityBreakdown = Record<
  "website_quality" | "seo" | "local_seo" | "performance" | "mobile_ux" | "conversion" | "competitive_gap",
  SubScore
>;

export interface OpportunityResult {
  score: number;
  breakdown: OpportunityBreakdown;
}

export interface BuyingIntentResult {
  score: number;
  signals: { label: string; weight: number; triggered: boolean }[];
}

export interface LeadScoreResult {
  score: number;
  breakdown: Record<"opportunity" | "buying_intent" | "business_value" | "competitive_gap", number>;
}

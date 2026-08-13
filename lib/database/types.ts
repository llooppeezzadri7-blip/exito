// Hand-written types mirroring supabase/migrations/0001_init.sql.
// (No live Supabase project is connected in this environment, so these can't
// be generated via `supabase gen types` yet — regenerate once a project exists:
// npx supabase gen types typescript --project-id <id> > lib/database/types.generated.ts)

export type JobType =
  | "discovery"
  | "website_scan"
  | "seo_analysis"
  | "local_analysis"
  | "competitor_analysis"
  | "ai_audit"
  | "proposal_generation"
  | "demo_generation";

export type JobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type LeadStage =
  | "NEW"
  | "ANALYZING"
  | "QUALIFIED"
  | "AUDIT_READY"
  | "DEMO_READY"
  | "CONTACTED"
  | "REPLIED"
  | "MEETING"
  | "PROPOSAL"
  | "NEGOTIATION"
  | "WON"
  | "LOST";

export type BusinessSource = "csv_import" | "google_places" | "manual";

export interface Business {
  id: string;
  owner_id: string;
  name: string;
  category: string | null;
  sector: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  phone: string | null;
  website_url: string | null;
  email: string | null;
  social_links: Record<string, string>;
  gbp_place_id: string | null;
  rating: number | null;
  review_count: number | null;
  opening_hours: unknown | null;
  latitude: number | null;
  longitude: number | null;
  source: BusinessSource;
  source_job_id: string | null;
  last_analyzed_at: string | null;
  created_at: string;
  updated_at: string;
}

// A type alias rather than an interface on purpose: object type aliases get an
// implicit index signature, so a breakdown can be passed to the generic
// Record<string, number> helpers in lib/scoring/weights.ts.
export type ScoreBreakdown = {
  website_quality: number;
  seo: number;
  local_seo: number;
  performance: number;
  mobile_ux: number;
  conversion: number;
  competitive_gap: number;
};

export interface Score {
  id: string;
  business_id: string;
  opportunity_score: number;
  opportunity_breakdown: Partial<ScoreBreakdown>;
  buying_intent_score: number;
  buying_intent_breakdown: Record<string, number>;
  lead_score: number;
  lead_score_breakdown: Record<string, number>;
  weights_snapshot: Record<string, unknown>;
  computed_at: string;
}

export interface Job {
  id: string;
  owner_id: string;
  type: JobType;
  status: JobStatus;
  params: Record<string, unknown>;
  progress_current: number;
  progress_total: number;
  result: Record<string, unknown> | null;
  error: { message: string; service?: string; url?: string; retries?: number } | null;
  retry_count: number;
  max_retries: number;
  business_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface Lead {
  id: string;
  business_id: string;
  owner_id: string;
  stage: LeadStage;
  value_estimate: number | null;
  value_won: number | null;
  next_action: string | null;
  next_action_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Proposal {
  id: string;
  business_id: string;
  owner_id: string;
  title: string;
  services: string[];
  price_total: number | null;
  currency: string;
  timeline: string | null;
  maintenance_terms: string | null;
  next_steps: string | null;
  content: string | null;
  status: "draft" | "sent" | "accepted" | "rejected";
  created_at: string;
}

export interface Demo {
  id: string;
  business_id: string;
  owner_id: string;
  status: "draft" | "ready" | "published";
  content: Record<string, unknown>;
  webflow_site_id: string | null;
  published_url: string | null;
  created_at: string;
}

export interface Settings {
  id: string;
  owner_id: string;
  agency_name: string;
  agency_identity: Record<string, unknown>;
  sectors: string[];
  countries: string[];
  cities: string[];
  services: string[];
  pricing: Record<string, unknown>;
  scoring_weights: {
    opportunity: ScoreBreakdown;
    lead_score: { opportunity: number; buying_intent: number; business_value: number; competitive_gap: number };
  };
  ai_model: string;
  created_at: string;
  updated_at: string;
}

export interface ApiUsage {
  id: string;
  owner_id: string;
  service: "anthropic" | "google_places" | "google_pagespeed" | "webflow";
  operation: string;
  business_id: string | null;
  job_id: string | null;
  units: number;
  estimated_cost_usd: number;
  created_at: string;
}

export interface WebsiteScan {
  id: string;
  website_id: string | null;
  business_id: string;
  status: "completed" | "partial" | "failed";
  source: string;
  technical: Record<string, unknown>;
  seo: Record<string, unknown>;
  conversion: Record<string, unknown>;
  design: Record<string, unknown>;
  performance: Record<string, unknown>;
  unavailable_metrics: string[];
  scanned_at: string;
}

export type LeadActivityType = "stage_change" | "note" | "call" | "email" | "meeting" | "whatsapp";

export interface LeadActivity {
  id: string;
  lead_id: string;
  type: LeadActivityType;
  description: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AiReport {
  id: string;
  business_id: string;
  kind: "audit";
  summary: string;
  problems: string[];
  opportunities: string[];
  commercial_impact: string;
  recommendations: string[];
  priorities: string[];
  model: string;
  generated_at: string;
}

export interface DashboardKpis {
  businesses_found: number;
  businesses_analyzed: number;
  new_opportunities: number;
  hot_leads: number;
  audits_generated: number;
  demos_generated: number;
  proposals_sent: number;
  clients_won: number;
  potential_value_eur: number;
  won_value_eur: number;
  conversion_rate: number;
}

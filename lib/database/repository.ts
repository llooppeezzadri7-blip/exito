import type { AiReport, ApiUsage, Business, DashboardKpis, Demo, Job, JobType, Lead, LeadActivity, LeadActivityType, LeadStage, Proposal, Score, Settings, WebsiteScan } from "./types";
import type { RawBusinessRecord } from "@/lib/integrations/business-sources/types";

export interface BusinessWithScore extends Business {
  score: Score | null;
}

export interface BusinessListFilters {
  sector?: string;
  city?: string;
  minLeadScore?: number;
  search?: string;
}

/**
 * Every data-access path the UI needs goes through this interface, so the
 * dashboard/prospects/pipeline pages work identically whether they're backed
 * by the mock provider (no Supabase configured) or the real Supabase-backed
 * one. See ARCHITECTURE.md §6.
 */
export interface AgencyRepository {
  getDashboardKpis(): Promise<DashboardKpis>;
  listBusinesses(filters?: BusinessListFilters): Promise<BusinessWithScore[]>;
  getBusiness(id: string): Promise<BusinessWithScore | null>;
  listRecentJobs(limit?: number): Promise<Job[]>;
  listLeadsByStage(): Promise<Record<LeadStage, Lead[]>>;
  getSettings(): Promise<Settings>;
  updateSettings(
    patch: Partial<Pick<Settings, "agency_name" | "sectors" | "countries" | "cities" | "services" | "pricing" | "scoring_weights">>
  ): Promise<Settings>;

  createJob(input: { type: JobType; params: Record<string, unknown>; progressTotal?: number }): Promise<Job>;
  updateJob(id: string, patch: Partial<Pick<Job, "status" | "progress_current" | "progress_total" | "result" | "error" | "started_at" | "finished_at" | "retry_count">>): Promise<Job>;

  /** Inserts new businesses, skipping ones that already exist (matched by gbp_place_id when present). */
  importBusinesses(
    records: RawBusinessRecord[],
    jobId: string | null
  ): Promise<{ inserted: Business[]; duplicates: number }>;

  saveWebsiteScan(scan: Omit<WebsiteScan, "id" | "scanned_at">): Promise<WebsiteScan>;
  getLatestWebsiteScan(businessId: string): Promise<WebsiteScan | null>;

  saveScore(businessId: string, score: Omit<Score, "id" | "business_id" | "computed_at">): Promise<Score>;

  saveAiReport(businessId: string, report: Omit<AiReport, "id" | "business_id" | "generated_at">): Promise<AiReport>;
  getLatestAiReport(businessId: string): Promise<AiReport | null>;

  getLeadForBusiness(businessId: string): Promise<Lead | null>;
  createLead(businessId: string, valueEstimate?: number | null): Promise<Lead>;
  updateLead(
    leadId: string,
    patch: Partial<Pick<Lead, "stage" | "next_action" | "next_action_date" | "notes" | "value_estimate" | "value_won">>
  ): Promise<Lead>;
  addLeadActivity(
    leadId: string,
    activity: { type: LeadActivityType; description: string; metadata?: Record<string, unknown> }
  ): Promise<LeadActivity>;
  listLeadActivities(leadId: string): Promise<LeadActivity[]>;

  saveProposal(proposal: Omit<Proposal, "id" | "created_at">): Promise<Proposal>;
  getLatestProposalForBusiness(businessId: string): Promise<Proposal | null>;
  listProposals(): Promise<Proposal[]>;

  saveDemo(demo: Omit<Demo, "id" | "created_at">): Promise<Demo>;
  getLatestDemoForBusiness(businessId: string): Promise<Demo | null>;
  listDemos(): Promise<Demo[]>;

  addApiUsage(entry: Omit<ApiUsage, "id" | "owner_id" | "created_at">): Promise<ApiUsage>;
  listApiUsage(): Promise<ApiUsage[]>;
}

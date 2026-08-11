import type { Business, DashboardKpis, Job, Lead, LeadStage, Score, Settings } from "./types";

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
}

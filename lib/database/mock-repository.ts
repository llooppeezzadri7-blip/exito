import type { AgencyRepository, BusinessListFilters, BusinessWithScore } from "./repository";
import {
  MOCK_BUSINESSES,
  MOCK_JOBS,
  MOCK_LEADS,
  MOCK_SCORES,
  MOCK_SETTINGS,
  computeMockKpis,
} from "./mock-data";
import type { DashboardKpis, Job, Lead, LeadStage, Settings } from "./types";

const LEAD_STAGES: LeadStage[] = [
  "NEW",
  "ANALYZING",
  "QUALIFIED",
  "AUDIT_READY",
  "DEMO_READY",
  "CONTACTED",
  "REPLIED",
  "MEETING",
  "PROPOSAL",
  "NEGOTIATION",
  "WON",
  "LOST",
];

function withScore(businessId: string): BusinessWithScore {
  const business = MOCK_BUSINESSES.find((b) => b.id === businessId)!;
  const score = MOCK_SCORES.find((s) => s.business_id === businessId) ?? null;
  return { ...business, score };
}

export class MockAgencyRepository implements AgencyRepository {
  async getDashboardKpis(): Promise<DashboardKpis> {
    return computeMockKpis();
  }

  async listBusinesses(filters?: BusinessListFilters): Promise<BusinessWithScore[]> {
    let items = MOCK_BUSINESSES.map((b) => withScore(b.id));

    if (filters?.sector) items = items.filter((b) => b.sector === filters.sector);
    if (filters?.city) items = items.filter((b) => b.city === filters.city);
    if (filters?.minLeadScore !== undefined) {
      items = items.filter((b) => (b.score?.lead_score ?? 0) >= filters.minLeadScore!);
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      items = items.filter((b) => b.name.toLowerCase().includes(q));
    }

    return items.sort((a, b) => (b.score?.lead_score ?? 0) - (a.score?.lead_score ?? 0));
  }

  async getBusiness(id: string): Promise<BusinessWithScore | null> {
    const business = MOCK_BUSINESSES.find((b) => b.id === id);
    return business ? withScore(id) : null;
  }

  async listRecentJobs(limit = 10): Promise<Job[]> {
    return [...MOCK_JOBS]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  async listLeadsByStage(): Promise<Record<LeadStage, Lead[]>> {
    const result = Object.fromEntries(LEAD_STAGES.map((s) => [s, [] as Lead[]])) as Record<
      LeadStage,
      Lead[]
    >;
    for (const l of MOCK_LEADS) result[l.stage].push(l);
    return result;
  }

  async getSettings(): Promise<Settings> {
    return MOCK_SETTINGS;
  }
}

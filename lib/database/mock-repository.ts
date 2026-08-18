import type { AgencyRepository, BusinessListFilters, BusinessWithScore } from "./repository";
import { computeMockKpis } from "./mock-data";
import { mockStore } from "./mock-store";
import type { AiReport, ApiUsage, Business, DashboardKpis, Demo, Job, JobType, Lead, LeadActivity, LeadActivityType, LeadStage, Proposal, Score, Settings, WebsiteScan } from "./types";
import type { RawBusinessRecord } from "@/lib/integrations/business-sources/types";

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
  "NOT_INTERESTED",
];

function withScore(businessId: string): BusinessWithScore {
  const business = mockStore.businesses.find((b) => b.id === businessId)!;
  const scores = mockStore.scores.filter((s) => s.business_id === businessId);
  const score =
    scores.length > 0
      ? scores.reduce((latest, s) => (new Date(s.computed_at) > new Date(latest.computed_at) ? s : latest))
      : null;
  return { ...business, score };
}

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-mock-${Date.now()}-${idCounter}`;
}

export class MockAgencyRepository implements AgencyRepository {
  async getDashboardKpis(): Promise<DashboardKpis> {
    return computeMockKpis();
  }

  async listBusinesses(filters?: BusinessListFilters): Promise<BusinessWithScore[]> {
    let items = mockStore.businesses.map((b) => withScore(b.id));

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
    const business = mockStore.businesses.find((b) => b.id === id);
    return business ? withScore(id) : null;
  }

  async listRecentJobs(limit = 10): Promise<Job[]> {
    return [...mockStore.jobs]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  async listLeadsByStage(): Promise<Record<LeadStage, Lead[]>> {
    const result = Object.fromEntries(LEAD_STAGES.map((s) => [s, [] as Lead[]])) as Record<
      LeadStage,
      Lead[]
    >;
    for (const l of mockStore.leads) result[l.stage].push(l);
    return result;
  }

  async getSettings(): Promise<Settings> {
    return mockStore.settings;
  }

  async updateSettings(
    patch: Partial<Pick<Settings, "agency_name" | "sectors" | "countries" | "cities" | "services" | "pricing" | "scoring_weights">>
  ): Promise<Settings> {
    // Process-local only: survives navigation during a dev session, resets on
    // restart. The settings page tells the user as much in mock mode.
    mockStore.settings = { ...mockStore.settings, ...patch, updated_at: new Date().toISOString() };
    return mockStore.settings;
  }

  async createJob(input: { type: JobType; params: Record<string, unknown>; progressTotal?: number }): Promise<Job> {
    const job: Job = {
      id: nextId("job"),
      owner_id: "demo-owner",
      type: input.type,
      status: "QUEUED",
      params: input.params,
      progress_current: 0,
      progress_total: input.progressTotal ?? 0,
      result: null,
      error: null,
      retry_count: 0,
      max_retries: 3,
      business_id: null,
      created_at: new Date().toISOString(),
      started_at: null,
      finished_at: null,
    };
    mockStore.jobs.unshift(job);
    return job;
  }

  async updateJob(id: string, patch: Partial<Job>): Promise<Job> {
    const job = mockStore.jobs.find((j) => j.id === id);
    if (!job) throw new Error(`Job ${id} not found`);
    Object.assign(job, patch);
    return job;
  }

  async importBusinesses(
    records: RawBusinessRecord[],
    jobId: string | null
  ): Promise<{ inserted: Business[]; duplicates: number }> {
    const inserted: Business[] = [];
    let duplicates = 0;

    for (const record of records) {
      const isDuplicate = mockStore.businesses.some(
        (b) =>
          (record.gbp_place_id && b.gbp_place_id === record.gbp_place_id) ||
          (b.name.toLowerCase() === record.name.toLowerCase() && b.address === (record.address ?? null))
      );
      if (isDuplicate) {
        duplicates += 1;
        continue;
      }

      const now = new Date().toISOString();
      const business: Business = {
        id: nextId("biz"),
        owner_id: "demo-owner",
        name: record.name,
        category: record.category ?? null,
        sector: record.sector ?? null,
        address: record.address ?? null,
        city: record.city ?? null,
        region: record.region ?? null,
        postal_code: record.postal_code ?? null,
        country: record.country ?? null,
        phone: record.phone ?? null,
        website_url: record.website_url ?? null,
        email: record.email ?? null,
        social_links: {},
        gbp_place_id: record.gbp_place_id ?? null,
        rating: record.rating ?? null,
        review_count: record.review_count ?? null,
        opening_hours: null,
        latitude: record.latitude ?? null,
        longitude: record.longitude ?? null,
        source: record.source,
        corroborating_sources: [record.source],
        verification_status: "PROBABLE" as const,
        source_job_id: jobId,
        last_analyzed_at: null,
        created_at: now,
        updated_at: now,
      };
      mockStore.businesses.push(business);
      inserted.push(business);
    }

    return { inserted, duplicates };
  }

  async saveWebsiteScan(scan: Omit<WebsiteScan, "id" | "scanned_at">): Promise<WebsiteScan> {
    const saved: WebsiteScan = { ...scan, id: nextId("scan"), scanned_at: new Date().toISOString() };
    mockStore.websiteScans.unshift(saved);

    const business = mockStore.businesses.find((b) => b.id === scan.business_id);
    if (business) business.last_analyzed_at = saved.scanned_at;

    return saved;
  }

  async getLatestWebsiteScan(businessId: string): Promise<WebsiteScan | null> {
    return mockStore.websiteScans.find((s) => s.business_id === businessId) ?? null;
  }

  async saveScore(businessId: string, score: Omit<Score, "id" | "business_id" | "computed_at">): Promise<Score> {
    const saved: Score = { ...score, id: nextId("score"), business_id: businessId, computed_at: new Date().toISOString() };
    mockStore.scores.push(saved);
    return saved;
  }

  async saveAiReport(
    businessId: string,
    report: Omit<AiReport, "id" | "business_id" | "generated_at">
  ): Promise<AiReport> {
    const saved: AiReport = {
      ...report,
      id: nextId("report"),
      business_id: businessId,
      generated_at: new Date().toISOString(),
    };
    mockStore.aiReports.unshift(saved);
    return saved;
  }

  async getLatestAiReport(businessId: string): Promise<AiReport | null> {
    return mockStore.aiReports.find((r) => r.business_id === businessId) ?? null;
  }

  async getLeadForBusiness(businessId: string): Promise<Lead | null> {
    return mockStore.leads.find((l) => l.business_id === businessId) ?? null;
  }

  async createLead(businessId: string, valueEstimate: number | null = null): Promise<Lead> {
    const existing = await this.getLeadForBusiness(businessId);
    if (existing) return existing;

    const now = new Date().toISOString();
    const lead: Lead = {
      id: nextId("lead"),
      business_id: businessId,
      owner_id: "demo-owner",
      stage: "NEW",
      value_estimate: valueEstimate,
      value_won: null,
      next_action: null,
      next_action_date: null,
      notes: null,
      created_at: now,
      updated_at: now,
    };
    mockStore.leads.push(lead);
    return lead;
  }

  async updateLead(
    leadId: string,
    patch: Partial<Pick<Lead, "stage" | "next_action" | "next_action_date" | "notes" | "value_estimate" | "value_won">>
  ): Promise<Lead> {
    const lead = mockStore.leads.find((l) => l.id === leadId);
    if (!lead) throw new Error(`Lead ${leadId} not found`);

    const previousStage = lead.stage;
    Object.assign(lead, patch, { updated_at: new Date().toISOString() });

    if (patch.stage && patch.stage !== previousStage) {
      await this.addLeadActivity(leadId, {
        type: "stage_change",
        description: `Etapa cambiada de ${previousStage} a ${patch.stage}`,
        metadata: { from: previousStage, to: patch.stage },
      });
    }

    return lead;
  }

  async addLeadActivity(
    leadId: string,
    activity: { type: LeadActivityType; description: string; metadata?: Record<string, unknown> }
  ): Promise<LeadActivity> {
    const saved: LeadActivity = {
      id: nextId("activity"),
      lead_id: leadId,
      type: activity.type,
      description: activity.description,
      metadata: activity.metadata ?? {},
      created_at: new Date().toISOString(),
    };
    mockStore.leadActivities.unshift(saved);
    return saved;
  }

  async listLeadActivities(leadId: string): Promise<LeadActivity[]> {
    return mockStore.leadActivities.filter((a) => a.lead_id === leadId);
  }

  async saveProposal(proposal: Omit<Proposal, "id" | "created_at">): Promise<Proposal> {
    const saved: Proposal = { ...proposal, id: nextId("proposal"), created_at: new Date().toISOString() };
    mockStore.proposals.unshift(saved);
    return saved;
  }

  async getLatestProposalForBusiness(businessId: string): Promise<Proposal | null> {
    return mockStore.proposals.find((p) => p.business_id === businessId) ?? null;
  }

  async listProposals(): Promise<Proposal[]> {
    return [...mockStore.proposals];
  }

  async saveDemo(demo: Omit<Demo, "id" | "created_at">): Promise<Demo> {
    const saved: Demo = { ...demo, id: nextId("demo"), created_at: new Date().toISOString() };
    mockStore.demos.unshift(saved);
    return saved;
  }

  async getLatestDemoForBusiness(businessId: string): Promise<Demo | null> {
    return mockStore.demos.find((d) => d.business_id === businessId) ?? null;
  }

  async listDemos(): Promise<Demo[]> {
    return [...mockStore.demos];
  }

  async addApiUsage(entry: Omit<ApiUsage, "id" | "owner_id" | "created_at">): Promise<ApiUsage> {
    const saved: ApiUsage = { ...entry, id: nextId("usage"), owner_id: "demo-owner", created_at: new Date().toISOString() };
    mockStore.apiUsage.unshift(saved);
    return saved;
  }

  async listApiUsage(): Promise<ApiUsage[]> {
    return [...mockStore.apiUsage];
  }
}

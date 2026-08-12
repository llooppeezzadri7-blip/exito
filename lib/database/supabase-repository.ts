import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgencyRepository, BusinessListFilters, BusinessWithScore } from "./repository";
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
];

/**
 * Real Supabase-backed repository. RLS policies (supabase/migrations/0001_init.sql)
 * scope every query to the authenticated user, so no extra owner_id filtering is
 * required here beyond what RLS already enforces — but we still pass ownerId where
 * it simplifies aggregate queries.
 */
export class SupabaseAgencyRepository implements AgencyRepository {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly ownerId: string
  ) {}

  private async latestScoresByBusiness(businessIds: string[]): Promise<Map<string, Score>> {
    if (businessIds.length === 0) return new Map();

    const { data, error } = await this.supabase
      .from("scores")
      .select("*")
      .in("business_id", businessIds)
      .order("computed_at", { ascending: false });

    if (error) throw error;

    const byBusiness = new Map<string, Score>();
    for (const row of (data ?? []) as Score[]) {
      if (!byBusiness.has(row.business_id)) byBusiness.set(row.business_id, row);
    }
    return byBusiness;
  }

  async getDashboardKpis(): Promise<DashboardKpis> {
    const [{ count: businessesFound }, { data: businesses }, { data: leads }] = await Promise.all([
      this.supabase.from("businesses").select("id", { count: "exact", head: true }),
      this.supabase.from("businesses").select("id, last_analyzed_at"),
      this.supabase.from("leads").select("stage, value_estimate, value_won"),
    ]);

    const businessIds = (businesses ?? []).map((b) => b.id as string);
    const scores = await this.latestScoresByBusiness(businessIds);

    const businessesAnalyzed = (businesses ?? []).filter((b) => b.last_analyzed_at).length;
    const newOpportunities = [...scores.values()].filter((s) => s.opportunity_score >= 71).length;
    const hotLeads = [...scores.values()].filter((s) => s.lead_score >= 71).length;

    const leadRows = (leads ?? []) as Pick<Lead, "stage" | "value_estimate" | "value_won">[];
    const potentialValue = leadRows.reduce((sum, l) => sum + (l.value_estimate ?? 0), 0);
    const wonValue = leadRows.reduce((sum, l) => sum + (l.value_won ?? 0), 0);
    const won = leadRows.filter((l) => l.stage === "WON").length;
    const lost = leadRows.filter((l) => l.stage === "LOST").length;
    const closed = won + lost;

    const [{ count: auditsGenerated }, { count: demosGenerated }, { count: proposalsSent }] =
      await Promise.all([
        this.supabase.from("ai_reports").select("id", { count: "exact", head: true }),
        this.supabase.from("demos").select("id", { count: "exact", head: true }),
        this.supabase
          .from("proposals")
          .select("id", { count: "exact", head: true })
          .eq("status", "sent"),
      ]);

    return {
      businesses_found: businessesFound ?? 0,
      businesses_analyzed: businessesAnalyzed,
      new_opportunities: newOpportunities,
      hot_leads: hotLeads,
      audits_generated: auditsGenerated ?? 0,
      demos_generated: demosGenerated ?? 0,
      proposals_sent: proposalsSent ?? 0,
      clients_won: won,
      potential_value_eur: potentialValue,
      won_value_eur: wonValue,
      conversion_rate: closed > 0 ? Math.round((won / closed) * 100) : 0,
    };
  }

  async listBusinesses(filters?: BusinessListFilters): Promise<BusinessWithScore[]> {
    let query = this.supabase.from("businesses").select("*");

    if (filters?.sector) query = query.eq("sector", filters.sector);
    if (filters?.city) query = query.eq("city", filters.city);
    if (filters?.search) query = query.ilike("name", `%${filters.search}%`);

    const { data, error } = await query;
    if (error) throw error;

    const businesses = data ?? [];
    const scores = await this.latestScoresByBusiness(businesses.map((b) => b.id));

    let items: BusinessWithScore[] = businesses.map((b) => ({
      ...b,
      score: scores.get(b.id) ?? null,
    }));

    if (filters?.minLeadScore !== undefined) {
      items = items.filter((b) => (b.score?.lead_score ?? 0) >= filters.minLeadScore!);
    }

    return items.sort((a, b) => (b.score?.lead_score ?? 0) - (a.score?.lead_score ?? 0));
  }

  async getBusiness(id: string): Promise<BusinessWithScore | null> {
    const { data, error } = await this.supabase.from("businesses").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const scores = await this.latestScoresByBusiness([id]);
    return { ...data, score: scores.get(id) ?? null };
  }

  async listRecentJobs(limit = 10): Promise<Job[]> {
    const { data, error } = await this.supabase
      .from("jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as Job[];
  }

  async listLeadsByStage(): Promise<Record<LeadStage, Lead[]>> {
    const { data, error } = await this.supabase.from("leads").select("*");
    if (error) throw error;

    const result = Object.fromEntries(LEAD_STAGES.map((s) => [s, [] as Lead[]])) as Record<
      LeadStage,
      Lead[]
    >;
    for (const row of (data ?? []) as Lead[]) result[row.stage].push(row);
    return result;
  }

  async getSettings(): Promise<Settings> {
    const { data, error } = await this.supabase
      .from("settings")
      .select("*")
      .eq("owner_id", this.ownerId)
      .single();
    if (error) throw error;
    return data as Settings;
  }

  async createJob(input: { type: JobType; params: Record<string, unknown>; progressTotal?: number }): Promise<Job> {
    const { data, error } = await this.supabase
      .from("jobs")
      .insert({
        owner_id: this.ownerId,
        type: input.type,
        status: "QUEUED",
        params: input.params,
        progress_total: input.progressTotal ?? 0,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as Job;
  }

  async updateJob(id: string, patch: Partial<Job>): Promise<Job> {
    const { data, error } = await this.supabase.from("jobs").update(patch).eq("id", id).select("*").single();
    if (error) throw error;
    return data as Job;
  }

  async importBusinesses(
    records: RawBusinessRecord[],
    jobId: string | null
  ): Promise<{ inserted: Business[]; duplicates: number }> {
    if (records.length === 0) return { inserted: [], duplicates: 0 };

    // Duplicate check against gbp_place_id (DB-enforced) and, for records
    // without one, an in-request name+address check — a full cross-table
    // fuzzy dedupe is future work, not needed for the CSV MVP.
    const placeIds = records.map((r) => r.gbp_place_id).filter((id): id is string => Boolean(id));
    const existingPlaceIds = new Set<string>();
    if (placeIds.length > 0) {
      const { data: existing, error } = await this.supabase
        .from("businesses")
        .select("gbp_place_id")
        .in("gbp_place_id", placeIds);
      if (error) throw error;
      for (const row of existing ?? []) if (row.gbp_place_id) existingPlaceIds.add(row.gbp_place_id);
    }

    const toInsert = records.filter((r) => !r.gbp_place_id || !existingPlaceIds.has(r.gbp_place_id));
    const duplicates = records.length - toInsert.length;

    if (toInsert.length === 0) return { inserted: [], duplicates };

    const { data, error } = await this.supabase
      .from("businesses")
      .insert(
        toInsert.map((r) => ({
          owner_id: this.ownerId,
          name: r.name,
          category: r.category ?? null,
          sector: r.sector ?? null,
          address: r.address ?? null,
          city: r.city ?? null,
          region: r.region ?? null,
          postal_code: r.postal_code ?? null,
          country: r.country ?? null,
          phone: r.phone ?? null,
          website_url: r.website_url ?? null,
          email: r.email ?? null,
          gbp_place_id: r.gbp_place_id ?? null,
          rating: r.rating ?? null,
          review_count: r.review_count ?? null,
          latitude: r.latitude ?? null,
          longitude: r.longitude ?? null,
          source: r.source,
          source_job_id: jobId,
        }))
      )
      .select("*");
    if (error) throw error;

    return { inserted: (data ?? []) as Business[], duplicates };
  }

  private async ensureWebsiteRow(businessId: string, url: string | null): Promise<string | null> {
    if (!url) return null;

    const { data: existing, error: findError } = await this.supabase
      .from("websites")
      .select("id")
      .eq("business_id", businessId)
      .limit(1)
      .maybeSingle();
    if (findError) throw findError;
    if (existing) return existing.id as string;

    const { data: created, error: insertError } = await this.supabase
      .from("websites")
      .insert({ business_id: businessId, url })
      .select("id")
      .single();
    if (insertError) throw insertError;
    return created.id as string;
  }

  async saveWebsiteScan(scan: Omit<WebsiteScan, "id" | "scanned_at">): Promise<WebsiteScan> {
    const business = await this.getBusiness(scan.business_id);
    const websiteId = await this.ensureWebsiteRow(scan.business_id, business?.website_url ?? null);

    const { data, error } = await this.supabase
      .from("website_scans")
      .insert({
        website_id: websiteId,
        business_id: scan.business_id,
        status: scan.status,
        source: scan.source,
        technical: scan.technical,
        seo: scan.seo,
        conversion: scan.conversion,
        design: scan.design,
        performance: scan.performance,
        unavailable_metrics: scan.unavailable_metrics,
      })
      .select("*")
      .single();
    if (error) throw error;

    await this.supabase
      .from("businesses")
      .update({ last_analyzed_at: new Date().toISOString() })
      .eq("id", scan.business_id);

    return data as WebsiteScan;
  }

  async getLatestWebsiteScan(businessId: string): Promise<WebsiteScan | null> {
    const { data, error } = await this.supabase
      .from("website_scans")
      .select("*")
      .eq("business_id", businessId)
      .order("scanned_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as WebsiteScan) ?? null;
  }

  async saveScore(businessId: string, score: Omit<Score, "id" | "business_id" | "computed_at">): Promise<Score> {
    const { data, error } = await this.supabase
      .from("scores")
      .insert({
        business_id: businessId,
        opportunity_score: score.opportunity_score,
        opportunity_breakdown: score.opportunity_breakdown,
        buying_intent_score: score.buying_intent_score,
        buying_intent_breakdown: score.buying_intent_breakdown,
        lead_score: score.lead_score,
        lead_score_breakdown: score.lead_score_breakdown,
        weights_snapshot: score.weights_snapshot,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as Score;
  }

  async saveAiReport(
    businessId: string,
    report: Omit<AiReport, "id" | "business_id" | "generated_at">
  ): Promise<AiReport> {
    const { data, error } = await this.supabase
      .from("ai_reports")
      .insert({
        business_id: businessId,
        kind: report.kind,
        summary: report.summary,
        problems: report.problems,
        opportunities: report.opportunities,
        commercial_impact: report.commercial_impact,
        recommendations: report.recommendations,
        priorities: report.priorities,
        model: report.model,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as AiReport;
  }

  async getLatestAiReport(businessId: string): Promise<AiReport | null> {
    const { data, error } = await this.supabase
      .from("ai_reports")
      .select("*")
      .eq("business_id", businessId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as AiReport) ?? null;
  }

  async getLeadForBusiness(businessId: string): Promise<Lead | null> {
    const { data, error } = await this.supabase
      .from("leads")
      .select("*")
      .eq("business_id", businessId)
      .maybeSingle();
    if (error) throw error;
    return (data as Lead) ?? null;
  }

  async createLead(businessId: string, valueEstimate: number | null = null): Promise<Lead> {
    const existing = await this.getLeadForBusiness(businessId);
    if (existing) return existing;

    const { data, error } = await this.supabase
      .from("leads")
      .insert({ business_id: businessId, owner_id: this.ownerId, stage: "NEW", value_estimate: valueEstimate })
      .select("*")
      .single();
    if (error) throw error;
    return data as Lead;
  }

  async updateLead(
    leadId: string,
    patch: Partial<Pick<Lead, "stage" | "next_action" | "next_action_date" | "notes" | "value_estimate" | "value_won">>
  ): Promise<Lead> {
    const { data: current, error: fetchError } = await this.supabase
      .from("leads")
      .select("stage")
      .eq("id", leadId)
      .single();
    if (fetchError) throw fetchError;
    const previousStage = current.stage as LeadStage;

    const { data, error } = await this.supabase.from("leads").update(patch).eq("id", leadId).select("*").single();
    if (error) throw error;

    if (patch.stage && patch.stage !== previousStage) {
      await this.addLeadActivity(leadId, {
        type: "stage_change",
        description: `Etapa cambiada de ${previousStage} a ${patch.stage}`,
        metadata: { from: previousStage, to: patch.stage },
      });
    }

    return data as Lead;
  }

  async addLeadActivity(
    leadId: string,
    activity: { type: LeadActivityType; description: string; metadata?: Record<string, unknown> }
  ): Promise<LeadActivity> {
    const { data, error } = await this.supabase
      .from("lead_activities")
      .insert({
        lead_id: leadId,
        owner_id: this.ownerId,
        type: activity.type,
        description: activity.description,
        metadata: activity.metadata ?? {},
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as LeadActivity;
  }

  async listLeadActivities(leadId: string): Promise<LeadActivity[]> {
    const { data, error } = await this.supabase
      .from("lead_activities")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as LeadActivity[];
  }

  async saveProposal(proposal: Omit<Proposal, "id" | "created_at">): Promise<Proposal> {
    const { data, error } = await this.supabase
      .from("proposals")
      .insert({
        business_id: proposal.business_id,
        owner_id: proposal.owner_id,
        title: proposal.title,
        services: proposal.services,
        price_total: proposal.price_total,
        currency: proposal.currency,
        timeline: proposal.timeline,
        maintenance_terms: proposal.maintenance_terms,
        next_steps: proposal.next_steps,
        content: proposal.content,
        status: proposal.status,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as Proposal;
  }

  async getLatestProposalForBusiness(businessId: string): Promise<Proposal | null> {
    const { data, error } = await this.supabase
      .from("proposals")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as Proposal) ?? null;
  }

  async listProposals(): Promise<Proposal[]> {
    const { data, error } = await this.supabase.from("proposals").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Proposal[];
  }

  async saveDemo(demo: Omit<Demo, "id" | "created_at">): Promise<Demo> {
    const { data, error } = await this.supabase
      .from("demos")
      .insert({
        business_id: demo.business_id,
        owner_id: demo.owner_id,
        status: demo.status,
        content: demo.content,
        webflow_site_id: demo.webflow_site_id,
        published_url: demo.published_url,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as Demo;
  }

  async updateDemo(
    demoId: string,
    patch: Partial<Pick<Demo, "status" | "webflow_site_id" | "published_url">>
  ): Promise<Demo> {
    const { data, error } = await this.supabase.from("demos").update(patch).eq("id", demoId).select("*").single();
    if (error) throw error;
    return data as Demo;
  }

  async getLatestDemoForBusiness(businessId: string): Promise<Demo | null> {
    const { data, error } = await this.supabase
      .from("demos")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as Demo) ?? null;
  }

  async listDemos(): Promise<Demo[]> {
    const { data, error } = await this.supabase.from("demos").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Demo[];
  }

  async addApiUsage(entry: Omit<ApiUsage, "id" | "owner_id" | "created_at">): Promise<ApiUsage> {
    const { data, error } = await this.supabase
      .from("api_usage")
      .insert({
        owner_id: this.ownerId,
        service: entry.service,
        operation: entry.operation,
        business_id: entry.business_id,
        job_id: entry.job_id,
        units: entry.units,
        estimated_cost_usd: entry.estimated_cost_usd,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as ApiUsage;
  }

  async listApiUsage(): Promise<ApiUsage[]> {
    const { data, error } = await this.supabase.from("api_usage").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as ApiUsage[];
  }
}

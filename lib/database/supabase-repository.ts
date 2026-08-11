import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgencyRepository, BusinessListFilters, BusinessWithScore } from "./repository";
import type { DashboardKpis, Job, Lead, LeadStage, Score, Settings } from "./types";

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
}

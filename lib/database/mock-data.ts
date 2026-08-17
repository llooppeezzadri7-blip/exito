import type { Business, DashboardKpis, Job, Lead, LeadStage, Score, Settings } from "./types";

/**
 * Fixture data used only when DATA_PROVIDER=mock (no Supabase configured).
 * Clearly fictional — the UI must label anything rendered from this module
 * as demo data (see components/dashboard/DemoModeBanner.tsx), never present
 * it as a real analyzed business.
 */

const OWNER_ID = "demo-owner";

export const MOCK_SETTINGS: Settings = {
  id: "demo-settings",
  owner_id: OWNER_ID,
  agency_name: "Tu Agencia Digital",
  agency_identity: {},
  sectors: ["Restaurantes", "Hoteles", "Clínicas dentales", "Peluquerías", "Talleres"],
  countries: ["España"],
  cities: ["Lloret de Mar", "Girona", "Barcelona"],
  services: [
    "Diseño y desarrollo web",
    "SEO",
    "SEO local",
    "Optimización Google Business Profile",
    "Optimización de conversión",
    "Automatización de marketing",
  ],
  // Illustrative starting prices in EUR, editable from /settings once the
  // settings editor ships — see ROADMAP.md. Used by the proposal generator
  // to compute a real total instead of letting the AI invent a price.
  pricing: {
    "Diseño y desarrollo web": 1800,
    SEO: 450,
    "SEO local": 350,
    "Optimización Google Business Profile": 250,
    "Optimización de conversión": 400,
    "Automatización de marketing": 500,
  },
  scoring_weights: {
    opportunity: {
      website_quality: 0.2,
      seo: 0.2,
      local_seo: 0.15,
      performance: 0.1,
      mobile_ux: 0.1,
      conversion: 0.15,
      competitive_gap: 0.1,
    },
    lead_score: { opportunity: 0.35, buying_intent: 0.35, business_value: 0.15, competitive_gap: 0.15 },
  },
  ai_model: "claude-sonnet-5",
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-11T00:00:00Z",
};

interface MockBusinessSeed {
  business: Business;
  score: Score;
  lead: Lead;
}

function biz(partial: Partial<Business> & { id: string; name: string }): Business {
  return {
    owner_id: OWNER_ID,
    category: null,
    sector: null,
    address: null,
    city: null,
    region: null,
    postal_code: null,
    country: "España",
    phone: null,
    website_url: null,
    email: null,
    social_links: {},
    gbp_place_id: null,
    rating: null,
    review_count: null,
    opening_hours: null,
    latitude: null,
    longitude: null,
    corroborating_sources: [],
    verification_status: "PROBABLE",
    source: "csv_import",
    source_job_id: null,
    last_analyzed_at: null,
    created_at: "2026-08-10T09:00:00Z",
    updated_at: "2026-08-10T09:00:00Z",
    ...partial,
  };
}

function score(businessId: string, opportunity: number, buyingIntent: number, lead: number): Score {
  return {
    id: `score-${businessId}`,
    business_id: businessId,
    opportunity_score: opportunity,
    opportunity_breakdown: {
      website_quality: Math.round(opportunity * 0.9),
      seo: Math.round(opportunity * 0.7),
      local_seo: Math.round(opportunity * 1.1),
      performance: Math.round(opportunity * 0.8),
      mobile_ux: Math.round(opportunity * 0.75),
      conversion: Math.round(opportunity * 0.6),
      competitive_gap: Math.round(opportunity * 1.2),
    },
    buying_intent_score: buyingIntent,
    buying_intent_breakdown: { no_website_signal: buyingIntent > 70 ? 1 : 0 },
    lead_score: lead,
    lead_score_breakdown: { opportunity, buying_intent: buyingIntent },
    weights_snapshot: MOCK_SETTINGS.scoring_weights,
    computed_at: "2026-08-11T08:00:00Z",
  };
}

function lead(businessId: string, stage: LeadStage, valueEstimate: number): Lead {
  return {
    id: `lead-${businessId}`,
    business_id: businessId,
    owner_id: OWNER_ID,
    stage,
    value_estimate: valueEstimate,
    value_won: stage === "WON" ? valueEstimate : null,
    next_action: stage === "WON" || stage === "LOST" ? null : "Llamar",
    next_action_date: "2026-08-12",
    notes: null,
    created_at: "2026-08-10T09:00:00Z",
    updated_at: "2026-08-11T08:00:00Z",
  };
}

const SEEDS: MockBusinessSeed[] = [
  {
    business: biz({
      id: "biz-1",
      name: "Restaurante La Marina",
      category: "Restaurante",
      sector: "Restaurantes",
      city: "Lloret de Mar",
      website_url: "http://restaurantelamarina-demo.example",
      phone: "+34 972 000 111",
      rating: 4.2,
      review_count: 318,
      source: "csv_import",
      last_analyzed_at: "2026-08-11T07:30:00Z",
    }),
    score: score("biz-1", 92, 88, 90),
    lead: lead("biz-1", "AUDIT_READY", 2400),
  },
  {
    business: biz({
      id: "biz-2",
      name: "Hotel Costa Brava Sol",
      category: "Hotel",
      sector: "Hoteles",
      city: "Lloret de Mar",
      website_url: "http://hotelcostabravasol-demo.example",
      phone: "+34 972 000 222",
      rating: 3.9,
      review_count: 512,
      source: "csv_import",
      last_analyzed_at: "2026-08-11T07:15:00Z",
    }),
    score: score("biz-2", 78, 65, 74),
    lead: lead("biz-2", "QUALIFIED", 5200),
  },
  {
    business: biz({
      id: "biz-3",
      name: "Clínica Dental Somriu",
      category: "Clínica dental",
      sector: "Clínicas dentales",
      city: "Girona",
      website_url: null,
      phone: "+34 972 000 333",
      rating: 4.7,
      review_count: 96,
      source: "csv_import",
      last_analyzed_at: "2026-08-10T18:00:00Z",
    }),
    score: score("biz-3", 85, 95, 89),
    lead: lead("biz-3", "DEMO_READY", 3100),
  },
  {
    business: biz({
      id: "biz-4",
      name: "Peluquería Estil Nou",
      category: "Peluquería",
      sector: "Peluquerías",
      city: "Lloret de Mar",
      website_url: "http://estilnou-demo.example",
      phone: "+34 972 000 444",
      rating: 4.4,
      review_count: 64,
      source: "csv_import",
      last_analyzed_at: "2026-08-09T12:00:00Z",
    }),
    score: score("biz-4", 58, 40, 52),
    lead: lead("biz-4", "CONTACTED", 900),
  },
  {
    business: biz({
      id: "biz-5",
      name: "Taller Mecànic Vidal",
      category: "Taller mecánico",
      sector: "Talleres",
      city: "Girona",
      website_url: "http://tallervidal-demo.example",
      phone: "+34 972 000 555",
      rating: 4.0,
      review_count: 41,
      source: "csv_import",
      last_analyzed_at: "2026-08-08T10:00:00Z",
    }),
    score: score("biz-5", 44, 30, 40),
    lead: lead("biz-5", "NEW", 700),
  },
  {
    business: biz({
      id: "biz-6",
      name: "Restaurante Vell Port",
      category: "Restaurante",
      sector: "Restaurantes",
      city: "Barcelona",
      website_url: "http://vellport-demo.example",
      phone: "+34 933 000 666",
      rating: 4.6,
      review_count: 723,
      source: "csv_import",
      last_analyzed_at: "2026-08-07T09:00:00Z",
    }),
    score: score("biz-6", 30, 20, 26),
    lead: lead("biz-6", "WON", 4800),
  },
];

export const MOCK_BUSINESSES: Business[] = SEEDS.map((s) => s.business);
export const MOCK_SCORES: Score[] = SEEDS.map((s) => s.score);
export const MOCK_LEADS: Lead[] = SEEDS.map((s) => s.lead);

export const MOCK_JOBS: Job[] = [
  {
    id: "job-1",
    owner_id: OWNER_ID,
    type: "discovery",
    status: "COMPLETED",
    params: { sector: "Restaurantes", city: "Lloret de Mar", country: "España", quantity: 500 },
    progress_current: 500,
    progress_total: 500,
    result: { businesses_found: 6 },
    error: null,
    retry_count: 0,
    max_retries: 3,
    business_id: null,
    created_at: "2026-08-11T07:00:00Z",
    started_at: "2026-08-11T07:00:05Z",
    finished_at: "2026-08-11T07:04:00Z",
  },
];

export function computeMockKpis(): DashboardKpis {
  const businessesAnalyzed = MOCK_BUSINESSES.filter((b) => b.last_analyzed_at).length;
  const hotLeads = MOCK_SCORES.filter((s) => s.lead_score >= 71).length;
  const potentialValue = MOCK_LEADS.reduce((sum, l) => sum + (l.value_estimate ?? 0), 0);
  const wonValue = MOCK_LEADS.reduce((sum, l) => sum + (l.value_won ?? 0), 0);
  const won = MOCK_LEADS.filter((l) => l.stage === "WON").length;
  const lost = MOCK_LEADS.filter((l) => l.stage === "LOST").length;
  const closed = won + lost;

  return {
    businesses_found: MOCK_BUSINESSES.length,
    businesses_analyzed: businessesAnalyzed,
    new_opportunities: MOCK_SCORES.filter((s) => s.opportunity_score >= 71).length,
    hot_leads: hotLeads,
    audits_generated: 2,
    demos_generated: 1,
    proposals_sent: 1,
    clients_won: won,
    potential_value_eur: potentialValue,
    won_value_eur: wonValue,
    conversion_rate: closed > 0 ? Math.round((won / closed) * 100) : 0,
  };
}

-- AI Digital Agency OS — initial schema
-- Multi-tenant by owner_id (auth.users.id). Every top-level table is scoped to its
-- owner via RLS; child tables scope through their parent.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  agency_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid());

-- ---------------------------------------------------------------------------
-- settings (1 row per owner: sectors, pricing, scoring weights, agency identity)
-- ---------------------------------------------------------------------------
create table public.settings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  agency_name text not null default 'My Agency',
  agency_identity jsonb not null default '{}'::jsonb,
  sectors jsonb not null default '[]'::jsonb,
  countries jsonb not null default '[]'::jsonb,
  cities jsonb not null default '[]'::jsonb,
  services jsonb not null default '[]'::jsonb,
  pricing jsonb not null default '{}'::jsonb,
  scoring_weights jsonb not null default '{
    "opportunity": {
      "website_quality": 0.20,
      "seo": 0.20,
      "local_seo": 0.15,
      "performance": 0.10,
      "mobile_ux": 0.10,
      "conversion": 0.15,
      "competitive_gap": 0.10
    },
    "lead_score": {
      "opportunity": 0.35,
      "buying_intent": 0.35,
      "business_value": 0.15,
      "competitive_gap": 0.15
    }
  }'::jsonb,
  ai_model text not null default 'claude-sonnet-5',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.settings enable row level security;
create policy "settings_owner_all" on public.settings
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- jobs (background work: discovery, scans, AI generation, etc.)
-- ---------------------------------------------------------------------------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in (
    'discovery', 'website_scan', 'seo_analysis', 'local_analysis',
    'competitor_analysis', 'ai_audit', 'proposal_generation', 'demo_generation'
  )),
  status text not null default 'QUEUED' check (status in (
    'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'
  )),
  params jsonb not null default '{}'::jsonb,
  progress_current integer not null default 0,
  progress_total integer not null default 0,
  result jsonb,
  error jsonb,
  retry_count integer not null default 0,
  max_retries integer not null default 3,
  business_id uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

alter table public.jobs enable row level security;
create policy "jobs_owner_all" on public.jobs
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create index jobs_owner_status_idx on public.jobs (owner_id, status);
create index jobs_created_idx on public.jobs (created_at desc);

-- ---------------------------------------------------------------------------
-- businesses
-- ---------------------------------------------------------------------------
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  category text,
  sector text,
  address text,
  city text,
  region text,
  postal_code text,
  country text,
  phone text,
  website_url text,
  email text,
  social_links jsonb not null default '{}'::jsonb,
  gbp_place_id text,
  rating numeric(2, 1),
  review_count integer,
  opening_hours jsonb,
  latitude double precision,
  longitude double precision,
  source text not null check (source in ('csv_import', 'google_places', 'manual')),
  source_job_id uuid references public.jobs (id) on delete set null,
  last_analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.businesses enable row level security;
create policy "businesses_owner_all" on public.businesses
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create index businesses_owner_idx on public.businesses (owner_id);
create index businesses_sector_idx on public.businesses (sector);
create index businesses_city_idx on public.businesses (city);
create unique index businesses_owner_place_id_idx
  on public.businesses (owner_id, gbp_place_id)
  where gbp_place_id is not null;

create trigger businesses_set_updated_at
  before update on public.businesses
  for each row execute function public.set_updated_at();

alter table public.jobs
  add constraint jobs_business_id_fkey
  foreign key (business_id) references public.businesses (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- websites
-- ---------------------------------------------------------------------------
create table public.websites (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  url text not null,
  is_reachable boolean,
  https boolean,
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.websites enable row level security;
create policy "websites_via_business" on public.websites
  for all using (
    exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())
  );

create index websites_business_idx on public.websites (business_id);

-- ---------------------------------------------------------------------------
-- website_scans (raw technical/seo/conversion/design/performance signals)
-- ---------------------------------------------------------------------------
create table public.website_scans (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  status text not null default 'completed' check (status in ('completed', 'partial', 'failed')),
  source text not null default 'internal-scanner',
  technical jsonb not null default '{}'::jsonb,
  seo jsonb not null default '{}'::jsonb,
  conversion jsonb not null default '{}'::jsonb,
  design jsonb not null default '{}'::jsonb,
  performance jsonb not null default '{}'::jsonb,
  unavailable_metrics jsonb not null default '[]'::jsonb,
  raw jsonb,
  scanned_at timestamptz not null default now()
);

alter table public.website_scans enable row level security;
create policy "website_scans_via_business" on public.website_scans
  for all using (
    exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())
  );

create index website_scans_business_idx on public.website_scans (business_id, scanned_at desc);

-- ---------------------------------------------------------------------------
-- seo_audits (derived/interpreted SEO findings for a given scan)
-- ---------------------------------------------------------------------------
create table public.seo_audits (
  id uuid primary key default gen_random_uuid(),
  website_scan_id uuid not null references public.website_scans (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  title text,
  meta_description text,
  h1_count integer,
  structured_data_present boolean,
  indexability jsonb not null default '{}'::jsonb,
  local_seo_signals jsonb not null default '{}'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  opportunities jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.seo_audits enable row level security;
create policy "seo_audits_via_business" on public.seo_audits
  for all using (
    exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())
  );

create index seo_audits_business_idx on public.seo_audits (business_id);

-- ---------------------------------------------------------------------------
-- local_audits (Google Business Profile / local SEO signals)
-- ---------------------------------------------------------------------------
create table public.local_audits (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  source text not null default 'google_places',
  gbp_data jsonb not null default '{}'::jsonb,
  signals jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now()
);

alter table public.local_audits enable row level security;
create policy "local_audits_via_business" on public.local_audits
  for all using (
    exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())
  );

create index local_audits_business_idx on public.local_audits (business_id);

-- ---------------------------------------------------------------------------
-- competitors
-- ---------------------------------------------------------------------------
create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  competitor_name text not null,
  competitor_website text,
  competitor_place_id text,
  comparison jsonb not null default '{}'::jsonb,
  is_better_positioned boolean,
  fetched_at timestamptz not null default now()
);

alter table public.competitors enable row level security;
create policy "competitors_via_business" on public.competitors
  for all using (
    exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())
  );

create index competitors_business_idx on public.competitors (business_id);

-- ---------------------------------------------------------------------------
-- scores (append-only history; latest per business = max(computed_at))
-- ---------------------------------------------------------------------------
create table public.scores (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  opportunity_score numeric(5, 2) not null,
  opportunity_breakdown jsonb not null default '{}'::jsonb,
  buying_intent_score numeric(5, 2) not null,
  buying_intent_breakdown jsonb not null default '{}'::jsonb,
  lead_score numeric(5, 2) not null,
  lead_score_breakdown jsonb not null default '{}'::jsonb,
  weights_snapshot jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now()
);

alter table public.scores enable row level security;
create policy "scores_via_business" on public.scores
  for all using (
    exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())
  );

create index scores_business_computed_idx on public.scores (business_id, computed_at desc);

-- ---------------------------------------------------------------------------
-- ai_reports (Claude-generated audit narratives)
-- ---------------------------------------------------------------------------
create table public.ai_reports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null default 'audit',
  summary text,
  problems jsonb not null default '[]'::jsonb,
  opportunities jsonb not null default '[]'::jsonb,
  commercial_impact text,
  recommendations jsonb not null default '[]'::jsonb,
  priorities jsonb not null default '[]'::jsonb,
  model text,
  input_tokens integer,
  output_tokens integer,
  generated_at timestamptz not null default now()
);

alter table public.ai_reports enable row level security;
create policy "ai_reports_via_business" on public.ai_reports
  for all using (
    exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())
  );

create index ai_reports_business_idx on public.ai_reports (business_id, generated_at desc);

-- ---------------------------------------------------------------------------
-- proposals
-- ---------------------------------------------------------------------------
create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  services jsonb not null default '[]'::jsonb,
  price_total numeric(10, 2),
  currency text not null default 'EUR',
  timeline text,
  maintenance_terms text,
  next_steps text,
  content text,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'rejected')),
  created_at timestamptz not null default now()
);

alter table public.proposals enable row level security;
create policy "proposals_owner_all" on public.proposals
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create index proposals_business_idx on public.proposals (business_id);

-- ---------------------------------------------------------------------------
-- demos
-- ---------------------------------------------------------------------------
create table public.demos (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'ready', 'published')),
  content jsonb not null default '{}'::jsonb,
  webflow_site_id text,
  published_url text,
  created_at timestamptz not null default now()
);

alter table public.demos enable row level security;
create policy "demos_owner_all" on public.demos
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create index demos_business_idx on public.demos (business_id);

-- ---------------------------------------------------------------------------
-- leads (CRM) — one per business
-- ---------------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  stage text not null default 'NEW' check (stage in (
    'NEW', 'ANALYZING', 'QUALIFIED', 'AUDIT_READY', 'DEMO_READY', 'CONTACTED',
    'REPLIED', 'MEETING', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'
  )),
  value_estimate numeric(10, 2),
  value_won numeric(10, 2),
  next_action text,
  next_action_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.leads enable row level security;
create policy "leads_owner_all" on public.leads
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create index leads_owner_stage_idx on public.leads (owner_id, stage);

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- lead_activities
-- ---------------------------------------------------------------------------
create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('stage_change', 'note', 'call', 'email', 'meeting', 'whatsapp')),
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.lead_activities enable row level security;
create policy "lead_activities_owner_all" on public.lead_activities
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create index lead_activities_lead_idx on public.lead_activities (lead_id, created_at desc);

-- ---------------------------------------------------------------------------
-- api_usage (cost control)
-- ---------------------------------------------------------------------------
create table public.api_usage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  service text not null check (service in ('anthropic', 'google_places', 'google_pagespeed', 'webflow')),
  operation text not null,
  business_id uuid references public.businesses (id) on delete set null,
  job_id uuid references public.jobs (id) on delete set null,
  units integer not null default 0,
  estimated_cost_usd numeric(10, 4) not null default 0,
  created_at timestamptz not null default now()
);

alter table public.api_usage enable row level security;
create policy "api_usage_owner_all" on public.api_usage
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create index api_usage_owner_created_idx on public.api_usage (owner_id, created_at desc);
create index api_usage_service_idx on public.api_usage (service);

-- ---------------------------------------------------------------------------
-- auto-create profile + default settings row on signup
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name) values (new.id, new.raw_user_meta_data ->> 'full_name');
  insert into public.settings (owner_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

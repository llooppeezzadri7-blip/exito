-- FASE 5 — Persistencia de la autonomía.
--
-- Hasta ahora la memoria, los experimentos, los errores conocidos y las
-- ejecuciones vivían en el proceso: al reiniciar el servidor, el sistema
-- olvidaba todo lo aprendido. Estas tablas son lo que convierte el
-- aprendizaje en algo acumulativo.
--
-- Escrita para poder aplicarse sin saber el estado previo de la base de
-- datos: todo es `if not exists` / `drop policy if exists`, así que
-- ejecutarla dos veces no rompe nada.

-- ---------------------------------------------------------------------------
-- Nuevo estado de lead: NO_INTERESADO
--
-- "Perdido" y "no interesado" no son lo mismo para el aprendizaje: uno puede
-- volver, el otro dijo que no. Mezclarlos ensucia la única señal de verdad de
-- campo que tiene el sistema.
-- ---------------------------------------------------------------------------
alter table public.leads drop constraint if exists leads_stage_check;

alter table public.leads
  add constraint leads_stage_check check (stage in (
    'NEW', 'ANALYZING', 'QUALIFIED', 'AUDIT_READY', 'DEMO_READY', 'CONTACTED',
    'REPLIED', 'MEETING', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST',
    'NOT_INTERESTED'
  ));

-- ---------------------------------------------------------------------------
-- memory_events — el registro append-only de lo que el sistema hizo y concluyó
--
-- Append-only de verdad: no hay política de UPDATE ni de DELETE. Una
-- conclusión equivocada se corrige añadiendo su corrección al lado, nunca
-- borrando la original, porque "qué creíamos, con qué evidencia y cuándo
-- descubrimos lo contrario" es la materia prima del aprendizaje.
-- ---------------------------------------------------------------------------
create table if not exists public.memory_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in (
    'SOURCE_QUERIED', 'BUSINESS_DISCOVERED', 'CONCLUSION_REACHED', 'DECISION_MADE',
    'ERROR_DETECTED', 'CORRECTION_APPLIED', 'OUTCOME_RECORDED', 'CHANGE_DETECTED'
  )),
  at timestamptz not null default now(),
  run_id text,
  business_id uuid references public.businesses (id) on delete set null,
  business_name text,
  municipality text,
  sector text,
  source text,
  summary text not null,
  data jsonb not null default '{}'::jsonb
);

alter table public.memory_events enable row level security;

drop policy if exists "memory_events_owner_select" on public.memory_events;
create policy "memory_events_owner_select" on public.memory_events
  for select using (owner_id = auth.uid());

drop policy if exists "memory_events_owner_insert" on public.memory_events;
create policy "memory_events_owner_insert" on public.memory_events
  for insert with check (owner_id = auth.uid());

create index if not exists memory_events_owner_at_idx
  on public.memory_events (owner_id, at desc);
create index if not exists memory_events_type_idx
  on public.memory_events (owner_id, type, at desc);
create index if not exists memory_events_scope_idx
  on public.memory_events (owner_id, municipality, sector);
create index if not exists memory_events_business_idx
  on public.memory_events (business_id, at desc);

-- ---------------------------------------------------------------------------
-- lead_outcomes — la verdad de campo
--
-- Guarda la puntuación que el sistema dio *en su momento*, no la actual. Si
-- se releyera la puntuación de hoy, el aprendizaje compararía su predicción
-- con una versión ya corregida de sí misma y siempre parecería acertar.
-- ---------------------------------------------------------------------------
create table if not exists public.lead_outcomes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  outcome text not null check (outcome in ('WON', 'LOST', 'NO_REPLY', 'NOT_A_FIT')),
  score_at_time integer not null,
  confidence_at_time numeric(4, 3) not null,
  recommended_service text,
  sold_service text,
  municipality text,
  sector text,
  business_source text,
  notes text,
  recorded_at timestamptz not null default now()
);

alter table public.lead_outcomes enable row level security;

drop policy if exists "lead_outcomes_owner_all" on public.lead_outcomes;
create policy "lead_outcomes_owner_all" on public.lead_outcomes
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create index if not exists lead_outcomes_owner_idx
  on public.lead_outcomes (owner_id, recorded_at desc);
create index if not exists lead_outcomes_business_idx
  on public.lead_outcomes (business_id);

-- ---------------------------------------------------------------------------
-- known_errors — errores que el sistema ha cometido y su lección
--
-- `fixed_at` sólo puede rellenarse junto a `regression_test`: cerrar un error
-- sin una prueba que impida su regreso es cerrarlo de mentira.
-- ---------------------------------------------------------------------------
create table if not exists public.known_errors (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  category text not null,
  description text not null,
  wrong_conclusion text,
  correct_conclusion text,
  lesson text not null,
  business_name text,
  detected_at timestamptz not null default now(),
  fixed_at timestamptz,
  regression_test text,
  constraint known_errors_fix_needs_test
    check (fixed_at is null or regression_test is not null)
);

alter table public.known_errors enable row level security;

drop policy if exists "known_errors_owner_all" on public.known_errors;
create policy "known_errors_owner_all" on public.known_errors
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create index if not exists known_errors_owner_idx
  on public.known_errors (owner_id, detected_at desc);

-- ---------------------------------------------------------------------------
-- experiments + experiment_observations
--
-- `target_area` y `auto_applicable` se guardan tal como los evaluó
-- checkAutonomousChange() en el momento de crear el experimento, para que
-- quede constancia de con qué permiso se creó, no del que tenga hoy.
-- ---------------------------------------------------------------------------
create table if not exists public.experiments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  hypothesis text not null,
  target_area text not null,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'RUNNING', 'CONCLUDED', 'ABANDONED')),
  auto_applicable boolean not null default false,
  constraint_reason text not null,
  conclusion jsonb,
  created_at timestamptz not null default now(),
  concluded_at timestamptz
);

alter table public.experiments enable row level security;

drop policy if exists "experiments_owner_all" on public.experiments;
create policy "experiments_owner_all" on public.experiments
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create index if not exists experiments_owner_idx
  on public.experiments (owner_id, created_at desc);

create table if not exists public.experiment_observations (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  variant_id text not null,
  variant_description text not null,
  value numeric not null,
  observed_at timestamptz not null default now()
);

alter table public.experiment_observations enable row level security;

drop policy if exists "experiment_observations_owner_all" on public.experiment_observations;
create policy "experiment_observations_owner_all" on public.experiment_observations
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create index if not exists experiment_observations_experiment_idx
  on public.experiment_observations (experiment_id, variant_id);

-- ---------------------------------------------------------------------------
-- autonomous_runs — cada ciclo, con su coste, su duración y su resultado
-- ---------------------------------------------------------------------------
create table if not exists public.autonomous_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  trigger text not null check (trigger in ('manual', 'cron', 'test')),
  status text not null default 'RUNNING'
    check (status in ('RUNNING', 'COMPLETED', 'FAILED')),
  goal_statement text not null,
  zone text not null,
  -- Por qué eligió este objetivo: explotación de lo que rinde, o exploración
  -- de lo que aún no se ha probado. Nunca se deja en blanco.
  selection_mode text not null check (selection_mode in ('exploitation', 'exploration', 'revisit', 'explicit')),
  selection_reason text not null,
  sample_size integer not null default 0,
  targets_planned integer not null default 0,
  targets_executed integer not null default 0,
  businesses_analyzed integer not null default 0,
  leads_produced integer not null default 0,
  requests_used integer not null default 0,
  estimated_cost_usd numeric(10, 4) not null default 0,
  duration_ms integer,
  stopped_because text,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table public.autonomous_runs enable row level security;

drop policy if exists "autonomous_runs_owner_all" on public.autonomous_runs;
create policy "autonomous_runs_owner_all" on public.autonomous_runs
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create index if not exists autonomous_runs_owner_idx
  on public.autonomous_runs (owner_id, started_at desc);

-- ---------------------------------------------------------------------------
-- businesses: cuándo se investigó por última vez
--
-- Es lo que permite no repetir trabajo y decidir cuándo una ficha merece
-- revisión, sin tener que recorrer el log de eventos entero.
-- ---------------------------------------------------------------------------
alter table public.businesses
  add column if not exists last_researched_at timestamptz;

alter table public.businesses
  add column if not exists research_count integer not null default 0;

create index if not exists businesses_last_researched_idx
  on public.businesses (owner_id, last_researched_at nulls first);

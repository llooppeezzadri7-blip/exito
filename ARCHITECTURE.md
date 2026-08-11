# ARCHITECTURE.md — AI Digital Agency OS

## 1. Vision

A prospecting-and-automation platform for a digital agency (web design, SEO, local SEO,
Google Business Profile optimization, CRO, redesigns, marketing automation). The system
finds businesses with weak digital presence, analyzes them, scores commercial opportunity,
and helps turn the best prospects into clients — audit → proposal → demo → CRM → follow-up.

Product principle: **lead quality over lead quantity**. Every feature must help find better
leads, help sell, reduce work, improve quality, reduce cost, or improve conversion.

## 2. Stack (decided 2026-08-11)

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js 16 (App Router, Turbopack) + React 19 + TypeScript | Scaffolded via `create-next-app`. **Next.js 16 has breaking changes vs. older training data** — see `node_modules/next/dist/docs/` and §2.1 below before touching routing/caching/middleware code. |
| Styling | Tailwind CSS v4 | Utility-first, matches "modern SaaS" requirement. |
| Backend | Next.js Route Handlers + Server Actions | No separate backend service for MVP. |
| Database | Supabase (Postgres) | Schema in `supabase/migrations/`. Requires user to provision a project (see SETUP.md). |
| Auth | Supabase Auth (`@supabase/ssr`) | Email/password + magic link. Session refresh lives in `proxy.ts` (Next 16 renamed `middleware.ts` → `proxy.ts`). |
| Background jobs | Postgres-backed job table + polling worker (`/backend/jobs`) | No Redis/queue infra assumed available; abstraction allows swapping to a real queue later. |
| AI | Anthropic API (`@anthropic-ai/sdk`) | Used for AI Audit, proposal copy, outreach messages. Requires `ANTHROPIC_API_KEY`. Abstracted behind `lib/ai/`. |
| Website analysis | Custom fetch-based scanner + Google PageSpeed Insights API (optional) | SSRF-hardened (§7). |
| Business discovery | `BusinessSourceProvider` abstraction — **CSV/Excel import active now**, **Google Places API (New) connector implemented but inactive** until `GOOGLE_PLACES_API_KEY` + billing are provided. Decision made explicitly with the user on 2026-08-11 to avoid incurring paid API costs before they opt in. | See `lib/integrations/business-sources/`. |
| Webflow | Official Webflow MCP tools (already connected in this environment) used ad hoc for demo-site editing (Phase 10). Also a clean `WebflowService` abstraction in `lib/integrations/webflow/` for any app-triggered calls (not MCP-dependent, uses Webflow's public Data API when a site token is configured). | Two separate paths: MCP (assistant-driven, interactive) vs. WebflowService (app-driven, needs `WEBFLOW_API_TOKEN`). |
| Hosting | Vercel (target) | Not deployed yet — no Vercel project/credentials in this environment. |
| Testing | Vitest + Testing Library | Unit tests for scoring, parsing, security-sensitive code (SSRF guard). |

### 2.1 Next.js 16 notes that affect this codebase

- `params` and `searchParams` in pages/layouts/routes are `Promise`s — always `await` them.
- `middleware.ts` is deprecated; this project uses `proxy.ts` exporting `proxy()`.
- `next lint` was removed; lint runs via `eslint` directly (already reflected in `package.json`).
- Turbopack is the default bundler for `dev` and `build`.
- `images.remotePatterns` required for any external image domains (e.g., Google Business photos) — configure per integration as needed, do not blanket-allow.

## 3. Module layout

```
/app                        Next.js routes (App Router)
  /(auth)                   login/signup
  /dashboard                KPI overview
  /prospects                list + [id] detail
  /audits
  /reports
  /demos
  /proposals
  /pipeline                 CRM board
  /settings                 sectors, pricing, scoring weights, integrations
  /api                      route handlers (webhooks, job triggers)

/backend                    Server-only business logic (imported by app/api and server actions)
  /scanner                  website technical/SEO/CRO/design analysis
  /analyzer                 orchestrates scanner + local SEO + competitor analysis
  /scoring                  opportunity score, buying intent score, lead score
  /report-generator         AI audit generation (Claude)
  /proposal-generator        AI proposal generation
  /demo-generator            demo content generation from real business data
  /integrations             thin server wrappers around lib/integrations for job use
  /jobs                     job queue: enqueue, worker loop, retry logic

/components
  /ui                       primitives (button, card, table, badge, skeleton, empty-state...)
  /dashboard /prospects /audits /charts /forms

/lib
  /ai                       AIProvider abstraction (Anthropic implementation)
  /database                 Supabase client (browser/server), repository interfaces + implementations
  /scoring                  pure scoring functions + configurable weight schema (shared with /backend/scoring)
  /integrations
    /business-sources       BusinessSourceProvider: CsvProvider (active), GooglePlacesProvider (inactive/stub)
    /pagespeed               Google PageSpeed Insights client (optional key)
    /webflow                 WebflowService abstraction
  /security                  SSRF guard, rate limiting, input validation (zod schemas)
  /utils

/supabase/migrations         SQL schema, versioned
```

## 4. Data pipeline

```
Discovery job (CSV import today / Places API later)
  -> businesses (raw records, sourced + timestamped)
  -> website_scans (technical/SEO/CRO/design signals, per source, nulls when unavailable)
  -> local_audits (GBP signals, when available)
  -> competitors (comparison snapshots)
  -> scores (opportunity_score, buying_intent_score, lead_score + breakdown)
  -> ai_reports (Claude-generated audit narrative — never invents numbers not present in scan data)
  -> proposals / demos (generated from real business data + agency settings)
  -> leads / lead_activities (CRM pipeline state machine)
```

All external-data fields carry a `source` and `fetched_at`. If a metric could not be
obtained, it is stored as `null` and the UI must render "no disponible" / "sin datos
suficientes" rather than fabricating a number.

## 5. Scoring model

Three distinct, separately-stored scores (never conflated):

- **Opportunity Score (0-100)** — how much better this business's digital presence
  could be. Weighted signal composite (weights configurable in `settings`):
  Website Quality 20%, SEO 20%, Local SEO 15%, Performance 10%, Mobile UX 10%,
  Conversion 15%, Competitive Gap 10%.
- **Buying Intent Score (0-100)** — likelihood they need/would buy services now
  (no website, broken site, very outdated, no responsive design, no CTA, high review
  volume but poor web presence, high-value sector, etc.). Independent signal set from
  Opportunity Score.
- **Lead Score (0-100)** — configurable weighted combination of Opportunity, Buying
  Intent, estimated business value (sector/review volume proxy), and competitive gap.

Buckets: 0-30 low, 31-50 moderate, 51-70 high, 71-85 very high, 86-100 top priority.
Weights live in the `settings` table and are editable from `/settings`, never hardcoded
in a way that requires a redeploy to change.

## 6. Integration abstraction pattern

Every external dependency is behind an interface in `lib/integrations/*`, with:
1. An interface (`*Provider` / `*Service`).
2. A real implementation calling the documented API.
3. A safe fallback (mock/CSV/no-op) used automatically when required env vars are absent,
   so the app never crashes or fabricates data — it clearly labels missing data as such.

This lets Phase 1-9 UI and business logic be built and tested today, and lets real
integrations be switched on later purely via environment variables, per the user's
explicit decision to defer paid APIs.

## 7. Security (see SECURITY.md for full detail)

- Supabase Auth + row-level security (RLS) policies per table, scoped to the owning agency/user.
- All user-supplied URLs (website analyzer) go through `lib/security/ssrf-guard.ts`:
  resolves DNS, rejects private/loopback/link-local/metadata ranges (including
  169.254.169.254 cloud metadata), rejects non-http(s) schemes, enforces redirect
  re-validation, timeouts, and response size caps.
- Secrets only via environment variables, never committed. `.env.example` documents names only.
- Input validation with `zod` at every route handler / server action boundary.
- Rate limiting on job creation and outbound analysis endpoints.

## 8. Jobs

Background analysis work runs as rows in the `jobs` table (`QUEUED, RUNNING, COMPLETED,
FAILED, CANCELLED`) processed by a worker loop, so heavy discovery/scan/AI work never
blocks a request. Errors are recorded with job id, business id, target URL, service, error
message, timestamp, and retry count — never swallowed silently (see §31 of the original brief).

## 9. Status of external integrations at time of writing (2026-08-11)

| Integration | Status | Needed to activate |
|---|---|---|
| Supabase (DB + Auth) | Schema written, **no live project provisioned in this environment** | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| CSV business import | Active | none |
| Google Places API (New) | Implemented, inactive by design | `GOOGLE_PLACES_API_KEY` + GCP billing |
| Google PageSpeed Insights | Implemented, inactive | `GOOGLE_PAGESPEED_API_KEY` (free tier available) |
| Anthropic (AI audit/proposals/messages) | Implemented, inactive | `ANTHROPIC_API_KEY` |
| Webflow (app-driven `WebflowService`) | Implemented, inactive | `WEBFLOW_API_TOKEN`, `WEBFLOW_SITE_ID` |
| Webflow MCP (assistant-driven, this session) | **Connected and usable right now** for editing an existing Webflow site interactively | Requires an existing Webflow site open in Designer; no "create site" capability observed |
| Vercel deploy | Not started | Vercel account/project |

No credentials of any kind were found in this environment (`env` scan for
Supabase/Google/Anthropic/Webflow/Vercel/n8n keys returned nothing).

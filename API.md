# API.md

There is no standalone public REST API yet — the app's server-side surface is a set
of **Next.js Server Actions** (`"use server"` files), called directly from React
Server/Client Components. This doc lists them as the current "API," module by module,
so future route handlers (`app/api/**`) or an actual public API can be modeled after
the same operations without guessing.

## `app/login/actions.ts`
- `login(prevState, formData)` — `email`, `password` → Supabase `signInWithPassword`, redirects to `/dashboard`.

## `app/signup/actions.ts`
- `signup(prevState, formData)` — `agency_name`, `email`, `password` → Supabase `signUp`.

## `app/dashboard/prospects/new/actions.ts`
- `importCsv(prevState, formData)` — `csv_file` → parses via `CsvBusinessSourceProvider`,
  creates a `discovery` job, inserts new businesses (deduped by `gbp_place_id`), returns
  a summary (`inserted`, `duplicates`, `errorRows`). Rate-limited 5/min.

## `app/dashboard/prospects/[id]/actions.ts`
- `analyzeWebsite(businessId, prevState)` — runs `scanWebsite()` (SSRF-guarded), persists
  a `website_scans` row, recomputes and persists the score. Rate-limited 5/min/business.
- `recalculateScore(businessId, prevState)` — recomputes the score from the latest scan
  without re-scanning (e.g. after changing scoring weights).
- `addToPipeline(businessId)` — creates a `leads` row (stage `NEW`) if one doesn't exist.
- `changeLeadStage(leadId, stage, redirectPath)` — updates a lead's stage, auto-logs a
  `stage_change` activity.
- `updateLeadFollowUp(leadId, formData)` — `next_action`, `next_action_date`, `notes`.
- `generateAiAudit(businessId, prevState)` — calls `AnthropicAIProvider.generateAudit`,
  persists an `ai_reports` row, logs token usage/cost. Rate-limited 3/min/business.
  **Inactive without `ANTHROPIC_API_KEY`.**
- `generateProposal(businessId, prevState)` — calls `generateProposal`, computes
  `price_total` from `settings.pricing` (never AI-invented), persists a `proposals` row.
  Rate-limited 3/min/business. **Inactive without `ANTHROPIC_API_KEY`.**
- `generateDemo(businessId, prevState)` — assembles demo content (AI copy + real DB
  fields only), persists a `demos` row with `status: "draft"`. Rate-limited
  3/min/business. **Inactive without `ANTHROPIC_API_KEY`.**
- `publishDemoToWebflow(businessId, prevState, formData)` — `confirm` must equal `"yes"`
  or the action returns without calling Webflow; publishes the site in `WEBFLOW_SITE_ID`
  to its `webflow.io` subdomain, then updates the business's latest `demos` row
  (`status: "published"`, `webflow_site_id`, `published_url`) and records an `api_usage`
  row (`service: "webflow"`, cost 0 — the Data API isn't billed per request).
  Rate-limited 2/min/business. **Inactive without `WEBFLOW_API_TOKEN` + `WEBFLOW_SITE_ID`.**
  Scope: this publishes the configured Webflow site as it currently stands — it does not
  upload the generated `demo.content` into Webflow, so the demo must already be built in
  that site (page/CMS authoring is done with the Webflow MCP tools, not the app).

## Repository layer (`lib/database`)

Not HTTP endpoints, but the stable internal interface everything above calls through —
`AgencyRepository` (see `lib/database/repository.ts`). Two implementations
(`MockAgencyRepository`, `SupabaseAgencyRepository`) are selected automatically by
`getRepository()` based on whether Supabase is configured. Any future `app/api/**`
route handler should call through this interface rather than querying Supabase directly.

## External APIs this app calls (or will, once activated)

| Service | Client | Status |
|---|---|---|
| Anthropic Messages API | `lib/ai/provider.ts` | Active once `ANTHROPIC_API_KEY` is set |
| Google Places API (New) | `lib/integrations/business-sources/google-places-provider.ts` | Implemented, inactive |
| Google PageSpeed Insights v5 | `lib/integrations/pagespeed/provider.ts` | Implemented, inactive |
| Webflow Data API v2 | `lib/integrations/webflow/service.ts` | Implemented, inactive |
| Supabase | `lib/supabase/*`, `lib/database/supabase-repository.ts` | Active once configured |

No other external API is called anywhere in this codebase.

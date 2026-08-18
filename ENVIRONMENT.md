# ENVIRONMENT.md — Environment variables

Copy `.env.example` to `.env.local` and fill in what you have. Every integration degrades
gracefully (mock/CSV/no-op) when its variables are absent — nothing crashes, but that
feature stays inactive and the UI labels it as such.

## Required for the app to do anything useful

| Variable | Purpose | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Supabase dashboard → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key (browser-safe) | same |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key for privileged operations (jobs, admin). **Never expose to the client.** | same — keep secret |

Without these, the app runs against the in-memory mock data provider (`DATA_PROVIDER=mock`
default) so the UI is still demonstrable, but nothing persists.

## Optional — enables real integrations, each independently

| Variable | Enables | Cost model |
|---|---|---|
| `GOOGLE_PAGESPEED_API_KEY` | Real Core Web Vitals / Lighthouse-based performance scoring | Free tier (25,000 req/day), then quota-limited |
| `ANTHROPIC_API_KEY` | AI Audit narratives, proposal copy, outreach messages | Pay-per-token, see Anthropic pricing |
| `WEBFLOW_API_TOKEN` / `WEBFLOW_SITE_ID` | App-driven `WebflowService` (create/edit pages, CMS) outside of this MCP session | Webflow site plan + API access |
| `N8N_WEBHOOK_URL` | Trigger external n8n automations | Depends on n8n hosting |

> Business discovery uses **only free, keyless sources** (OpenStreetMap via Overpass and the
> Catalan tourism registry). There is no paid discovery API and no key to configure for it.
> If one source fails, the run records the failure and continues with the others.

## Autonomy (FASE 5)

| Variable | Purpose | Consequence when absent |
|---|---|---|
| `AUTONOMOUS_OWNER_ID` | The account autonomous work is attributed to (a `auth.users.id` UUID). | Memory, experiments and known errors stay **process-local** and are lost on restart. The autonomy dashboard says so explicitly. |
| `AUTONOMOUS_CYCLE_SECRET` | Shared secret for `POST /api/autonomous/cycle`, at least 16 characters. | The endpoint refuses every request (503). It never defaults to open. |

Both are needed for unattended cycles to accumulate learning. `SUPABASE_SERVICE_ROLE_KEY` is
also required: a scheduled cycle has no user session, so it writes through the service-role
client instead. Apply `supabase/migrations/0003_autonomy.sql` first — the dashboard reports
which tables are missing if you don't.

### Capabilities that depend on the host, not on a key

| Capability | Requirement | Behaviour when missing |
|---|---|---|
| Real mobile audit (`backend/scanner/mobile-audit.ts`) | Playwright + a Chromium binary on the host | Reports `status: "unavailable"` with the reason. It never guesses that a site is mobile-friendly. |
| Website scanning (`backend/scanner/scan-website.ts`) | Outbound HTTP access to the target site | Returns `status: "failed"` with the error and empty result sections. |

## Internal / app config

| Variable | Purpose | Default |
|---|---|---|
| `DATA_PROVIDER` | `mock` or `supabase` | `mock` if Supabase vars absent, else `supabase` |
| `NODE_ENV` | standard | set by Next.js |

## Explicitly never used

No API key, endpoint, or credential is invented. Anything not listed above and not in the
official docs of the named service is not implemented — see the "no hallucination" rule in
CLAUDE.md / AGENTS.md for this repo.

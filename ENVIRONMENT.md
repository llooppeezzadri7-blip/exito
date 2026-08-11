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
| `GOOGLE_PLACES_API_KEY` | Automated business discovery beyond CSV import | Pay-per-use (Places API New). Requires GCP billing account. **Not enabled by default — explicit user decision.** |
| `GOOGLE_PAGESPEED_API_KEY` | Real Core Web Vitals / Lighthouse-based performance scoring | Free tier (25,000 req/day), then quota-limited |
| `ANTHROPIC_API_KEY` | AI Audit narratives, proposal copy, outreach messages | Pay-per-token, see Anthropic pricing |
| `WEBFLOW_API_TOKEN` / `WEBFLOW_SITE_ID` | App-driven `WebflowService` (create/edit pages, CMS) outside of this MCP session | Webflow site plan + API access |
| `N8N_WEBHOOK_URL` | Trigger external n8n automations | Depends on n8n hosting |

## Internal / app config

| Variable | Purpose | Default |
|---|---|---|
| `DATA_PROVIDER` | `mock` or `supabase` | `mock` if Supabase vars absent, else `supabase` |
| `NODE_ENV` | standard | set by Next.js |

## Explicitly never used

No API key, endpoint, or credential is invented. Anything not listed above and not in the
official docs of the named service is not implemented — see the "no hallucination" rule in
CLAUDE.md / AGENTS.md for this repo.

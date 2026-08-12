# ROADMAP.md

Status legend: ✅ done · 🔄 in progress · ⏳ planned · ⛔ blocked (needs credentials/decision)

| Phase | Scope | Status |
|---|---|---|
| 0 | Repo audit, stack decision, ARCHITECTURE.md, ROADMAP.md | ✅ |
| 1 | DB schema, Supabase Auth wiring, repository abstraction (mock + supabase), dashboard shell w/ KPIs | ✅ verified 2026-08-11: `tsc --noEmit`, `lint`, `build`, 28/28 vitest, and manual dev-server smoke check (all 13 routes 200, `/` → `/dashboard` 307) all clean |
| 2 | Discovery/prospection: job creation UI, `BusinessSourceProvider` (CSV active, Places stubbed) | ⏳ |
| 3 | Website analyzer: technical/SEO/CRO scanner, SSRF guard | ✅ (design/visual scoring still unavailable — needs rendering, not implemented) |
| 4 | Local SEO analyzer (GBP signals) + competitor comparison | ⛔ needs `GOOGLE_PLACES_API_KEY` (same key as discovery) — abstraction ready, no data source yet |
| 5 | Scoring engine: Opportunity / Buying Intent / Lead score | ✅ (weights editable in DB/settings; dedicated settings-page editor UI still pending) |
| 6 | AI Audit generation (Claude) | ✅ code complete (lib/ai/provider.ts, structured JSON output, no-hallucination system prompt) — ⛔ inactive at runtime until `ANTHROPIC_API_KEY` is set |
| 7 | CRM pipeline (lead stages, activities, follow-up) | ✅ stage transitions, next-action/notes, activity log (auto-logged on stage change), "Añadir a pipeline" |
| 8 | Proposal generator | ✅ wired end-to-end; price computed from real `settings.pricing`, never invented by the model |
| 9 | Demo generator (uses real business data only) | ✅ AI writes only headline/subheadline/about/CTA from real fields; contact/reviews assembled directly from the DB (never AI-generated); photos/testimonials are explicit placeholders; nothing auto-publishes — publishing is an explicit, separately-confirmed user action (see Phase 10) |
| 10 | WebflowService (app-driven) + docs on MCP-driven demo editing | ✅ `lib/integrations/webflow/service.ts` implemented against verified endpoints (sites, pages, publish, CMS items) — inactive without `WEBFLOW_API_TOKEN`/`WEBFLOW_SITE_ID`. Now wired to a UI action: "Publicar en Webflow" on the prospect detail page (two-step confirm, re-checked server-side, rate-limited 2/min/business, records `status`/`webflow_site_id`/`published_url` on the demo). **Scope:** it publishes the site in `WEBFLOW_SITE_ID` — it does *not* upload `demo.content` into Webflow (no verified Data API endpoint authors a page from it; that stays an interactive Webflow-MCP job), and the UI says so explicitly |
| 11 | Automations (n8n) | ⏳ skipped for MVP — no concrete workflow identified yet that adds value beyond what's already automated in-app (brief §37 test) |
| 12 | Analytics + cost tracking (`api_usage`, cost-per-lead, ROI) | ✅ `/dashboard/reports` — real token usage/cost per AI call, cost per lead/audit/client |
| 13 | Security hardening, test suite, production readiness docs | 🔄 SSRF guard, RLS, rate limiting, resource limits, security headers/CSP, CI (`.github/workflows/ci.yml`: lint+typecheck+unit+build+e2e), Playwright e2e smoke suite (`e2e/`), SECURITY.md, API.md all done; still missing: penetration testing (needs a target deployment + explicit engagement scope, not something to self-authorize) |

## Key decisions log

- **2026-08-11** — Business discovery MVP uses CSV/Excel import as the active data source;
  Google Places API (New) connector is implemented but left inactive until the user
  provisions Google Cloud billing and provides `GOOGLE_PLACES_API_KEY`. Rationale: avoid
  incurring real per-request costs (~$32/1000 Text Search requests) without explicit opt-in.
- **2026-08-11** — Project created fresh at `~/ai-digital-agency-os` (home directory was not
  a git repo; an unrelated pre-existing project `~/xtrem` was left untouched).
- **2026-08-11** — Next.js 16 confirmed via bundled docs (`node_modules/next/dist/docs`):
  using `proxy.ts` instead of `middleware.ts`, async `params`/`searchParams`, ESLint CLI
  instead of removed `next lint`.

- **2026-08-11** — Phase 13 continued without new credentials: CSP/security headers added
  to `next.config.ts` (no nonces — the App Router's inline RSC flight-data bootstrap scripts
  need `'unsafe-inline'` on `script-src` without one, and nonce-based CSP would force every
  page to dynamic rendering; see SECURITY.md for the trade-off). GitHub Actions CI added
  (`.github/workflows/ci.yml`: lint, typecheck, unit tests, build, e2e — all runnable without
  secrets since every integration is optional). Playwright e2e smoke suite added (`e2e/`,
  `playwright.config.ts`) covering the auth redirect, dashboard shell, all sidebar sections,
  and the prospects list → detail flow in a real browser — this is also what verified the CSP
  change doesn't break hydration/client navigation.

- **2026-08-12** — Phase 10 publish action wired to the UI. It publishes the *configured
  Webflow site*, not the in-app demo preview: pushing `demo.content` into Webflow would need
  page/DOM-authoring endpoints that aren't in the verified set (brief §36), so that remains an
  interactive Webflow-MCP task. The button label, the confirmation panel and API.md all state
  this rather than implying the preview is what goes live. Publishing is gated by a two-step
  confirm whose flag the server action re-checks — a server action is a callable endpoint, so
  the client-side confirm alone would not be a real guard.

## Next up

Remaining Phase 13 item is penetration testing, which needs an explicit engagement scope and
usually a deployed target — not something to schedule unprompted. Otherwise the credential-gated
items (Phase 4 local SEO, Phase 6 AI audit activation, Phase 10 publish at runtime) are the
next real product work, blocked on the user providing `GOOGLE_PLACES_API_KEY` /
`ANTHROPIC_API_KEY` / `WEBFLOW_API_TOKEN` + `WEBFLOW_SITE_ID` (see SETUP.md), or the Phase 5
settings-page scoring-weight editor UI, which needs no new credentials.

Note for whoever picks this up: `mockStore.demos` starts empty, so in mock/demo mode there is
no demo on a prospect page and the publish button never renders — the flow is only reachable
once `ANTHROPIC_API_KEY` is set and a demo has been generated. That's also why the button is
covered by a component test rather than the Playwright suite. (Unrelated pre-existing nit:
`MOCK_KPIS.demos_generated` is 1 while the seeded store has 0 demos.)

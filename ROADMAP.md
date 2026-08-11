# ROADMAP.md

Status legend: ✅ done · 🔄 in progress · ⏳ planned · ⛔ blocked (needs credentials/decision)

| Phase | Scope | Status |
|---|---|---|
| 0 | Repo audit, stack decision, ARCHITECTURE.md, ROADMAP.md | ✅ |
| 1 | DB schema, Supabase Auth wiring, repository abstraction (mock + supabase), dashboard shell w/ KPIs | 🔄 |
| 2 | Discovery/prospection: job creation UI, `BusinessSourceProvider` (CSV active, Places stubbed) | ⏳ |
| 3 | Website analyzer: technical/SEO/CRO scanner, SSRF guard | ✅ (design/visual scoring still unavailable — needs rendering, not implemented) |
| 4 | Local SEO analyzer (GBP signals) + competitor comparison | ⛔ needs `GOOGLE_PLACES_API_KEY` (same key as discovery) — abstraction ready, no data source yet |
| 5 | Scoring engine: Opportunity / Buying Intent / Lead score | ✅ (weights editable in DB/settings; dedicated settings-page editor UI still pending) |
| 6 | AI Audit generation (Claude) | ✅ code complete (lib/ai/provider.ts, structured JSON output, no-hallucination system prompt) — ⛔ inactive at runtime until `ANTHROPIC_API_KEY` is set |
| 7 | CRM pipeline (lead stages, activities, follow-up) | ✅ stage transitions, next-action/notes, activity log (auto-logged on stage change), "Añadir a pipeline" |
| 8 | Proposal generator | ✅ wired end-to-end; price computed from real `settings.pricing`, never invented by the model |
| 9 | Demo generator (uses real business data only) | ✅ AI writes only headline/subheadline/about/CTA from real fields; contact/reviews assembled directly from the DB (never AI-generated); photos/testimonials are explicit placeholders; nothing auto-publishes (no publish action exists yet, by design) |
| 10 | WebflowService (app-driven) + docs on MCP-driven demo editing | ✅ `lib/integrations/webflow/service.ts` implemented against verified endpoints (sites, pages, publish, CMS items) — inactive without `WEBFLOW_API_TOKEN`/`WEBFLOW_SITE_ID`; not yet wired to a UI action (no "publish to Webflow" button — demos stay in-app previews, see Phase 9) |
| 11 | Automations (n8n) | ⏳ skipped for MVP — no concrete workflow identified yet that adds value beyond what's already automated in-app (brief §37 test) |
| 12 | Analytics + cost tracking (`api_usage`, cost-per-lead, ROI) | ✅ `/dashboard/reports` — real token usage/cost per AI call, cost per lead/audit/client |
| 13 | Security hardening, test suite, production readiness docs | 🔄 SSRF guard, RLS, rate limiting, resource limits, SECURITY.md, API.md done; still missing: CI, CSP/security headers, e2e tests, penetration testing |

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

## Next up

Finish Phase 1 (schema + auth + dashboard shell with mock data), verified with
`npm run build`, `npm run lint`, `npx tsc --noEmit`, and a manual dev-server smoke check.

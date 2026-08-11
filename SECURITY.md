# SECURITY.md

## Threat model highlights

The single riskiest input in this system is **user-supplied URLs** — a business's
`website_url` (from CSV import or, later, Google Places) gets fetched by the server
on the user's behalf every time someone clicks "Analizar web ahora". That is a classic
SSRF vector: nothing stops someone from setting a business's website to
`http://169.254.169.254/latest/meta-data/` or `http://localhost:5432`.

## What's implemented today

| Control | Where | Notes |
|---|---|---|
| SSRF guard | `lib/security/ssrf-guard.ts` | Resolves DNS before fetching, blocks loopback/private/link-local/CGNAT/reserved ranges (IPv4 + IPv6), blocks the cloud metadata address explicitly, rejects non-http(s) schemes and embedded credentials, re-validates on every redirect hop, enforces a request timeout and a response-size cap. 8 unit tests, including a real DNS resolution and a live block of the metadata IP through the actual scanner. |
| Auth | Supabase Auth (`lib/supabase/*`) + `proxy.ts` | Session refreshed via `getClaims()` (JWT-signature-verified), never `getSession()`, per Supabase's current guidance. `/dashboard/**` redirects unauthenticated users to `/login`. |
| Row-level security | `supabase/migrations/0001_init.sql` | Every table scoped to `owner_id = auth.uid()`, either directly or (for child tables) via an `EXISTS` join to the owning business/lead. |
| Input validation | `zod` at every boundary that parses untrusted input | CSV rows (`lib/integrations/business-sources/csv-provider.ts`), env vars (`lib/config/env.ts`). |
| Secrets | Environment variables only | Nothing hardcoded; `.env.example` documents names, never values. See ENVIRONMENT.md. |
| Rate limiting | `lib/security/rate-limit.ts` | In-memory fixed-window limiter on network- and cost-bearing actions: website scans (5/min/business), each AI generation (3/min/business), CSV import (5/min). **Known limitation**: process-local, not shared across instances — fine for a single deployment, needs a shared store (e.g. Redis) before scaling horizontally. |
| Resource limits | `lib/security/limits.ts` | CSV import capped at 2MB / 2000 rows. |
| File uploads | CSV import action | Size-checked before parsing; parsed with `papaparse`, never `eval`'d or executed. |
| Job error visibility | `jobs.error` column | Every failed job records the message, service, and target URL — never swallowed silently (brief §31). |

## What's explicitly NOT implemented yet

- **CSRF**: Next.js Server Actions have built-in CSRF protection (origin checking) as of the
  version used here — not something this app layers on top of, but worth re-verifying against
  current Next.js docs before a security-sensitive audit.
- **Centralized audit log**: job records give per-operation visibility, but there's no
  append-only security audit trail (who viewed what, when) yet.
- **Content Security Policy / security headers**: not configured in `next.config.ts` yet.
- **Automated dependency scanning**: not wired into CI (there is no CI yet — see ROADMAP.md Phase 13).
- **Penetration testing**: none performed. This document describes defensive design intent,
  not a verified-secure claim.

## Reporting

No external users yet — this is a single-tenant local build. Before any production
deployment, add a documented disclosure process here.

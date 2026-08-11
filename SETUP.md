# SETUP.md

## Prerequisites

- Node.js 20.9+ (required by Next.js 16)
- npm (this repo standardizes on npm; no pnpm/yarn found in the dev environment)
- A Supabase project (free tier is enough to start) — see ENVIRONMENT.md
- Optional: Anthropic API key, Google Cloud API key(s), Webflow token — only needed for
  the features that use them

## Install

```bash
npm install
```

## Configure environment

```bash
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY at minimum
```

Without Supabase configured, the app still runs with in-memory mock data
(`DATA_PROVIDER=mock`) so you can see the UI end-to-end before wiring a real database.

## Database

Once you have a Supabase project:

```bash
# In the Supabase SQL editor, or via the Supabase CLI once installed locally,
# run the migrations in order:
supabase/migrations/*.sql
```

(The Supabase CLI is not installed in this dev environment — install it separately if you
want local `supabase start` / `supabase db push` workflows. See
https://supabase.com/docs/guides/cli for the current official install instructions.)

## Run

```bash
npm run dev      # http://localhost:3000
npm run build    # production build (Turbopack, Next.js 16 default)
npm run start    # serve the production build
npm run lint      # ESLint (next lint was removed in Next.js 16)
npx tsc --noEmit  # type-check
npm test          # Vitest unit tests
```

## Deploying

Target platform is Vercel. Not yet deployed from this environment (no Vercel
account/credentials here) — connect the repo in the Vercel dashboard and set the same
environment variables from ENVIRONMENT.md in the Vercel project settings.

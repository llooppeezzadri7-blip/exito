import { z } from "zod";

/**
 * Every external integration is optional at the env-var level. Missing vars
 * disable that integration (mock/CSV fallback) instead of crashing the app —
 * see ARCHITECTURE.md §6 and ENVIRONMENT.md.
 */
const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  // Supabase renamed ANON_KEY -> PUBLISHABLE_KEY in their current Next.js SSR guide.
  // Accept the new name first, fall back to the legacy one for older projects.
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  GOOGLE_PAGESPEED_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  WEBFLOW_API_TOKEN: z.string().optional(),
  WEBFLOW_SITE_ID: z.string().optional(),
  N8N_WEBHOOK_URL: z.string().url().optional(),

  DATA_PROVIDER: z.enum(["mock", "supabase"]).optional(),
});

// .env files (and .env.example, which people copy to .env.local) commonly
// leave optional vars blank rather than omitting the line entirely — that
// lands in process.env as "", not undefined, which fails `.url().optional()`
// validation below and would otherwise crash the whole app instead of
// degrading gracefully as documented. Treat blank as unset.
const envWithBlanksAsUnset = Object.fromEntries(
  Object.entries(process.env).map(([key, value]) => [key, value === "" ? undefined : value])
);

const parsed = envSchema.safeParse(envWithBlanksAsUnset);

if (!parsed.success) {
  // Only truly malformed values (e.g. an invalid URL) land here — everything
  // is optional, so a bare-minimum environment always parses successfully.
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables — see ENVIRONMENT.md");
}

const raw = parsed.data;

export const env = {
  ...raw,
  supabasePublishableKey:
    raw.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? raw.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};

export const hasSupabase = Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.supabasePublishableKey);
export const hasSupabaseAdmin = Boolean(hasSupabase && env.SUPABASE_SERVICE_ROLE_KEY);
export const hasPageSpeed = Boolean(env.GOOGLE_PAGESPEED_API_KEY);
export const hasAnthropic = Boolean(env.ANTHROPIC_API_KEY);
export const hasWebflow = Boolean(env.WEBFLOW_API_TOKEN && env.WEBFLOW_SITE_ID);

export const dataProvider: "mock" | "supabase" =
  env.DATA_PROVIDER ?? (hasSupabase ? "supabase" : "mock");

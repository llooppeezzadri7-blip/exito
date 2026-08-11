import { createBrowserClient } from "@supabase/ssr";
import { env, hasSupabase } from "@/lib/config/env";

/**
 * Client Component Supabase client. Throws only if called while Supabase
 * isn't configured — callers must check `hasSupabase` (from lib/config/env)
 * before rendering anything that needs it.
 */
export function createClient() {
  if (!hasSupabase) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local — see ENVIRONMENT.md."
    );
  }

  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.supabasePublishableKey!);
}

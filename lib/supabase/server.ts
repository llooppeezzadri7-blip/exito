import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env, hasSupabase } from "@/lib/config/env";

/**
 * Server Component / Server Action / Route Handler Supabase client.
 * Returns null when Supabase isn't configured so callers can fall back to
 * the mock repository instead of throwing mid-request.
 */
export async function createClient() {
  if (!hasSupabase) return null;

  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.supabasePublishableKey!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component — safe to ignore, the proxy
          // (proxy.ts) refreshes the session on every request instead.
        }
      },
    },
  });
}

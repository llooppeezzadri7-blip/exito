import { hasSupabase } from "@/lib/config/env";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import type { AgencyRepository } from "./repository";
import { MockAgencyRepository } from "./mock-repository";
import { SupabaseAgencyRepository } from "./supabase-repository";

/**
 * Server-side repository factory. Falls back to the mock provider whenever
 * Supabase isn't configured or the caller isn't authenticated, so pages can
 * always render — see ARCHITECTURE.md §6.
 */
export async function getRepository(): Promise<AgencyRepository> {
  if (!hasSupabase) return new MockAgencyRepository();

  const supabase = await createServerSupabaseClient();
  if (!supabase) return new MockAgencyRepository();

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims) return new MockAgencyRepository();

  return new SupabaseAgencyRepository(supabase, claims.sub as string);
}

export type { AgencyRepository, BusinessListFilters, BusinessWithScore } from "./repository";
export * from "./types";

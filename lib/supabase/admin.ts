import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, hasSupabaseAdmin } from "@/lib/config/env";

/**
 * FASE 5 — Service-role client for work that runs without a logged-in user.
 *
 * A scheduled cycle has no session and no cookies, so the normal server
 * client would produce a client with no claims and every RLS policy would
 * (correctly) reject it. This one bypasses RLS, which is why it is confined
 * to background execution and never reachable from a request the browser can
 * shape: the route that uses it authenticates with a shared secret first.
 *
 * Returns null when the service-role key is absent, so callers degrade to the
 * mock repository instead of throwing.
 */
export function createAdminClient(): SupabaseClient | null {
  if (!hasSupabaseAdmin) return null;

  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Which owner autonomous work is attributed to. Everything the system writes
 * belongs to a real account — there is no "system" owner — so the id has to
 * be configured explicitly rather than guessed from whatever row happens to
 * be first in the table.
 */
export function autonomousOwnerId(): string | null {
  return env.AUTONOMOUS_OWNER_ID ?? null;
}

/** Tables FASE 5 depends on, checked at runtime so a missing migration is visible. */
export const AUTONOMY_TABLES = [
  "memory_events",
  "lead_outcomes",
  "known_errors",
  "experiments",
  "experiment_observations",
  "autonomous_runs",
] as const;

export interface SchemaStatus {
  configured: boolean;
  adminConfigured: boolean;
  ownerConfigured: boolean;
  /** Null when it could not be checked (no client); otherwise per-table. */
  tables: { table: string; present: boolean; error: string | null }[] | null;
  summary: string;
}

/**
 * Reports whether migration 0003 has actually been applied. Asked at runtime
 * rather than assumed: the project may point at a database that predates the
 * autonomy tables, and silently writing nowhere is exactly the failure this
 * whole phase exists to prevent.
 */
export async function checkAutonomySchema(): Promise<SchemaStatus> {
  const client = createAdminClient();

  if (!client) {
    return {
      configured: hasSupabaseAdmin,
      adminConfigured: hasSupabaseAdmin,
      ownerConfigured: autonomousOwnerId() !== null,
      tables: null,
      summary: hasSupabaseAdmin
        ? "No se ha podido crear el cliente de administración."
        : "Sin SUPABASE_SERVICE_ROLE_KEY: la persistencia autónoma está desactivada y la memoria vive solo en el proceso.",
    };
  }

  const tables = await Promise.all(
    AUTONOMY_TABLES.map(async (table) => {
      // head+count touches the table without reading rows: the cheapest way
      // to ask "does this exist and can I read it".
      const { error } = await client.from(table).select("*", { head: true, count: "exact" }).limit(0);
      return { table, present: !error, error: error?.message ?? null };
    })
  );

  const missing = tables.filter((t) => !t.present);

  return {
    configured: true,
    adminConfigured: true,
    ownerConfigured: autonomousOwnerId() !== null,
    tables,
    summary: missing.length
      ? `Faltan ${missing.length} tabla(s): ${missing.map((t) => t.table).join(", ")}. Aplica supabase/migrations/0003_autonomy.sql.`
      : "Todas las tablas de la fase 5 están presentes.",
  };
}

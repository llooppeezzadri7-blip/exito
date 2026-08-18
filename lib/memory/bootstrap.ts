import { createAdminClient, autonomousOwnerId } from "@/lib/supabase/admin";
import { SupabaseMemoryPersistence } from "./supabase-persistence";
import { hydrateMemory, memoryPersistenceStatus, setMemoryPersistence } from "./research-memory";
import { hydrateErrors, seedKnownErrors, errorCount } from "./error-memory";
import { hydrateExperiments } from "./experiments";

/**
 * FASE 5.2 — start-up.
 *
 * Attaches the durable backend and pulls the log back into the cache. Runs at
 * most once per process; concurrent callers await the same promise rather
 * than each starting their own hydration and racing to overwrite the cache.
 *
 * When Supabase or the owner id is missing this deliberately does *not*
 * throw. The system keeps working with a process-local memory, and
 * `memoryStatus()` reports that plainly so the dashboard can say "lo
 * aprendido se perderá al reiniciar" instead of quietly implying otherwise.
 */

export interface MemoryBootstrapResult {
  persistent: boolean;
  backend: string | null;
  eventsLoaded: number;
  errorsLoaded: number;
  experimentsLoaded: number;
  reason: string;
}

const globalForBootstrap = globalThis as unknown as {
  __memoryBootstrap?: Promise<MemoryBootstrapResult>;
};

async function bootstrap(): Promise<MemoryBootstrapResult> {
  const ownerId = autonomousOwnerId();
  const client = createAdminClient();

  if (!client || !ownerId) {
    // Seed the two real errors the project has actually made, so the lessons
    // are present even without a database behind them.
    if (errorCount() === 0) seedKnownErrors();

    return {
      persistent: false,
      backend: null,
      eventsLoaded: 0,
      errorsLoaded: 0,
      experimentsLoaded: 0,
      reason: !client
        ? "Sin SUPABASE_SERVICE_ROLE_KEY: la memoria vive solo en este proceso y se perderá al reiniciar."
        : "Sin AUTONOMOUS_OWNER_ID: no se sabe a qué cuenta atribuir lo aprendido, así que no se persiste.",
    };
  }

  setMemoryPersistence(new SupabaseMemoryPersistence(client, ownerId));

  const [eventsLoaded, errorsLoaded, experimentsLoaded] = await Promise.all([
    hydrateMemory(),
    hydrateErrors(),
    hydrateExperiments(),
  ]);

  // Only seed when the database itself has none: seeding on every boot would
  // re-open errors that were already closed with their regression tests.
  if (errorsLoaded === 0 && errorCount() === 0) seedKnownErrors();

  return {
    persistent: true,
    backend: "supabase",
    eventsLoaded,
    errorsLoaded,
    experimentsLoaded,
    reason: `Memoria restaurada: ${eventsLoaded} eventos, ${errorsLoaded} errores, ${experimentsLoaded} experimentos.`,
  };
}

export function ensureMemoryReady(): Promise<MemoryBootstrapResult> {
  globalForBootstrap.__memoryBootstrap ??= bootstrap();
  return globalForBootstrap.__memoryBootstrap;
}

/** Forces the next `ensureMemoryReady()` to run again. For tests. */
export function resetMemoryBootstrap(): void {
  globalForBootstrap.__memoryBootstrap = undefined;
  setMemoryPersistence(null);
}

export interface MemoryStatus extends MemoryBootstrapResult {
  pendingWrites: number;
  lostWrites: { at: string; operation: string; message: string }[];
  hydratedAt: string | null;
}

export async function memoryStatus(): Promise<MemoryStatus> {
  const result = await ensureMemoryReady();
  const status = memoryPersistenceStatus();

  return {
    ...result,
    pendingWrites: status.pendingWrites,
    lostWrites: status.lostWrites,
    hydratedAt: status.hydratedAt,
  };
}

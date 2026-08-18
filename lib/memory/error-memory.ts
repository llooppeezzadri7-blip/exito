import { randomUUID } from "node:crypto";
import { enqueueMemoryWrite, memoryPersistence, recordEvent, queryEvents } from "./research-memory";

/**
 * FASE 2 — Memoria de errores.
 *
 * Records mistakes the system made, and refuses to consider one closed until
 * a regression test exists that would catch it again. That is the whole point:
 * an error log that only stores apologies teaches nothing, and a "fixed" flag
 * without a test is a promise nobody can check.
 *
 * The two real errors this project has already made — concluding Smile Dentik
 * and El Gaucho had no website — are seeded below, because the corrections
 * that followed are the clearest example of what this log is for.
 */

export type ErrorCategory =
  | "false_absence"
  | "wrong_identity"
  | "unverified_claim"
  | "duplicate_merge"
  | "source_misread"
  | "pipeline_failure";

export type ErrorStatus = "OPEN" | "TEST_WRITTEN" | "FIXED" | "ACCEPTED_RISK";

export interface ErrorRecord {
  id: string;
  category: ErrorCategory;
  /** What was claimed. */
  claim: string;
  /** What was actually true. */
  reality: string;
  /** Why the system got it wrong — the mechanism, not the apology. */
  cause: string;
  detectedAt: string;
  detectedBy: "user" | "second_research" | "self_check";
  businessName: string | null;
  status: ErrorStatus;
  /** Test that would catch a recurrence. Required before status FIXED. */
  regressionTest: string | null;
  fix: string | null;
}

class ErrorStore {
  errors: ErrorRecord[] = [];
}

const globalForErrors = globalThis as unknown as { __errorMemory?: ErrorStore };
const store = globalForErrors.__errorMemory ?? new ErrorStore();
globalForErrors.__errorMemory = store;

/** FASE 5.2 — write-through, so a lesson learned outlives the process. */
function persist(error: ErrorRecord): void {
  const persistence = memoryPersistence();
  if (!persistence) return;
  enqueueMemoryWrite(`saveError:${error.id}`, () => persistence.saveError({ ...error }));
}

/**
 * Restores known errors from the durable backend. Merged by id and the
 * in-process copy wins, so hydrating mid-session cannot revert a fix that was
 * just applied.
 */
export async function hydrateErrors(): Promise<number> {
  const persistence = memoryPersistence();
  if (!persistence) return 0;

  const loaded = await persistence.loadErrors();
  const byId = new Map(loaded.map((error) => [error.id, error]));
  for (const error of store.errors) byId.set(error.id, error);

  store.errors = [...byId.values()];
  return loaded.length;
}

export interface RecordErrorInput {
  category: ErrorCategory;
  claim: string;
  reality: string;
  cause: string;
  detectedBy: ErrorRecord["detectedBy"];
  businessName?: string | null;
  at?: string;
}

export function recordError(input: RecordErrorInput): ErrorRecord {
  const error: ErrorRecord = {
    id: randomUUID(),
    category: input.category,
    claim: input.claim,
    reality: input.reality,
    cause: input.cause,
    detectedAt: input.at ?? new Date().toISOString(),
    detectedBy: input.detectedBy,
    businessName: input.businessName ?? null,
    status: "OPEN",
    regressionTest: null,
    fix: null,
  };

  store.errors.push(error);
  persist(error);
  recordEvent({
    type: "ERROR_DETECTED",
    runId: null,
    businessId: null,
    businessName: error.businessName,
    municipality: null,
    sector: null,
    source: null,
    summary: `Error detectado (${error.category}): ${error.claim}`,
    data: { errorId: error.id, cause: error.cause },
    at: error.detectedAt,
  });

  return error;
}

export function attachRegressionTest(errorId: string, testName: string): ErrorRecord {
  const error = store.errors.find((e) => e.id === errorId);
  if (!error) throw new Error(`Error desconocido: ${errorId}`);

  error.regressionTest = testName;
  if (error.status === "OPEN") error.status = "TEST_WRITTEN";
  persist(error);
  return error;
}

/**
 * Marks an error fixed. Refuses without a regression test: "arreglado" with
 * nothing to catch a recurrence is exactly how the same mistake comes back.
 */
export function markFixed(errorId: string, fix: string): ErrorRecord {
  const error = store.errors.find((e) => e.id === errorId);
  if (!error) throw new Error(`Error desconocido: ${errorId}`);

  if (!error.regressionTest) {
    throw new Error(
      `No se puede marcar ${errorId} como corregido sin un test de regresión: sin él, nada impide que vuelva a ocurrir.`
    );
  }

  error.status = "FIXED";
  error.fix = fix;
  persist(error);

  recordEvent({
    type: "CORRECTION_APPLIED",
    runId: null,
    businessId: null,
    businessName: error.businessName,
    municipality: null,
    sector: null,
    source: null,
    summary: `Corregido ${errorId}: ${fix}`,
    data: { errorId, regressionTest: error.regressionTest },
  });

  return error;
}

export function listErrors(status?: ErrorStatus): ErrorRecord[] {
  return status ? store.errors.filter((e) => e.status === status) : [...store.errors];
}

export interface ErrorPattern {
  category: ErrorCategory;
  count: number;
  open: number;
  /** The lesson, phrased so a future check can be written from it. */
  lesson: string;
}

const LESSONS: Record<ErrorCategory, string> = {
  false_absence:
    "No concluir que algo no existe porque no se ha encontrado: exigir una fuente que publique el campo.",
  wrong_identity:
    "No atribuir una web o un perfil a un negocio sin que coincida un identificador fuerte (teléfono o dirección).",
  unverified_claim: "No presentar como hecho lo que solo es una inferencia.",
  duplicate_merge: "No fusionar dos negocios sin un identificador que sea realmente único.",
  source_misread: "No interpretar la ausencia de un campo como un valor.",
  pipeline_failure: "Un fallo en una fase no debe contaminar los datos de las demás.",
};

export function errorPatterns(): ErrorPattern[] {
  const byCategory = new Map<ErrorCategory, ErrorRecord[]>();
  for (const error of store.errors) {
    byCategory.set(error.category, [...(byCategory.get(error.category) ?? []), error]);
  }

  return [...byCategory.entries()]
    .map(([category, errors]) => ({
      category,
      count: errors.length,
      open: errors.filter((e) => e.status !== "FIXED").length,
      lesson: LESSONS[category],
    }))
    .sort((a, b) => b.count - a.count);
}

/** True when this kind of mistake has happened before and is still open. */
export function isKnownRisk(category: ErrorCategory): boolean {
  return store.errors.some((e) => e.category === category && e.status !== "FIXED");
}

export function errorCount(): number {
  return store.errors.length;
}

export function resetErrorMemory(): void {
  store.errors = [];
}

/**
 * Seeds the two real mistakes made on this project, already corrected. They
 * are here as data, not decoration: the learning report reads them, and the
 * regression tests named below actually exist.
 */
export function seedKnownErrors(): ErrorRecord[] {
  const smileDentik = recordError({
    category: "false_absence",
    claim: "Smile Dentik no tiene web propia.",
    reality: "Sí la tiene: smiledentik.com.",
    cause:
      "Se concluyó la ausencia a partir de no encontrarla en buscadores, sin una fuente que publicara el campo web.",
    detectedBy: "user",
    businessName: "Smile Dentik",
    at: "2026-08-14T10:00:00Z",
  });
  attachRegressionTest(smileDentik.id, "lib/scoring/website-absence.regression.test.ts");
  markFixed(
    smileDentik.id,
    "La ausencia de web solo puntúa si una fuente que publica el campo lo devuelve vacío; dos fuentes para VERIFICADO."
  );

  const elGaucho = recordError({
    category: "wrong_identity",
    claim: "El Gaucho no tiene web propia.",
    reality: "La tiene bajo otra marca comercial (steakhouselloret.com), por eso no aparecía al buscar su nombre.",
    cause:
      "Se buscó solo por nombre comercial, sin contemplar que la web pudiera estar publicada bajo otra marca.",
    detectedBy: "user",
    businessName: "Restaurante El Gaucho",
    at: "2026-08-14T11:00:00Z",
  });
  attachRegressionTest(elGaucho.id, "lib/research/website-resolver.test.ts");
  markFixed(
    elGaucho.id,
    "La resolución de web acepta otra marca si coincide teléfono o dirección, y rechaza la coincidencia solo por nombre."
  );

  return [smileDentik, elGaucho];
}

/** Errors detected but never closed, for the daily review to pick up. */
export function openErrors(): ErrorRecord[] {
  return store.errors.filter((e) => e.status === "OPEN" || e.status === "TEST_WRITTEN");
}

export function errorHistory() {
  return queryEvents({ type: "ERROR_DETECTED" });
}

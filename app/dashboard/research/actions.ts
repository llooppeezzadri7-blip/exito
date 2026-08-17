"use server";

import { revalidatePath } from "next/cache";
import { getRepository } from "@/lib/database";
import { runResearch } from "@/backend/research/run-research";
import { createRunId, getRun, saveRun } from "@/backend/research/run-store";
import { DEPTH_PRESETS, type ResearchConfig, type ResearchDepth } from "@/backend/research/types";
import type { ProgressStep, ResearchRunRecord } from "@/backend/research/types";
import { checkRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { COSTA_BRAVA_MUNICIPALITIES } from "@/lib/research/costa-brava";
import { DEFAULT_COST_LIMIT_USD, estimateResearchCost } from "@/lib/research/cost-estimate";
import type { StartResearchState } from "./state";

const MAX_BUSINESSES = 60;

function parseConfig(formData: FormData): ResearchConfig | { error: string } {
  const municipality = String(formData.get("municipality") ?? "").trim();
  const sector = String(formData.get("sector") ?? "").trim();
  const subsector = String(formData.get("subsector") ?? "").trim();
  const depth = String(formData.get("depth") ?? "rapida") as ResearchDepth;
  const maxBusinesses = Number(formData.get("maxBusinesses") ?? 20);

  if (!municipality) return { error: "Selecciona un municipio." };
  if (!COSTA_BRAVA_MUNICIPALITIES.some((m) => m.name === municipality)) {
    return { error: "Municipio no reconocido." };
  }
  if (!DEPTH_PRESETS[depth]) return { error: "Profundidad no válida." };
  if (!Number.isFinite(maxBusinesses) || maxBusinesses < 1 || maxBusinesses > MAX_BUSINESSES) {
    return { error: `El máximo de negocios debe estar entre 1 y ${MAX_BUSINESSES}.` };
  }

  return {
    municipality,
    sector: sector || undefined,
    subsector: subsector || undefined,
    depth,
    maxBusinesses,
  };
}

export async function startResearch(
  _prevState: StartResearchState,
  formData: FormData
): Promise<StartResearchState> {
  // Discovery costs money per request, so this is rate limited like every
  // other cost-bearing action in the app.
  try {
    checkRateLimit("research:start", 5, 60_000);
  } catch (err) {
    if (err instanceof RateLimitError) return { error: err.message, runId: null };
    throw err;
  }

  const parsed = parseConfig(formData);
  if ("error" in parsed) return { error: parsed.error, runId: null };

  // Enforced here as well as in the form: a server action is reachable by a
  // direct POST, so a client-side guard alone would not actually cap spend.
  const estimate = estimateResearchCost(parsed, { limitUsd: DEFAULT_COST_LIMIT_USD });
  if (estimate.exceedsLimit && formData.get("confirmOverLimit") !== "on") {
    return {
      error: `El coste estimado (${estimate.estimatedCostUsd.toFixed(3)} $) supera el límite de ${estimate.limitUsd.toFixed(2)} $. Marca la confirmación para ejecutarla igualmente.`,
      runId: null,
    };
  }

  const repository = await getRepository();
  const id = createRunId();

  const initial: ResearchRunRecord = {
    id,
    config: parsed,
    status: "RUNNING",
    steps: [],
    results: [],
    issues: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };
  saveRun(initial);

  // Deliberately not awaited: the pipeline takes minutes and the UI polls
  // getResearchProgress() meanwhile. Every progress tick persists the run, so
  // a page reload mid-run still shows where it is.
  void runResearch({
    config: parsed,
    repository,
    onProgress: (steps: ProgressStep[]) => {
      const current = getRun(id);
      if (current) saveRun({ ...current, steps });
    },
  })
    .then((finished) => saveRun({ ...finished, id }))
    .catch((err: unknown) => {
      const current = getRun(id);
      saveRun({
        ...(current ?? initial),
        id,
        status: "FAILED",
        finishedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : "Fallo inesperado en la investigación",
      });
    });

  revalidatePath("/dashboard/research");
  return { error: null, runId: id };
}

export interface ResearchProgressView {
  status: ResearchRunRecord["status"];
  steps: ProgressStep[];
  resultCount: number;
  issueCount: number;
  error: string | null;
}

/** Polled by the progress view while a run is in flight. */
export async function getResearchProgress(runId: string): Promise<ResearchProgressView | null> {
  const run = getRun(runId);
  if (!run) return null;

  return {
    status: run.status,
    steps: run.steps,
    resultCount: run.results.length,
    issueCount: run.issues.length,
    error: run.error,
  };
}

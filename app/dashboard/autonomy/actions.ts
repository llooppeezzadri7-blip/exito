"use server";

import { revalidatePath } from "next/cache";
import { getRepository } from "@/lib/database";
import { ensureMemoryReady } from "@/lib/memory/bootstrap";
import { runAutonomousCycle, saveCycle } from "@/backend/planner/autonomous-cycle";
import { DEFAULT_CYCLE_BUDGET } from "@/backend/planner/next-objective";
import { checkRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import type { RunCycleState } from "./state";

/**
 * Manual trigger for one autonomous cycle. The same code path the cron
 * endpoint uses, with the same budget — so what you see when you press the
 * button is what happens unattended, not a different, gentler version of it.
 */
export async function startCycle(
  _prevState: RunCycleState,
  _formData: FormData
): Promise<RunCycleState> {
  try {
    checkRateLimit("autonomy:cycle", 3, 60_000);
  } catch (err) {
    if (err instanceof RateLimitError) return { error: err.message, summary: null };
    throw err;
  }

  await ensureMemoryReady();
  const repository = await getRepository();

  const record = await runAutonomousCycle({
    repository,
    trigger: "manual",
    budget: DEFAULT_CYCLE_BUDGET,
  });

  saveCycle(record);
  revalidatePath("/dashboard/autonomy");

  if (record.status === "FAILED") {
    return { error: record.error ?? "El ciclo falló.", summary: null };
  }

  return {
    error: null,
    summary: `${record.selectionMode}: ${record.goal.statement} — ${record.leadsProduced} leads de ${record.businessesAnalyzed} negocios en ${Math.round(record.durationMs / 1000)} s.`,
  };
}

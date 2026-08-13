"use server";

import { revalidatePath } from "next/cache";
import { getRepository } from "@/lib/database";
import { computeScores } from "@/lib/scoring/compute-scores";
import { InvalidWeightsError, parseScoringWeightsForm } from "@/lib/scoring/weights";
import { checkRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { dataProvider } from "@/lib/config/env";
import type { SettingsState } from "./state";

export async function updateScoringWeights(
  _prevState: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  try {
    checkRateLimit("settings:weights", 10, 60_000);
  } catch (err) {
    if (err instanceof RateLimitError) return { error: err.message, message: null };
    throw err;
  }

  let weights;
  try {
    weights = parseScoringWeightsForm(formData);
  } catch (err) {
    if (err instanceof InvalidWeightsError) return { error: err.message, message: null };
    throw err;
  }

  const repo = await getRepository();
  try {
    await repo.updateSettings({ scoring_weights: weights });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "No se pudieron guardar los pesos.",
      message: null,
    };
  }

  revalidatePath("/dashboard/settings");

  const note =
    dataProvider === "mock"
      ? " Modo demostración: se guardan en memoria hasta reiniciar el servidor."
      : "";

  return {
    error: null,
    // Saying "normalizados" up front matters: the stored values won't always
    // equal what the user typed if their percentages didn't add up to 100.
    message: `Pesos guardados y normalizados al 100%.${note} Las puntuaciones ya calculadas siguen usando los pesos anteriores hasta que las recalcules.`,
    weights,
  };
}

export async function recalculateAllScores(_prevState: SettingsState): Promise<SettingsState> {
  try {
    checkRateLimit("settings:recalculate-all", 3, 60_000);
  } catch (err) {
    if (err instanceof RateLimitError) return { error: err.message, message: null };
    throw err;
  }

  const repo = await getRepository();
  const [businesses, settings] = await Promise.all([repo.listBusinesses(), repo.getSettings()]);

  let updated = 0;
  for (const business of businesses) {
    const scan = await repo.getLatestWebsiteScan(business.id);
    const scoreData = computeScores({ business, scan, weights: settings.scoring_weights });
    await repo.saveScore(business.id, scoreData);
    updated += 1;
  }

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/prospects");
  revalidatePath("/dashboard/pipeline");

  return {
    error: null,
    message:
      updated === 0
        ? "No hay negocios que recalcular todavía."
        : `Recalculadas ${updated} ${updated === 1 ? "puntuación" : "puntuaciones"} con los pesos actuales.`,
  };
}

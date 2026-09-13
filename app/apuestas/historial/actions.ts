"use server";

import { revalidatePath } from "next/cache";
import { settleBet, type BetResult } from "@/lib/betting/history";

const VALID_RESULTS: BetResult[] = ["pendiente", "ganada", "perdida", "nula"];

/** Mark a logged bet as won, lost, void, or back to pending. */
export async function settleBetAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const result = String(formData.get("result") ?? "") as BetResult;

  if (!id || !VALID_RESULTS.includes(result)) {
    throw new Error("Petición inválida: falta el identificador o el resultado no es válido.");
  }

  await settleBet(id, result);
  revalidatePath("/apuestas/historial");
}

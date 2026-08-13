"use client";

import { useActionState } from "react";
import { recalculateAllScores } from "./actions";
import { initialSettingsState, type SettingsState } from "./state";
import { buttonVariants } from "@/components/ui/Button";

export function RecalculateAllButton() {
  const [state, formAction, pending] = useActionState<SettingsState>(
    recalculateAllScores,
    initialSettingsState
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={pending} className={buttonVariants({ variant: "secondary" })}>
        {pending ? "Recalculando..." : "Recalcular todas las puntuaciones"}
      </button>
      {state.error && <span className="text-xs text-status-critical">{state.error}</span>}
      {state.message && <span className="text-xs text-status-good">{state.message}</span>}
    </form>
  );
}

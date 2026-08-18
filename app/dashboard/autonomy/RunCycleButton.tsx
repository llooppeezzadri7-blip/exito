"use client";

import { useActionState } from "react";
import { startCycle } from "./actions";
import { initialRunCycleState } from "./state";

/**
 * Runs one cycle on demand. Deliberately shows what the cycle decided rather
 * than just "hecho": the point of the manual trigger is to watch the system
 * choose, not merely to make it work.
 */
export function RunCycleButton() {
  const [state, formAction, pending] = useActionState(startCycle, initialRunCycleState);

  return (
    <form action={formAction} className="space-y-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-accent-450 px-4 py-2 text-sm font-medium text-black disabled:opacity-60"
      >
        {pending ? "Ejecutando un ciclo…" : "Ejecutar un ciclo ahora"}
      </button>
      {state.summary && <p className="text-xs text-status-good">{state.summary}</p>}
      {state.error && <p className="text-xs text-status-critical">{state.error}</p>}
    </form>
  );
}

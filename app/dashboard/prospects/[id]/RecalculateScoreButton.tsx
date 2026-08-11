"use client";

import { useActionState } from "react";
import { recalculateScore, type AnalyzeState } from "./actions";
import { buttonVariants } from "@/components/ui/Button";

const initialState: AnalyzeState = { error: null, ok: false };

export function RecalculateScoreButton({ businessId }: { businessId: string }) {
  const [state, formAction, pending] = useActionState(recalculateScore.bind(null, businessId), initialState);

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <button type="submit" disabled={pending} className={buttonVariants({ variant: "secondary" })}>
        {pending ? "Calculando..." : "Recalcular puntuación"}
      </button>
      {state.error && <span className="text-xs text-status-critical">{state.error}</span>}
    </form>
  );
}

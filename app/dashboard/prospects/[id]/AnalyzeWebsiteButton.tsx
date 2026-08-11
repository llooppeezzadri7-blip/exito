"use client";

import { useActionState } from "react";
import { analyzeWebsite, type AnalyzeState } from "./actions";
import { buttonVariants } from "@/components/ui/Button";

const initialState: AnalyzeState = { error: null, ok: false };

export function AnalyzeWebsiteButton({ businessId, hasWebsite }: { businessId: string; hasWebsite: boolean }) {
  const [state, formAction, pending] = useActionState(analyzeWebsite.bind(null, businessId), initialState);

  if (!hasWebsite) {
    return (
      <span className={buttonVariants({ variant: "secondary", className: "cursor-not-allowed opacity-60" })}>
        Sin web detectada
      </span>
    );
  }

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <button type="submit" disabled={pending} className={buttonVariants({ variant: "secondary" })}>
        {pending ? "Analizando..." : "Analizar web ahora"}
      </button>
      {state.error && <span className="text-xs text-status-critical">{state.error}</span>}
    </form>
  );
}

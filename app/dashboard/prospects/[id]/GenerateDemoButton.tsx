"use client";

import { useActionState } from "react";
import { generateDemo, type AnalyzeState } from "./actions";
import { buttonVariants } from "@/components/ui/Button";

const initialState: AnalyzeState = { error: null, ok: false };

export function GenerateDemoButton({ businessId }: { businessId: string }) {
  const [state, formAction, pending] = useActionState(generateDemo.bind(null, businessId), initialState);

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <button type="submit" disabled={pending} className={buttonVariants()}>
        {pending ? "Generando..." : "Generar demo"}
      </button>
      {state.error && <span className="text-xs text-status-critical">{state.error}</span>}
    </form>
  );
}

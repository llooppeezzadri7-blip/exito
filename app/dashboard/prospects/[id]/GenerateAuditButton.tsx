"use client";

import { useActionState } from "react";
import { generateAiAudit, type AnalyzeState } from "./actions";
import { buttonVariants } from "@/components/ui/Button";

const initialState: AnalyzeState = { error: null, ok: false };

export function GenerateAuditButton({ businessId }: { businessId: string }) {
  const [state, formAction, pending] = useActionState(generateAiAudit.bind(null, businessId), initialState);

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <button type="submit" disabled={pending} className={buttonVariants({ variant: "secondary" })}>
        {pending ? "Generando..." : "Generar auditoría IA"}
      </button>
      {state.error && <span className="text-xs text-status-critical">{state.error}</span>}
    </form>
  );
}

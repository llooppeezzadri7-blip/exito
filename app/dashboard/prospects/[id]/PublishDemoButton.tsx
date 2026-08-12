"use client";

import { useActionState, useState } from "react";
import { publishDemoToWebflow, type AnalyzeState } from "./actions";
import { buttonVariants } from "@/components/ui/Button";

const initialState: AnalyzeState = { error: null, ok: false };

/**
 * Two-step confirm: nothing in this app publishes on a single click. The
 * server action re-checks the confirmation flag, so this is a UX guard rather
 * than the security boundary — see actions.ts.
 */
export function PublishDemoButton({ businessId, configured }: { businessId: string; configured: boolean }) {
  const [state, formAction, pending] = useActionState(
    publishDemoToWebflow.bind(null, businessId),
    initialState
  );
  const [confirming, setConfirming] = useState(false);

  // Collapse the confirmation panel once a publish succeeds. Adjusting state
  // during render (rather than in an effect) is the supported pattern for
  // reacting to a changed value, and avoids the extra commit an effect costs.
  const [lastOk, setLastOk] = useState(state.ok);
  if (state.ok !== lastOk) {
    setLastOk(state.ok);
    if (state.ok) setConfirming(false);
  }

  if (!configured) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled className={buttonVariants({ variant: "secondary" })}>
          Publicar en Webflow
        </button>
        <span className="text-xs text-text-muted">
          Requiere <code>WEBFLOW_API_TOKEN</code> y <code>WEBFLOW_SITE_ID</code> (ver SETUP.md).
        </span>
      </div>
    );
  }

  if (!confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={buttonVariants({ variant: "secondary" })}
        >
          Publicar en Webflow
        </button>
        {state.ok && <span className="text-xs text-status-good">Publicado correctamente.</span>}
        {state.error && <span className="text-xs text-status-critical">{state.error}</span>}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-2 rounded-lg border border-status-warning/40 bg-surface-2 p-3">
      <input type="hidden" name="confirm" value="yes" />
      <p className="text-xs text-text-secondary">
        Esto publica <strong>el sitio de Webflow configurado</strong> (<code>WEBFLOW_SITE_ID</code>) en su
        subdominio público, con todo lo que tenga en ese momento. La vista previa de abajo no se sube a Webflow:
        la demo debe estar ya montada en ese sitio.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={buttonVariants({ size: "sm" })}>
          {pending ? "Publicando..." : "Sí, publicar ahora"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Cancelar
        </button>
        {state.error && <span className="text-xs text-status-critical">{state.error}</span>}
      </div>
    </form>
  );
}

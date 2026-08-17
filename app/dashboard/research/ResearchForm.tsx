"use client";

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { startResearch } from "./actions";
import { initialStartResearchState, type StartResearchState } from "./state";
import { DEPTH_PRESETS, type ResearchDepth } from "@/backend/research/types";
import { COSTA_BRAVA_MUNICIPALITIES, COSTA_BRAVA_SECTORS } from "@/lib/research/costa-brava";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";
import { CostPreview } from "./CostPreview";
import { DEFAULT_COST_LIMIT_USD, estimateResearchCost } from "@/lib/research/cost-estimate";

const DEPTH_ORDER: ResearchDepth[] = ["rapida", "profunda", "completa"];

const fieldClass =
  "h-10 w-full rounded-lg border border-border-hairline bg-surface-2 px-3 text-sm text-text-primary";

export function ResearchForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<StartResearchState, FormData>(
    startResearch,
    initialStartResearchState
  );
  const [sector, setSector] = useState("");
  const [depth, setDepth] = useState<ResearchDepth>("profunda");
  const [municipality, setMunicipality] = useState("Blanes");
  const [maxBusinesses, setMaxBusinesses] = useState(10);
  const [confirmedOverLimit, setConfirmedOverLimit] = useState(false);

  const estimate = estimateResearchCost(
    { municipality, depth, maxBusinesses },
    { limitUsd: DEFAULT_COST_LIMIT_USD }
  );
  const blockedByCost = estimate.exceedsLimit && !confirmedOverLimit;

  const subsectors = useMemo(
    () => COSTA_BRAVA_SECTORS.find((s) => s.name === sector)?.subsectors ?? [],
    [sector]
  );

  if (state.runId) {
    router.push(`/dashboard/research/${state.runId}`);
  }

  return (
    <form action={formAction} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Qué investigar</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs text-text-muted">Municipio</span>
            <select
              name="municipality"
              value={municipality}
              onChange={(e) => setMunicipality(e.target.value)}
              className={fieldClass}
            >
              {COSTA_BRAVA_MUNICIPALITIES.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name} ({m.comarca})
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs text-text-muted">Sector</span>
            <select
              name="sector"
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              className={fieldClass}
            >
              <option value="">Todos los sectores</option>
              {COSTA_BRAVA_SECTORS.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs text-text-muted">Subsector</span>
            <select name="subsector" className={fieldClass} disabled={subsectors.length === 0}>
              <option value="">
                {subsectors.length === 0 ? "Elige un sector primero" : "Todos los subsectores"}
              </option>
              {subsectors.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs text-text-muted">Máximo de negocios</span>
            <input
              type="number"
              name="maxBusinesses"
              value={maxBusinesses}
              onChange={(e) => setMaxBusinesses(Number(e.target.value))}
              min={1}
              max={60}
              className={cn(fieldClass, "tabular-nums")}
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Profundidad de investigación</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {DEPTH_ORDER.map((id) => {
            const preset = DEPTH_PRESETS[id];
            const selected = depth === id;
            return (
              <label
                key={id}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors",
                  selected
                    ? "border-accent-450 bg-surface-2"
                    : "border-border-hairline hover:bg-surface-2"
                )}
              >
                <input
                  type="radio"
                  name="depth"
                  value={id}
                  checked={selected}
                  onChange={() => setDepth(id)}
                  className="mt-1"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium text-text-primary">{preset.label}</span>
                  <span className="block text-xs text-text-secondary">{preset.description}</span>
                  <span className="block text-xs text-text-muted">{preset.steps.join(" → ")}</span>
                </span>
              </label>
            );
          })}
        </CardContent>
      </Card>

      <CostPreview
        municipality={municipality}
        depth={depth}
        maxBusinesses={maxBusinesses}
        limitUsd={DEFAULT_COST_LIMIT_USD}
        confirmed={confirmedOverLimit}
        onConfirmChange={setConfirmedOverLimit}
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || blockedByCost}
          className={buttonVariants({ size: "md" })}
        >
          {pending ? "Iniciando..." : "🚀 Iniciar investigación"}
        </button>
        {blockedByCost && (
          <span className="text-xs text-status-critical">
            Confirma el exceso de coste para poder lanzarla.
          </span>
        )}
        {state.error && <span className="text-xs text-status-critical">{state.error}</span>}
      </div>
    </form>
  );
}

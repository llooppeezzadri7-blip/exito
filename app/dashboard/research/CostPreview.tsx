"use client";

import { useMemo } from "react";
import { estimateResearchCost } from "@/lib/research/cost-estimate";
import type { ResearchDepth } from "@/backend/research/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

/**
 * Pre-flight cost panel (§2). Recomputed from the form as it changes, so the
 * numbers on screen always describe the run that the button would launch.
 */
export function CostPreview({
  municipality,
  depth,
  maxBusinesses,
  limitUsd,
  confirmed,
  onConfirmChange,
}: {
  municipality: string;
  depth: ResearchDepth;
  maxBusinesses: number;
  limitUsd: number;
  confirmed: boolean;
  onConfirmChange: (value: boolean) => void;
}) {
  const estimate = useMemo(
    () =>
      estimateResearchCost(
        { municipality, depth, maxBusinesses: Number.isFinite(maxBusinesses) ? maxBusinesses : 0 },
        { limitUsd }
      ),
    [municipality, depth, maxBusinesses, limitUsd]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Antes de lanzar: coste y alcance</CardTitle>
        <Badge tone={estimate.exceedsLimit ? "critical" : "good"}>
          {estimate.exceedsLimit ? "Supera el límite" : "Dentro del límite"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <p className="text-xs text-text-muted">Consultas de descubrimiento</p>
            <p className="tabular-nums text-text-primary">{estimate.discoveryRequests}</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Coste estimado</p>
            <p className="tabular-nums text-text-primary">
              {estimate.estimatedCostUsd.toFixed(3)} $
            </p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Límite configurado</p>
            <p className="tabular-nums text-text-primary">{estimate.limitUsd.toFixed(2)} $</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Tope de negocios</p>
            <p className="tabular-nums text-text-primary">{estimate.maxBusinesses}</p>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs text-text-muted">Fases que se ejecutarán</p>
          <p className="text-xs text-text-secondary">{estimate.phases.join(" → ")}</p>
        </div>

        <div>
          <p className="mb-1.5 text-xs text-text-muted">Llamadas externas (máximo)</p>
          <ul className="space-y-1.5 text-xs">
            {estimate.calls.map((call) => (
              <li key={`${call.provider}-${call.operation}`} className="flex flex-wrap gap-x-2">
                <Badge tone={call.billable ? "warning" : "neutral"}>
                  {call.billable ? "De pago" : "Gratis"}
                </Badge>
                <span className="text-text-primary">
                  {call.provider} · {call.operation}
                </span>
                <span className="tabular-nums text-text-secondary">≤ {call.maxCalls}</span>
                <span className="w-full text-text-muted">{call.note}</span>
              </li>
            ))}
          </ul>
        </div>

        <ul className="space-y-1 text-xs text-text-muted">
          {estimate.notes.map((note) => (
            <li key={note}>· {note}</li>
          ))}
        </ul>

        {estimate.exceedsLimit && (
          <label className="flex items-start gap-2 rounded-lg border border-status-critical p-3">
            <input
              type="checkbox"
              name="confirmOverLimit"
              checked={confirmed}
              onChange={(e) => onConfirmChange(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-xs text-text-primary">
              El coste estimado ({estimate.estimatedCostUsd.toFixed(3)} $) supera el límite de{" "}
              {estimate.limitUsd.toFixed(2)} $. Confirmo que quiero ejecutarla igualmente.
            </span>
          </label>
        )}
      </CardContent>
    </Card>
  );
}

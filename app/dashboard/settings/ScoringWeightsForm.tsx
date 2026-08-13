"use client";

import { useActionState, useState } from "react";
import {
  LEAD_SCORE_WEIGHT_KEYS,
  LEAD_SCORE_WEIGHT_LABELS,
  OPPORTUNITY_WEIGHT_KEYS,
  OPPORTUNITY_WEIGHT_LABELS,
  type ScoringWeights,
} from "@/lib/scoring/weights";
import { updateScoringWeights } from "./actions";
import { initialSettingsState, type SettingsState } from "./state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

type PercentGroup = Record<string, number>;

function toPercents(group: Record<string, number>): PercentGroup {
  return Object.fromEntries(Object.entries(group).map(([key, value]) => [key, Math.round(value * 1000) / 10]));
}

function sum(group: PercentGroup): number {
  return Math.round(Object.values(group).reduce((total, value) => total + value, 0) * 10) / 10;
}

function WeightRow({
  name,
  label,
  value,
  onChange,
}: {
  name: string;
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <label htmlFor={name} className="w-40 shrink-0 text-text-secondary">
        {label}
      </label>
      <input
        id={name}
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 flex-1 cursor-pointer accent-accent-450"
        aria-label={label}
      />
      <input
        type="number"
        name={name}
        min={0}
        max={100}
        step={0.1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 w-20 rounded-lg border border-border-hairline bg-surface-2 px-2 text-right tabular-nums"
        aria-label={`${label} (porcentaje)`}
      />
      <span className="w-4 text-text-muted">%</span>
    </div>
  );
}

function GroupTotal({ total }: { total: number }) {
  const balanced = Math.abs(total - 100) < 0.05;

  return (
    <p className={cn("text-xs", balanced ? "text-text-muted" : "text-status-warning")}>
      Total: <span className="tabular-nums">{total}%</span>
      {!balanced && " — al guardar se normalizará a 100% manteniendo las proporciones."}
    </p>
  );
}

export function ScoringWeightsForm({ weights }: { weights: ScoringWeights }) {
  const [opportunity, setOpportunity] = useState<PercentGroup>(() => toPercents(weights.opportunity));
  const [leadScore, setLeadScore] = useState<PercentGroup>(() => toPercents(weights.lead_score));
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(
    updateScoringWeights,
    initialSettingsState
  );

  // After a save, show what the server actually stored — the normalised
  // weights, which differ from what was typed whenever the group didn't add up
  // to 100%. (Adjusting state during render instead of in an effect, per
  // https://react.dev/learn/you-might-not-need-an-effect.)
  const [appliedWeights, setAppliedWeights] = useState<ScoringWeights>(weights);
  if (state.weights && state.weights !== appliedWeights) {
    setAppliedWeights(state.weights);
    setOpportunity(toPercents(state.weights.opportunity));
    setLeadScore(toPercents(state.weights.lead_score));
  }

  const opportunityTotal = sum(opportunity);
  const leadScoreTotal = sum(leadScore);
  const allZero = opportunityTotal === 0 || leadScoreTotal === 0;

  function reset() {
    setOpportunity(toPercents(appliedWeights.opportunity));
    setLeadScore(toPercents(appliedWeights.lead_score));
  }

  return (
    <form action={formAction} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Pesos del Opportunity Score</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-text-muted">
            Cuánto pesa cada carencia detectada en la web al calcular la oportunidad comercial.
          </p>
          {OPPORTUNITY_WEIGHT_KEYS.map((key) => (
            <WeightRow
              key={key}
              name={`opportunity.${key}`}
              label={OPPORTUNITY_WEIGHT_LABELS[key]}
              value={opportunity[key] ?? 0}
              onChange={(next) => setOpportunity((prev) => ({ ...prev, [key]: next }))}
            />
          ))}
          <GroupTotal total={opportunityTotal} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pesos del Lead Score</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-text-muted">
            Cómo se combinan oportunidad, intención de compra y valor del negocio en la puntuación final del lead.
          </p>
          {LEAD_SCORE_WEIGHT_KEYS.map((key) => (
            <WeightRow
              key={key}
              name={`lead_score.${key}`}
              label={LEAD_SCORE_WEIGHT_LABELS[key]}
              value={leadScore[key] ?? 0}
              onChange={(next) => setLeadScore((prev) => ({ ...prev, [key]: next }))}
            />
          ))}
          <GroupTotal total={leadScoreTotal} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || allZero} className={buttonVariants()}>
          {pending ? "Guardando..." : "Guardar pesos"}
        </button>
        <button type="button" onClick={reset} disabled={pending} className={buttonVariants({ variant: "ghost" })}>
          Descartar cambios
        </button>
        {allZero && (
          <span className="text-xs text-status-critical">
            Cada bloque necesita al menos un factor con peso mayor que 0.
          </span>
        )}
        {state.error && <span className="text-xs text-status-critical">{state.error}</span>}
        {state.message && <span className="text-xs text-status-good">{state.message}</span>}
      </div>
    </form>
  );
}

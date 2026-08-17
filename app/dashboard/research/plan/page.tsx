import Link from "next/link";
import { buildPlan, planUsesHistory } from "@/backend/planner/planner";
import { COSTA_BRAVA_MUNICIPALITIES, COSTA_BRAVA_SECTORS } from "@/lib/research/costa-brava";
import { DEPTH_PRESETS, type ResearchDepth } from "@/backend/research/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { JustificationBasis, ResearchGoal } from "@/backend/planner/types";

/**
 * The plan preview. It builds a plan and shows it — it never runs it.
 *
 * The point of this page is that the planner's reasoning is inspectable
 * *before* anything is spent: every target carries the basis of its
 * justification, and a basis of "no_history_yet" is displayed as plainly as a
 * measured one, so a plan built on defaults can never be mistaken for a plan
 * built on evidence.
 */

const BASIS_LABEL: Record<JustificationBasis, { label: string; tone: "good" | "neutral" | "warning" }> = {
  historical_evidence: { label: "Evidencia histórica", tone: "good" },
  no_history_yet: { label: "Sin historial todavía", tone: "neutral" },
  explicit_request: { label: "Petición explícita", tone: "neutral" },
  domain_rule: { label: "Regla del dominio", tone: "neutral" },
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PlanPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const municipality = first(params.municipality) ?? "";
  const sector = first(params.sector) ?? "";
  const depth = (first(params.depth) ?? "profunda") as ResearchDepth;
  const maxLeads = Number(first(params.maxLeads) ?? 20);
  const statement = first(params.statement)?.trim() ?? "";
  const requested = first(params.plan) === "1";

  const validDepth = DEPTH_PRESETS[depth] ? depth : "profunda";
  const validLeads = Number.isFinite(maxLeads) ? Math.min(Math.max(maxLeads, 1), 60) : 20;

  const goal: ResearchGoal = {
    statement: statement || "Encontrar los negocios con mayor oportunidad comercial en la zona.",
    zone: municipality || "Costa Brava",
    maxLeads: validLeads,
    maxDepth: validDepth,
    municipalities: municipality ? [municipality] : undefined,
    sectors: sector ? [sector] : undefined,
  };

  const plan = requested ? buildPlan(goal) : null;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Plan de investigación</h1>
        <p className="text-sm text-text-secondary">
          El planificador decide qué investigar y en qué orden, y justifica cada elección. Esta
          página <strong>solo muestra el plan</strong>: no lanza ninguna consulta ni escribe nada.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Objetivo</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="text-text-secondary">Qué quieres conseguir</span>
              <input
                type="text"
                name="statement"
                defaultValue={statement}
                placeholder="Encuentra restaurantes de Blanes que necesiten web"
                className="rounded-lg border border-border-hairline bg-surface-2 px-3 py-2 text-text-primary"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-text-secondary">Municipio</span>
              <select
                name="municipality"
                defaultValue={municipality}
                className="rounded-lg border border-border-hairline bg-surface-2 px-3 py-2 text-text-primary"
              >
                <option value="">Toda la Costa Brava</option>
                {COSTA_BRAVA_MUNICIPALITIES.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-text-secondary">Sector</span>
              <select
                name="sector"
                defaultValue={sector}
                className="rounded-lg border border-border-hairline bg-surface-2 px-3 py-2 text-text-primary"
              >
                <option value="">Todos los sectores</option>
                {COSTA_BRAVA_SECTORS.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-text-secondary">Leads máximos</span>
              <input
                type="number"
                name="maxLeads"
                min={1}
                max={60}
                defaultValue={validLeads}
                className="rounded-lg border border-border-hairline bg-surface-2 px-3 py-2 text-text-primary"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-text-secondary">Profundidad</span>
              <select
                name="depth"
                defaultValue={validDepth}
                className="rounded-lg border border-border-hairline bg-surface-2 px-3 py-2 text-text-primary"
              >
                {Object.values(DEPTH_PRESETS).map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>

            <input type="hidden" name="plan" value="1" />
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="rounded-lg bg-accent-450 px-4 py-2 text-sm font-medium text-black"
              >
                Generar plan
              </button>
            </div>
          </form>
        </CardContent>
      </Card>

      {plan && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Resumen del plan</CardTitle>
              <Badge tone={planUsesHistory(plan) ? "good" : "neutral"}>
                {planUsesHistory(plan) ? "Apoyado en historial" : "Sin historial suficiente"}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-text-secondary">
              <p>
                <strong className="text-text-primary">{plan.targets.length}</strong> objetivos ·
                hasta <strong className="text-text-primary">{plan.stop.maxLeads}</strong> leads ·
                profundidad {DEPTH_PRESETS[plan.depth].label.toLowerCase()}.
              </p>
              <p>
                Peticiones estimadas:{" "}
                <span className="tabular-nums text-text-primary">{plan.estimatedRequests}</span> ·
                coste estimado:{" "}
                <span className="tabular-nums text-text-primary">
                  {plan.estimatedCostUsd.toFixed(2)} $
                </span>{" "}
                (las fuentes de descubrimiento son abiertas y sin coste).
              </p>
              <p>
                Parada: máximo {plan.stop.maxRounds} rondas y {plan.stop.maxRequestsPerBusiness}{" "}
                peticiones por negocio, {Math.round(plan.stop.maxDurationMs / 60000)} minutos de
                límite, suficiente al {Math.round(plan.stop.sufficientConfidence * 100)}% de
                evidencia.
              </p>
              <p className="text-xs text-text-muted">
                Nada de esto se ha ejecutado. El plan es una propuesta que puedes revisar antes de
                lanzar la investigación.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Objetivos, en orden de ejecución</CardTitle>
            </CardHeader>
            <CardContent>
              {plan.targets.length === 0 ? (
                <p className="text-sm text-text-secondary">
                  El ámbito seleccionado no tiene ningún subsector cubierto por las fuentes abiertas.
                </p>
              ) : (
                <ol className="divide-y divide-border-hairline">
                  {plan.targets.map((target) => (
                    <li
                      key={`${target.municipality}-${target.subsector}`}
                      className="flex flex-col gap-1 py-3"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm text-text-primary">
                          {target.priority}. {target.subsector} en {target.municipality}
                        </span>
                        <span className="flex items-center gap-2 text-xs text-text-muted">
                          <span className="tabular-nums">hasta {target.maxBusinesses}</span>
                          <Badge tone={BASIS_LABEL[target.justification.basis].tone}>
                            {BASIS_LABEL[target.justification.basis].label}
                          </Badge>
                        </span>
                      </div>
                      <p className="text-xs text-text-secondary">{target.justification.reason}</p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Decisiones y su fundamento</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border-hairline">
                {plan.decisions.map((decision, index) => (
                  <li key={`${decision.decision}-${index}`} className="flex flex-col gap-1 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm text-text-primary">{decision.decision}</span>
                      <span className="flex items-center gap-2 text-xs text-text-muted">
                        {decision.sampleSize > 0 && (
                          <span className="tabular-nums">n={decision.sampleSize}</span>
                        )}
                        <Badge tone={BASIS_LABEL[decision.basis].tone}>
                          {BASIS_LABEL[decision.basis].label}
                        </Badge>
                      </span>
                    </div>
                    <p className="text-xs text-text-secondary">{decision.reason}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ejecución</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-text-secondary">
              <p>
                El plan no se lanza desde aquí. Para ejecutar un objetivo concreto usa el formulario
                de la página de investigación, que aplica los mismos límites de coste y de número de
                negocios.
              </p>
              <Link
                href="/dashboard/research"
                className="inline-block rounded-lg border border-border-hairline px-4 py-2 text-sm text-text-primary hover:bg-surface-2"
              >
                Ir a lanzar una investigación
              </Link>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

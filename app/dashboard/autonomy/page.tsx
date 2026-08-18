import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { memoryStatus } from "@/lib/memory/bootstrap";
import { checkAutonomySchema } from "@/lib/supabase/admin";
import { queryEvents } from "@/lib/memory/research-memory";
import { baseWinRate, predictiveSignals } from "@/lib/memory/predictive";
import { buildLearningReport } from "@/lib/memory/learning";
import { errorPatterns, openErrors } from "@/lib/memory/error-memory";
import { listExperiments } from "@/lib/memory/experiments";
import { HARD_CONSTRAINTS, AUTONOMOUS_AREAS } from "@/lib/memory/hard-constraints";
import { listCycles, lastCycle } from "@/backend/planner/autonomous-cycle";
import { chooseNextObjective, coverage, DEFAULT_CYCLE_BUDGET } from "@/backend/planner/next-objective";
import { pendingAdjustments } from "@/backend/planner/apply-learning";
import { RunCycleButton } from "./RunCycleButton";

/**
 * FASE 5.8 — the autonomy dashboard.
 *
 * Answers, in order: what is it doing, what will it do next, why did it pick
 * that, what has it learned, which sources/sectors/municipalities work, what
 * has gone wrong, what is it testing, and what did it decide on its own.
 *
 * Every number here carries its sample size. A dashboard that shows "Blanes:
 * 80% de cierre" without saying it is four leads is worse than no dashboard,
 * because it looks like knowledge.
 */

export const dynamic = "force-dynamic";

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default async function AutonomyPage() {
  const [status, schema] = await Promise.all([memoryStatus(), checkAutonomySchema()]);

  const last = lastCycle();
  const cycles = listCycles();
  // The next objective is computed, not stored: this is exactly what the next
  // cycle would choose if it started now.
  const next = chooseNextObjective();
  const learning = buildLearningReport();
  const signals = predictiveSignals();
  const base = baseWinRate();
  const adjustments = pendingAdjustments();
  const experiments = listExperiments();
  const errors = openErrors();
  const patterns = errorPatterns();
  const decisions = queryEvents({ type: "DECISION_MADE" }).slice(-12).reverse();
  const swept = coverage().filter((entry) => entry.queries > 0);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Autonomía</h1>
        <p className="text-sm text-text-secondary">
          Qué está haciendo el sistema, qué hará después y por qué. Cada cifra lleva su tamaño de
          muestra: sin muestra suficiente no hay conclusión, solo una observación.
        </p>
      </div>

      {/* --- Persistencia: lo primero, porque condiciona todo lo demás. ---- */}
      <Card>
        <CardHeader>
          <CardTitle>Persistencia del aprendizaje</CardTitle>
          <Badge tone={status.persistent ? "good" : "warning"}>
            {status.persistent ? "Duradero" : "Solo en memoria"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-text-secondary">
          <p>{status.reason}</p>
          {!status.persistent && (
            <p className="text-xs text-text-muted">
              Todo lo que aprenda se perderá al reiniciar el servidor. Configura{" "}
              <code>SUPABASE_SERVICE_ROLE_KEY</code> y <code>AUTONOMOUS_OWNER_ID</code> para que el
              aprendizaje sea acumulativo.
            </p>
          )}
          <p className="text-xs text-text-muted">{schema.summary}</p>
          {schema.tables && schema.tables.some((table) => !table.present) && (
            <ul className="text-xs text-status-critical">
              {schema.tables
                .filter((table) => !table.present)
                .map((table) => (
                  <li key={table.table}>
                    {table.table}: {table.error}
                  </li>
                ))}
            </ul>
          )}
          {status.lostWrites.length > 0 && (
            <p className="text-xs text-status-critical">
              {status.lostWrites.length} escritura(s) no llegaron a guardarse. La última:{" "}
              {status.lostWrites.at(-1)!.message}
            </p>
          )}
        </CardContent>
      </Card>

      {/* --- 1. Qué está haciendo ahora --------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Qué está haciendo ahora</CardTitle>
          {last && (
            <Badge tone={last.status === "COMPLETED" ? "good" : "critical"}>
              {last.status === "COMPLETED" ? "En reposo" : "Último ciclo falló"}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-text-secondary">
          {last ? (
            <>
              <p>
                Último ciclo ({last.trigger}): <strong>{last.goal.statement}</strong>
              </p>
              <p className="text-xs text-text-muted">
                {last.businessesAnalyzed} negocios analizados · {last.leadsProduced} leads ·{" "}
                {last.targetsExecuted} de {last.targetsPlanned} objetivos ·{" "}
                {Math.round(last.durationMs / 1000)} s · {last.estimatedCostUsd.toFixed(2)} $
              </p>
              <p className="text-xs text-text-muted">{last.stoppedBecause}</p>
              {last.error && <p className="text-xs text-status-critical">{last.error}</p>}
            </>
          ) : (
            <p>Todavía no se ha ejecutado ningún ciclo autónomo.</p>
          )}
          <div className="pt-2">
            <RunCycleButton />
          </div>
        </CardContent>
      </Card>

      {/* --- 2 y 3. Qué investigará después y por qué -------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Qué investigará después, y por qué</CardTitle>
          <Badge tone={next.mode === "exploitation" ? "good" : "neutral"}>
            {
              {
                exploitation: "Explotación",
                exploration: "Exploración",
                revisit: "Revisión",
                explicit: "Petición explícita",
              }[next.mode]
            }
          </Badge>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-text-secondary">
          <p className="text-text-primary">{next.goal.statement}</p>
          <p>{next.reason}</p>
          <p className="text-xs text-text-muted">
            Muestra en la que se apoya:{" "}
            <strong className="tabular-nums">
              {next.sampleSize === 0 ? "ninguna todavía" : `${next.sampleSize} observaciones`}
            </strong>{" "}
            · Presupuesto por ciclo: {DEFAULT_CYCLE_BUDGET.municipalitiesPerCycle} municipios,{" "}
            {DEFAULT_CYCLE_BUDGET.maxLeads} leads,{" "}
            {Math.round(DEFAULT_CYCLE_BUDGET.maxDurationMs / 60000)} min.
          </p>
        </CardContent>
      </Card>

      {/* --- 4. Qué ha aprendido de resultados reales -------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Qué ha aprendido de las ventas reales</CardTitle>
          <Badge tone={base.total > 0 ? "neutral" : "warning"}>
            {base.total} desenlace(s)
          </Badge>
        </CardHeader>
        <CardContent>
          {base.total === 0 ? (
            <EmptyState title="Todavía no hay ningún resultado real registrado." description="Marca leads como Cliente, Perdido o No interesado en el pipeline: es la única verdad de campo con la que el sistema puede aprender qué predice una venta." />
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-text-secondary">
                Tasa base de cierre: <strong className="tabular-nums">{pct(base.rate)}</strong> (
                {base.won} de {base.total}). Toda señal se compara contra esto.
              </p>
              <ul className="divide-y divide-border-hairline">
                {signals.slice(0, 8).map((signal) => (
                  <li key={signal.signal} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <span className="text-text-secondary">{signal.statement}</span>
                    <Badge tone={signal.predictive ? "good" : "neutral"}>
                      {signal.predictive ? "Predictiva" : signal.sampleSufficient ? "Sin ventaja" : "Muestra corta"}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* --- 5. Fuentes ------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Qué fuentes están funcionando mejor</CardTitle>
        </CardHeader>
        <CardContent>
          {learning.sources.length === 0 ? (
            <EmptyState title="Ninguna fuente se ha consultado todavía." />
          ) : (
            <ul className="divide-y divide-border-hairline">
              {learning.sources.map((source) => (
                <li key={source.source} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                  <span className="text-text-primary">{source.source}</span>
                  <span className="flex items-center gap-3 text-xs text-text-muted">
                    <span className="tabular-nums">
                      {source.yieldPerQuery.toFixed(1)} aprovechables/consulta
                    </span>
                    <span className="tabular-nums">{pct(source.reliability)} fiabilidad</span>
                    <span className="tabular-nums">n={source.queries}</span>
                    <Badge tone={source.sampleSufficient ? "good" : "neutral"}>
                      {source.sampleSufficient ? "Muestra suficiente" : "Se observa, no se actúa"}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* --- 6 y 7. Sectores y municipios -------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Qué municipios y sectores rinden mejor</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {learning.strategies.length === 0 ? (
            <EmptyState title="Sin barridos suficientes para comparar municipios." />
          ) : (
            <ul className="divide-y divide-border-hairline">
              {learning.strategies.slice(0, 8).map((strategy) => (
                <li
                  key={`${strategy.municipality}-${strategy.sector ?? "todos"}`}
                  className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm"
                >
                  <span className="text-text-primary">
                    {strategy.municipality}
                    {strategy.sector ? ` · ${strategy.sector}` : ""}
                  </span>
                  <span className="flex items-center gap-3 text-xs text-text-muted">
                    <span className="tabular-nums">
                      {strategy.yieldPerQuery.toFixed(1)} aprovechables/consulta
                    </span>
                    <span className="tabular-nums">n={strategy.queries}</span>
                    <Badge tone={strategy.sampleSufficient ? "good" : "neutral"}>
                      {strategy.sampleSufficient ? "Accionable" : "Informativo"}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-text-muted">
            Cobertura: {swept.length} municipio(s) barridos de {coverage().length}.
          </p>
        </CardContent>
      </Card>

      {/* --- 8. Errores -------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Qué errores ha detectado</CardTitle>
          <Badge tone={errors.length === 0 ? "good" : "warning"}>{errors.length} sin cerrar</Badge>
        </CardHeader>
        <CardContent>
          {patterns.length === 0 ? (
            <EmptyState title="No hay errores registrados." />
          ) : (
            <ul className="divide-y divide-border-hairline">
              {patterns.map((pattern) => (
                <li key={pattern.category} className="flex flex-col gap-1 py-2 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-text-primary">{pattern.category}</span>
                    <span className="text-xs text-text-muted tabular-nums">
                      {pattern.count} caso(s), {pattern.open} sin cerrar
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary">{pattern.lesson}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* --- 9. Experimentos --------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Qué experimentos están activos</CardTitle>
        </CardHeader>
        <CardContent>
          {experiments.length === 0 ? (
            <EmptyState title="Ningún experimento en curso." description="El sistema propone uno cuando encuentra dos opciones lo bastante parecidas como para no poder decidir sin medirlas." />
          ) : (
            <ul className="divide-y divide-border-hairline">
              {experiments.map((experiment) => (
                <li key={experiment.id} className="flex flex-col gap-1 py-2 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-text-primary">{experiment.hypothesis}</span>
                    <span className="flex items-center gap-2 text-xs text-text-muted">
                      <span>{experiment.targetArea}</span>
                      <Badge tone={experiment.constraint.allowed ? "neutral" : "warning"}>
                        {experiment.constraint.allowed ? "Puede aplicarse solo" : "Requiere aprobación"}
                      </Badge>
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary">
                    {experiment.variants
                      .map((variant) => `${variant.description}: ${variant.observations.length} obs.`)
                      .join(" · ")}
                    {experiment.conclusion ? ` — ${experiment.conclusion.summary}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* --- 10. Decisiones automáticas ---------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Qué ha decidido por su cuenta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-text-muted">
              Ajustes que aplicaría ahora mismo
            </p>
            {adjustments.length === 0 ? (
              <p className="text-sm text-text-secondary">
                Ninguno: todavía no hay evidencia suficiente para cambiar ninguna prioridad.
              </p>
            ) : (
              <ul className="divide-y divide-border-hairline">
                {adjustments.map((adjustment, index) => (
                  <li key={`${adjustment.area}-${index}`} className="flex flex-col gap-1 py-2 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-text-primary">{adjustment.effect}</span>
                      <span className="flex items-center gap-2 text-xs text-text-muted">
                        <span className="tabular-nums">n={adjustment.sampleSize}</span>
                        <Badge tone={adjustment.applied ? "good" : "neutral"}>
                          {adjustment.applied ? "Se aplica" : "No se aplica"}
                        </Badge>
                      </span>
                    </div>
                    <p className="text-xs text-text-secondary">{adjustment.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-text-muted">
              Últimas decisiones registradas
            </p>
            {decisions.length === 0 ? (
              <p className="text-sm text-text-secondary">Sin decisiones registradas todavía.</p>
            ) : (
              <ul className="divide-y divide-border-hairline">
                {decisions.map((decision) => (
                  <li key={decision.id} className="py-2 text-sm text-text-secondary">
                    <span className="text-xs text-text-muted tabular-nums">
                      {decision.at.slice(0, 16).replace("T", " ")}
                    </span>{" "}
                    {decision.summary}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {/* --- Los límites, siempre visibles ------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Lo que el sistema NO puede cambiar por su cuenta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ul className="space-y-2">
            {HARD_CONSTRAINTS.map((constraint) => (
              <li key={constraint.area} className="text-text-secondary">
                <strong className="text-text-primary">{constraint.area}</strong>: {constraint.statement}
              </li>
            ))}
          </ul>
          <p className="text-xs text-text-muted">
            Áreas en las que sí puede decidir solo: {AUTONOMOUS_AREAS.join(", ")}. Cualquier área no
            listada se rechaza por defecto.
          </p>
        </CardContent>
      </Card>

      {cycles.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Ciclos recientes</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border-hairline">
              {cycles.map((cycle) => (
                <li key={cycle.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                  <span className="text-text-secondary">{cycle.goal.statement}</span>
                  <span className="flex items-center gap-3 text-xs text-text-muted">
                    <span className="tabular-nums">{cycle.leadsProduced} leads</span>
                    <span className="tabular-nums">{Math.round(cycle.durationMs / 1000)} s</span>
                    <Badge tone={cycle.status === "COMPLETED" ? "good" : "critical"}>
                      {cycle.selectionMode}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

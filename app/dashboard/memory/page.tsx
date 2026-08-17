import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { memoryStats, queryEvents } from "@/lib/memory/research-memory";
import { buildLearningReport } from "@/lib/memory/learning";
import { errorPatterns, listErrors } from "@/lib/memory/error-memory";
import { listExperiments, pendingApproval } from "@/lib/memory/experiments";
import { HARD_CONSTRAINTS } from "@/lib/memory/hard-constraints";

export default async function MemoryPage() {
  const stats = memoryStats();
  const learning = buildLearningReport();
  const errors = listErrors();
  const patterns = errorPatterns();
  const experiments = listExperiments();
  const awaiting = pendingApproval();
  const recent = queryEvents().slice(-15).reverse();

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Memoria y aprendizaje</h1>
        <p className="text-sm text-text-secondary">
          Qué ha investigado el sistema, qué ha aprendido de sus resultados y qué errores conoce.
          Vive en memoria del proceso: se reinicia con el servidor.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Estado de la memoria</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {[
            ["Eventos", stats.events],
            ["Investigaciones", stats.runs],
            ["Negocios", stats.businesses],
            ["Resultados reales", stats.outcomes],
            ["Errores detectados", stats.errors],
            ["Correcciones", stats.corrections],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <p className="text-xs text-text-muted">{label}</p>
              <p className="text-lg font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rendimiento de las fuentes</CardTitle>
        </CardHeader>
        <CardContent>
          {learning.sources.length === 0 ? (
            <EmptyState
              title="Todavía no hay datos de fuentes"
              description="Se llenará en cuanto ejecutes una investigación real."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b border-border-hairline text-left text-xs text-text-muted">
                    <th className="py-2 pr-3 font-medium">Fuente</th>
                    <th className="py-2 pr-3 font-medium">Consultas</th>
                    <th className="py-2 pr-3 font-medium">Aprovechables/consulta</th>
                    <th className="py-2 pr-3 font-medium">Fiabilidad</th>
                    <th className="py-2 font-medium">Muestra</th>
                  </tr>
                </thead>
                <tbody>
                  {learning.sources.map((source) => (
                    <tr key={source.source} className="border-b border-border-hairline">
                      <td className="py-2 pr-3 text-text-primary">{source.source}</td>
                      <td className="py-2 pr-3 tabular-nums">{source.queries}</td>
                      <td className="py-2 pr-3 tabular-nums">{source.yieldPerQuery.toFixed(1)}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {Math.round(source.reliability * 100)}%
                      </td>
                      <td className="py-2">
                        <Badge tone={source.sampleSufficient ? "good" : "neutral"}>
                          {source.sampleSufficient ? "Suficiente" : "Insuficiente"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Propuestas de mejora</CardTitle>
          <Badge tone={learning.actionable.length > 0 ? "good" : "neutral"}>
            {learning.actionable.length} aplicables
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          {learning.proposals.length === 0 ? (
            <EmptyState title="Sin propuestas todavía" />
          ) : (
            learning.proposals.map((proposal) => (
              <div key={proposal.statement} className="border-b border-border-hairline pb-3 last:border-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <Badge tone={proposal.applicable ? "good" : "warning"}>
                    {proposal.applicable ? "Aplicable" : "Requiere aprobación"}
                  </Badge>
                  <span className="text-sm text-text-primary">{proposal.statement}</span>
                </div>
                <p className="mt-1 text-xs text-text-secondary">{proposal.evidence}</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  Muestra: {proposal.sampleSize} · {proposal.constraint.reason}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Errores conocidos</CardTitle>
          <Badge tone={errors.some((e) => e.status !== "FIXED") ? "warning" : "good"}>
            {errors.filter((e) => e.status === "FIXED").length}/{errors.length} corregidos
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          {errors.length === 0 ? (
            <EmptyState title="Sin errores registrados" />
          ) : (
            <>
              {errors.map((error) => (
                <div key={error.id} className="border-b border-border-hairline pb-3 last:border-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Badge tone={error.status === "FIXED" ? "good" : "critical"}>{error.status}</Badge>
                    <span className="text-sm text-text-primary">
                      {error.businessName ?? error.category}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-text-secondary">
                    Afirmó: {error.claim} — En realidad: {error.reality}
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">Causa: {error.cause}</p>
                  {error.regressionTest && (
                    <p className="mt-0.5 text-xs text-text-muted">Test: {error.regressionTest}</p>
                  )}
                </div>
              ))}
              <div className="pt-1">
                <p className="mb-1 text-xs text-text-muted">Lecciones</p>
                <ul className="space-y-1 text-xs text-text-secondary">
                  {patterns.map((pattern) => (
                    <li key={pattern.category}>
                      · {pattern.lesson} ({pattern.count} caso{pattern.count === 1 ? "" : "s"})
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Experimentos</CardTitle>
          {awaiting.length > 0 && <Badge tone="warning">{awaiting.length} esperan tu decisión</Badge>}
        </CardHeader>
        <CardContent className="space-y-3">
          {experiments.length === 0 ? (
            <EmptyState
              title="Sin experimentos"
              description="El sistema puede probar variantes de búsqueda y comparar cuál produce más negocios aprovechables."
            />
          ) : (
            experiments.map((experiment) => (
              <div key={experiment.id} className="border-b border-border-hairline pb-3 last:border-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <Badge tone="neutral">{experiment.status}</Badge>
                  <span className="text-sm text-text-primary">{experiment.hypothesis}</span>
                </div>
                {experiment.conclusion && (
                  <p className="mt-1 text-xs text-text-secondary">{experiment.conclusion.summary}</p>
                )}
                <p className="mt-0.5 text-xs text-text-muted">
                  Área: {experiment.targetArea} · {experiment.constraint.reason}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reglas que el aprendizaje no puede tocar</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-xs">
            {HARD_CONSTRAINTS.map((constraint) => (
              <li key={constraint.area}>
                <span className="text-text-primary">{constraint.statement}</span>
                <span className="block text-text-muted">{constraint.rationale}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Últimos eventos</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-xs">
              {recent.map((event) => (
                <li key={event.id} className="flex flex-wrap gap-2">
                  <Badge tone="neutral">{event.type}</Badge>
                  <span className="text-text-secondary">{event.summary}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

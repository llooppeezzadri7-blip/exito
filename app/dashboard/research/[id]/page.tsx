import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun } from "@/backend/research/run-store";
import { DEPTH_PRESETS } from "@/backend/research/types";
import { ProgressView } from "./ProgressView";
import { ResultsTable } from "./ResultsTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { buttonVariants } from "@/components/ui/Button";

export default async function ResearchRunPage(props: PageProps<"/dashboard/research/[id]">) {
  const { id } = await props.params;
  const run = getRun(id);

  if (!run) notFound();

  const preset = DEPTH_PRESETS[run.config.depth];
  const finished = run.status !== "RUNNING";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {run.config.subsector ?? run.config.sector ?? "Todos los sectores"} ·{" "}
            {run.config.municipality}
          </h1>
          <p className="text-sm text-text-secondary">
            {preset.label} · máximo {run.config.maxBusinesses} negocios · iniciada el{" "}
            {new Date(run.startedAt).toLocaleString("es-ES")}
          </p>
        </div>
        <Link href="/dashboard/research" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          ← Volver
        </Link>
      </div>

      <ProgressView
        runId={run.id}
        initial={{
          status: run.status,
          steps: run.steps,
          resultCount: run.results.length,
          issueCount: run.issues.length,
          error: run.error,
        }}
      />

      {finished && run.results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Top oportunidades</CardTitle>
            <div className="flex gap-2">
              <a
                href={`/dashboard/research/${run.id}/export?format=csv`}
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                Exportar CSV
              </a>
              <a
                href={`/dashboard/research/${run.id}/export?format=json`}
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                Exportar JSON
              </a>
            </div>
          </CardHeader>
          <CardContent>
            <ResultsTable results={run.results} />
          </CardContent>
        </Card>
      )}

      {finished && run.results.length === 0 && run.status === "COMPLETED" && (
        <Card>
          <CardContent>
            <p className="text-sm text-text-secondary">
              La investigación terminó sin resultados nuevos. Puede que todos los negocios
              encontrados ya estuvieran en la base de datos: revisa las incidencias.
            </p>
          </CardContent>
        </Card>
      )}

      {run.issues.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Incidencias</CardTitle>
            <Badge tone="warning">{run.issues.length}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-text-muted">
              Fallos que no detuvieron la investigación. Cada uno queda registrado para poder
              reintentarlo.
            </p>
            <ul className="space-y-1.5 text-xs">
              {run.issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`} className="flex flex-wrap gap-2">
                  <Badge tone="neutral">{issue.code}</Badge>
                  <span className="text-text-secondary">
                    {issue.businessName ? `${issue.businessName}: ` : ""}
                    {issue.message}
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

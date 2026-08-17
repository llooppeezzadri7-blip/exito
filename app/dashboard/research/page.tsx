import Link from "next/link";
import { ResearchForm } from "./ResearchForm";
import { listRuns } from "@/backend/research/run-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { hasPageSpeed } from "@/lib/config/env";
import { DEPTH_PRESETS } from "@/backend/research/types";

export default async function ResearchPage() {
  const runs = listRuns();

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Investigación de mercado</h1>
        <p className="text-sm text-text-secondary">
          Descubre negocios reales de la Costa Brava, analiza su presencia digital y ordénalos por
          oportunidad comercial.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fuentes de descubrimiento</CardTitle>
          <Badge tone="good">Sin claves ni coste</Badge>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-text-secondary">
          <p>
            Los negocios se descubren en <strong>OpenStreetMap</strong> (vía Overpass) y, para
            alojamientos, en el <strong>Registre de Turisme de Catalunya</strong>. Ambas son fuentes
            abiertas: no necesitan API key ni cuenta de facturación.
          </p>
          <p>
            Un negocio hallado por una sola fuente queda como <strong>PROBABLE</strong>. Para pasar a{" "}
            <strong>VERIFICADO</strong> hacen falta dos fuentes independientes que coincidan. Si se
            contradicen, queda <strong>NO_VERIFICADO</strong> hasta resolverlo.
          </p>
          {!hasPageSpeed && (
            <p className="text-xs text-text-muted">
              Sin <code>GOOGLE_PAGESPEED_API_KEY</code>, las métricas de Lighthouse se marcan como no
              disponibles en lugar de estimarse.
            </p>
          )}
        </CardContent>
      </Card>

      <ResearchForm />

      <Card>
        <CardHeader>
          <CardTitle>Investigaciones anteriores</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <EmptyState title="Todavía no has lanzado ninguna investigación." />
          ) : (
            <ul className="divide-y divide-border-hairline">
              {runs.map((run) => (
                <li key={run.id} className="py-3">
                  <Link
                    href={`/dashboard/research/${run.id}`}
                    className="flex flex-wrap items-baseline justify-between gap-2 hover:opacity-80"
                  >
                    <span className="text-sm text-text-primary">
                      {run.config.subsector ?? run.config.sector ?? "Todos los sectores"} ·{" "}
                      {run.config.municipality}
                    </span>
                    <span className="flex items-center gap-3 text-xs text-text-muted">
                      <span>{DEPTH_PRESETS[run.config.depth].label}</span>
                      <span className="tabular-nums">{run.results.length} resultados</span>
                      <Badge
                        tone={
                          run.status === "COMPLETED"
                            ? "good"
                            : run.status === "FAILED"
                              ? "critical"
                              : "warning"
                        }
                      >
                        {run.status}
                      </Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

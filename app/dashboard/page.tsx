import Link from "next/link";
import { Flame, Wallet, TrendingUp, Plus } from "lucide-react";
import { getRepository } from "@/lib/database";
import { StatTile } from "@/components/ui/StatTile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge, scoreBucket } from "@/components/ui/Badge";
import { buttonVariants } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PipelineChart } from "@/components/dashboard/PipelineChart";
import { formatCurrencyEUR, formatNumber, formatRelativeDate } from "@/lib/utils/format";

export default async function DashboardPage() {
  const repo = await getRepository();
  const [kpis, prospects, jobs, leadsByStage] = await Promise.all([
    repo.getDashboardKpis(),
    repo.listBusinesses(),
    repo.listRecentJobs(5),
    repo.listLeadsByStage(),
  ]);

  const topProspects = prospects.slice(0, 6);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-text-secondary">
            Oportunidades comerciales detectadas hoy en tu cartera de prospección.
          </p>
        </div>
        <Link href="/dashboard/prospects/new" className={buttonVariants()}>
          <Plus className="h-4 w-4" />
          Nueva búsqueda
        </Link>
      </div>

      {/* Headline row — mirrors the brief's "OPPORTUNITIES TODAY" example */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          label="Leads de alta prioridad"
          value={formatNumber(kpis.hot_leads)}
          icon={<Flame className="h-4 w-4" />}
          emphasis
        />
        <StatTile
          label="Valor potencial"
          value={formatCurrencyEUR(kpis.potential_value_eur)}
          icon={<Wallet className="h-4 w-4" />}
          emphasis
        />
        <StatTile
          label="Conversión estimada"
          value={`${kpis.conversion_rate}%`}
          icon={<TrendingUp className="h-4 w-4" />}
          emphasis
        />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Negocios encontrados" value={formatNumber(kpis.businesses_found)} />
        <StatTile label="Negocios analizados" value={formatNumber(kpis.businesses_analyzed)} />
        <StatTile label="Oportunidades nuevas" value={formatNumber(kpis.new_opportunities)} />
        <StatTile label="Auditorías generadas" value={formatNumber(kpis.audits_generated)} />
        <StatTile label="Demos creadas" value={formatNumber(kpis.demos_generated)} />
        <StatTile label="Propuestas enviadas" value={formatNumber(kpis.proposals_sent)} />
        <StatTile label="Clientes ganados" value={formatNumber(kpis.clients_won)} />
        <StatTile label="Valor vendido" value={formatCurrencyEUR(kpis.won_value_eur)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Mejores prospectos</CardTitle>
            <Link href="/dashboard/prospects" className="text-xs font-medium text-accent-500 hover:underline">
              Ver todos
            </Link>
          </CardHeader>
          <CardContent>
            {topProspects.length === 0 ? (
              <EmptyState
                title="Todavía no hay negocios prospectados"
                description="Lanza tu primera búsqueda de discovery para empezar a encontrar oportunidades."
                action={
                  <Link href="/dashboard/prospects/new" className={buttonVariants()}>
                    Nueva búsqueda
                  </Link>
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-hairline text-left text-xs text-text-muted">
                      <th className="pb-2 font-medium">Negocio</th>
                      <th className="pb-2 font-medium">Sector</th>
                      <th className="pb-2 font-medium">Ciudad</th>
                      <th className="pb-2 font-medium text-right">Lead score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProspects.map((b) => {
                      const leadScore = b.score?.lead_score ?? 0;
                      const bucket = scoreBucket(leadScore);
                      return (
                        <tr key={b.id} className="border-b border-border-hairline last:border-0">
                          <td className="py-2.5">
                            <Link
                              href={`/dashboard/prospects/${b.id}`}
                              className="font-medium text-text-primary hover:text-accent-500"
                            >
                              {b.name}
                            </Link>
                            <div className="text-xs text-text-muted">{formatRelativeDate(b.last_analyzed_at)}</div>
                          </td>
                          <td className="py-2.5 text-text-secondary">{b.sector ?? "—"}</td>
                          <td className="py-2.5 text-text-secondary">{b.city ?? "—"}</td>
                          <td className="py-2.5 text-right">
                            <Badge tone={bucket.tone}>
                              {leadScore}/100 · {bucket.label}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Pipeline por etapa</CardTitle>
          </CardHeader>
          <CardContent>
            <PipelineChart leadsByStage={leadsByStage} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Jobs recientes</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-text-secondary">No hay trabajos en segundo plano todavía.</p>
          ) : (
            <ul className="divide-y divide-border-hairline">
              {jobs.map((job) => (
                <li key={job.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div>
                    <span className="font-medium text-text-primary">{job.type}</span>
                    <span className="ml-2 text-text-muted">
                      {job.progress_current}/{job.progress_total || "?"}
                    </span>
                  </div>
                  <Badge tone={job.status === "COMPLETED" ? "good" : job.status === "FAILED" ? "critical" : "accent"}>
                    {job.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

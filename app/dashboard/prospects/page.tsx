import Link from "next/link";
import { Plus } from "lucide-react";
import { getRepository } from "@/lib/database";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge, scoreBucket } from "@/components/ui/Badge";
import { buttonVariants } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatRelativeDate } from "@/lib/utils/format";

export default async function ProspectsPage(props: PageProps<"/dashboard/prospects">) {
  const searchParams = await props.searchParams;
  const search = typeof searchParams.q === "string" ? searchParams.q : undefined;

  const repo = await getRepository();
  const prospects = await repo.listBusinesses({ search });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Prospectos</h1>
          <p className="text-sm text-text-secondary">{prospects.length} negocios en tu cartera</p>
        </div>
        <Link href="/dashboard/prospects/new" className={buttonVariants()}>
          <Plus className="h-4 w-4" />
          Nueva búsqueda
        </Link>
      </div>

      <form className="max-w-sm">
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Buscar por nombre..."
          className="h-10 w-full rounded-lg border border-border-hairline bg-surface-1 px-3 text-sm outline-none focus:border-accent-450"
        />
      </form>

      <Card>
        <CardContent className="p-0">
          {prospects.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No se han encontrado negocios"
                description="Lanza una búsqueda de discovery o ajusta el filtro de búsqueda."
                action={
                  <Link href="/dashboard/prospects/new" className={buttonVariants()}>
                    Nueva búsqueda
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-hairline text-left text-xs text-text-muted">
                    <th className="px-5 py-3 font-medium">Negocio</th>
                    <th className="px-5 py-3 font-medium">Sector</th>
                    <th className="px-5 py-3 font-medium">Ciudad</th>
                    <th className="px-5 py-3 font-medium">Web</th>
                    <th className="px-5 py-3 font-medium">Rating</th>
                    <th className="px-5 py-3 text-right font-medium">Lead score</th>
                  </tr>
                </thead>
                <tbody>
                  {prospects.map((b) => {
                    const leadScore = b.score?.lead_score ?? 0;
                    const bucket = scoreBucket(leadScore);
                    return (
                      <tr key={b.id} className="border-b border-border-hairline last:border-0 hover:bg-surface-2/50">
                        <td className="px-5 py-3">
                          <Link
                            href={`/dashboard/prospects/${b.id}`}
                            className="font-medium text-text-primary hover:text-accent-500"
                          >
                            {b.name}
                          </Link>
                          <div className="text-xs text-text-muted">{formatRelativeDate(b.last_analyzed_at)}</div>
                        </td>
                        <td className="px-5 py-3 text-text-secondary">{b.sector ?? "—"}</td>
                        <td className="px-5 py-3 text-text-secondary">{b.city ?? "—"}</td>
                        <td className="px-5 py-3 text-text-secondary">
                          {b.website_url ? "Sí" : <span className="text-status-critical">Sin web</span>}
                        </td>
                        <td className="px-5 py-3 text-text-secondary">
                          {b.rating ? `${b.rating} (${b.review_count ?? 0})` : "—"}
                        </td>
                        <td className="px-5 py-3 text-right">
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
    </div>
  );
}

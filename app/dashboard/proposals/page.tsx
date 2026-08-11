import Link from "next/link";
import { getRepository } from "@/lib/database";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCurrencyEUR } from "@/lib/utils/format";

export default async function ProposalsPage() {
  const repo = await getRepository();
  const [proposals, businesses] = await Promise.all([repo.listProposals(), repo.listBusinesses()]);
  const businessById = new Map(businesses.map((b) => [b.id, b]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Propuestas</h1>
        <p className="text-sm text-text-secondary">{proposals.length} propuestas generadas</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {proposals.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Todavía no se ha generado ninguna propuesta"
                description='Abre un prospecto y pulsa "Generar propuesta" — se redacta con Claude a partir de los servicios y precios configurados en tu agencia (requiere ANTHROPIC_API_KEY).'
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-hairline text-left text-xs text-text-muted">
                    <th className="px-5 py-3 font-medium">Negocio</th>
                    <th className="px-5 py-3 font-medium">Propuesta</th>
                    <th className="px-5 py-3 font-medium">Estado</th>
                    <th className="px-5 py-3 font-medium">Fecha</th>
                    <th className="px-5 py-3 text-right font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {proposals.map((p) => (
                    <tr key={p.id} className="border-b border-border-hairline last:border-0 hover:bg-surface-2/50">
                      <td className="px-5 py-3">
                        <Link href={`/dashboard/prospects/${p.business_id}`} className="font-medium text-text-primary hover:text-accent-500">
                          {businessById.get(p.business_id)?.name ?? "—"}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-text-secondary">{p.title}</td>
                      <td className="px-5 py-3">
                        <Badge tone="neutral">{p.status}</Badge>
                      </td>
                      <td className="px-5 py-3 text-text-secondary">{new Date(p.created_at).toLocaleDateString("es-ES")}</td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {p.price_total != null ? formatCurrencyEUR(p.price_total) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

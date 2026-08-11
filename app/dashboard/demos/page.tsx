import Link from "next/link";
import { getRepository } from "@/lib/database";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function DemosPage() {
  const repo = await getRepository();
  const [demos, businesses] = await Promise.all([repo.listDemos(), repo.listBusinesses()]);
  const businessById = new Map(businesses.map((b) => [b.id, b]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Demos</h1>
        <p className="text-sm text-text-secondary">{demos.length} demos generadas — nunca se publican automáticamente</p>
      </div>

      {demos.length === 0 ? (
        <Card>
          <CardContent className="p-5">
            <EmptyState
              title="Todavía no se ha generado ninguna demo"
              description='Abre un prospecto y pulsa "Generar demo" — usa solo datos reales del negocio, con placeholders para lo que falte (fotos, testimonios). Requiere ANTHROPIC_API_KEY.'
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {demos.map((d) => {
            const business = businessById.get(d.business_id);
            const content = d.content as { copy?: { headline?: string } };
            return (
              <Link key={d.id} href={`/dashboard/prospects/${d.business_id}`}>
                <Card className="h-full transition-colors hover:border-accent-450/50">
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-text-primary">{business?.name ?? "—"}</span>
                      <Badge tone="neutral">{d.status}</Badge>
                    </div>
                    {content.copy?.headline && <p className="text-sm text-text-secondary">{content.copy.headline}</p>}
                    <p className="text-xs text-text-muted">{new Date(d.created_at).toLocaleDateString("es-ES")}</p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

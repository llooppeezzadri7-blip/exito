import { getRepository } from "@/lib/database";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCurrencyEUR, formatNumber } from "@/lib/utils/format";

function formatUsd(value: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value);
}

export default async function ReportsPage() {
  const repo = await getRepository();
  const [kpis, usage, leadsByStage] = await Promise.all([
    repo.getDashboardKpis(),
    repo.listApiUsage(),
    repo.listLeadsByStage(),
  ]);

  const totalCost = usage.reduce((sum, u) => sum + u.estimated_cost_usd, 0);
  const byOperation = usage.reduce<Record<string, { count: number; cost: number }>>((acc, u) => {
    const key = `${u.service}:${u.operation}`;
    acc[key] ??= { count: 0, cost: 0 };
    acc[key].count += 1;
    acc[key].cost += u.estimated_cost_usd;
    return acc;
  }, {});

  const totalLeads = Object.values(leadsByStage).reduce((sum, l) => sum + l.length, 0);
  const won = leadsByStage.WON?.length ?? 0;
  const costPerLead = totalLeads > 0 ? totalCost / totalLeads : 0;
  const costPerClient = won > 0 ? totalCost / won : 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Informes y control de costes</h1>
        <p className="text-sm text-text-secondary">Analítica de la agencia y coste real de las llamadas a IA (§25-26).</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Negocios encontrados" value={formatNumber(kpis.businesses_found)} />
        <StatTile label="Auditorías" value={formatNumber(kpis.audits_generated)} />
        <StatTile label="Demos" value={formatNumber(kpis.demos_generated)} />
        <StatTile label="Propuestas enviadas" value={formatNumber(kpis.proposals_sent)} />
        <StatTile label="Clientes ganados" value={formatNumber(won)} />
        <StatTile label="Valor vendido" value={formatCurrencyEUR(kpis.won_value_eur)} />
        <StatTile label="Tasa de conversión" value={`${kpis.conversion_rate}%`} />
        <StatTile label="Coste total IA" value={formatUsd(totalCost)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cost control</CardTitle>
        </CardHeader>
        <CardContent>
          {usage.length === 0 ? (
            <EmptyState
              title="Todavía no hay coste registrado"
              description="Cada auditoría, propuesta o demo generada con IA registra aquí sus tokens reales y coste estimado (requiere ANTHROPIC_API_KEY configurada)."
            />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div className="rounded-lg border border-border-hairline p-3 text-center">
                  <div className="text-xl font-semibold tabular-nums">{formatUsd(costPerLead)}</div>
                  <div className="text-xs text-text-secondary">Coste por lead</div>
                </div>
                <div className="rounded-lg border border-border-hairline p-3 text-center">
                  <div className="text-xl font-semibold tabular-nums">
                    {kpis.audits_generated > 0 ? formatUsd(totalCost / kpis.audits_generated) : "—"}
                  </div>
                  <div className="text-xs text-text-secondary">Coste por auditoría</div>
                </div>
                <div className="rounded-lg border border-border-hairline p-3 text-center">
                  <div className="text-xl font-semibold tabular-nums">{won > 0 ? formatUsd(costPerClient) : "—"}</div>
                  <div className="text-xs text-text-secondary">Coste por cliente adquirido</div>
                </div>
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-hairline text-left text-xs text-text-muted">
                    <th className="py-2 font-medium">Servicio · operación</th>
                    <th className="py-2 text-right font-medium">Llamadas</th>
                    <th className="py-2 text-right font-medium">Coste estimado</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(byOperation).map(([key, v]) => (
                    <tr key={key} className="border-b border-border-hairline last:border-0">
                      <td className="py-2 text-text-secondary">{key}</td>
                      <td className="py-2 text-right tabular-nums">{v.count}</td>
                      <td className="py-2 text-right tabular-nums">{formatUsd(v.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-text-muted">
                Coste estimado a partir de tokens reales devueltos por la API de Anthropic (input/output) y el precio
                público por modelo — ver lib/costs/pricing.ts. No incluye Google Places / PageSpeed (inactivos).
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { notFound } from "next/navigation";
import { getRepository } from "@/lib/database";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge, scoreBucket } from "@/components/ui/Badge";
import { buttonVariants } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { AnalyzeWebsiteButton } from "./AnalyzeWebsiteButton";
import { RecalculateScoreButton } from "./RecalculateScoreButton";
import { GenerateAuditButton } from "./GenerateAuditButton";

const SCORE_ROWS: { key: "opportunity_score" | "buying_intent_score" | "lead_score"; label: string }[] = [
  { key: "opportunity_score", label: "Opportunity Score" },
  { key: "buying_intent_score", label: "Buying Intent Score" },
  { key: "lead_score", label: "Lead Score" },
];

const BREAKDOWN_LABELS: Record<string, string> = {
  website_quality: "Website Quality",
  seo: "SEO",
  local_seo: "Local SEO",
  performance: "Performance",
  mobile_ux: "Mobile UX",
  conversion: "Conversion",
  competitive_gap: "Competitive Gap",
};

export default async function ProspectDetailPage(props: PageProps<"/dashboard/prospects/[id]">) {
  const { id } = await props.params;
  const repo = await getRepository();
  const business = await repo.getBusiness(id);

  if (!business) notFound();

  const score = business.score;
  const scan = await repo.getLatestWebsiteScan(id);
  const audit = await repo.getLatestAiReport(id);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">{business.name}</h1>
            {score && (
              <Badge tone={scoreBucket(score.lead_score).tone}>
                🔥 Prioridad {Math.round(score.lead_score)}/100
              </Badge>
            )}
          </div>
          <p className="text-sm text-text-secondary">
            {[business.category, business.city, business.country].filter(Boolean).join(" · ") || "Sin datos de ubicación"}
          </p>
        </div>
        <div className="flex gap-2">
          <AnalyzeWebsiteButton businessId={business.id} hasWebsite={Boolean(business.website_url)} />
          <RecalculateScoreButton businessId={business.id} />
          <GenerateAuditButton businessId={business.id} />
          <button className={buttonVariants({ variant: "secondary" })} disabled title="Disponible en la Fase 8">
            Generar propuesta
          </button>
          <button className={buttonVariants()} disabled title="Disponible en la Fase 9">
            Generar demo
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Datos del negocio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Teléfono" value={business.phone} />
            <Row label="Web" value={business.website_url} />
            <Row label="Email" value={business.email} />
            <Row label="Dirección" value={business.address} />
            <Row label="Rating" value={business.rating ? `${business.rating} (${business.review_count ?? 0} reseñas)` : null} />
            <Row label="Fuente" value={business.source} />
            <Row
              label="Último análisis"
              value={business.last_analyzed_at ? new Date(business.last_analyzed_at).toLocaleString("es-ES") : null}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Puntuación</CardTitle>
          </CardHeader>
          <CardContent>
            {!score ? (
              <EmptyState title="Todavía no se ha calculado la puntuación de este negocio." />
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  {SCORE_ROWS.map((row) => (
                    <div key={row.key} className="rounded-lg border border-border-hairline p-3 text-center">
                      <div className="text-2xl font-semibold tabular-nums">{Math.round(score[row.key])}</div>
                      <div className="text-xs text-text-secondary">{row.label}</div>
                    </div>
                  ))}
                </div>
                <div className="space-y-1.5">
                  {Object.entries(score.opportunity_breakdown).map(([key, value]) => (
                    <div key={key} className="flex items-center gap-3 text-xs">
                      <span className="w-32 shrink-0 text-text-secondary">{BREAKDOWN_LABELS[key] ?? key}</span>
                      <div className="h-2 flex-1 rounded bg-surface-2">
                        <div
                          className="h-2 rounded bg-accent-450"
                          style={{ width: `${Math.min(100, Number(value))}%` }}
                        />
                      </div>
                      <span className="w-8 text-right tabular-nums text-text-primary">{Math.round(Number(value))}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Escaneo técnico de la web</CardTitle>
          {scan && (
            <span className="text-xs text-text-muted">{new Date(scan.scanned_at).toLocaleString("es-ES")}</span>
          )}
        </CardHeader>
        <CardContent>
          {!scan ? (
            <EmptyState
              title="Todavía no se ha escaneado la web de este negocio"
              description={
                business.website_url
                  ? 'Pulsa "Analizar web ahora" para comprobar HTTPS, SEO on-page, señales de conversión y disponibilidad de robots.txt/sitemap en tiempo real.'
                  : "Este negocio no tiene una web detectada — señal fuerte de buying intent por sí sola."
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <ScanGroup title="Técnico" data={scan.technical} />
              <ScanGroup title="SEO" data={scan.seo} />
              <ScanGroup title="Conversión" data={scan.conversion} />
              {scan.unavailable_metrics.length > 0 && (
                <div className="sm:col-span-3 text-xs text-text-muted">
                  No disponible en este escaneo: {scan.unavailable_metrics.join(", ")}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Auditoría IA</CardTitle>
          {audit && <span className="text-xs text-text-muted">{new Date(audit.generated_at).toLocaleString("es-ES")}</span>}
        </CardHeader>
        <CardContent>
          {!audit ? (
            <EmptyState
              title="Todavía no hay una auditoría IA generada"
              description='Pulsa "Generar auditoría IA" para convertir los datos técnicos del escaneo en problemas y oportunidades priorizados, redactados por Claude a partir de datos reales — nunca inventados. Requiere ANTHROPIC_API_KEY configurada.'
            />
          ) : (
            <div className="space-y-5 text-sm">
              <p className="text-text-secondary">{audit.summary}</p>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <AuditList title="Problemas detectados" items={audit.problems} tone="critical" />
                <AuditList title="Oportunidades" items={audit.opportunities} tone="good" />
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-text-secondary">Impacto comercial</p>
                <p className="text-text-secondary">{audit.commercial_impact}</p>
              </div>
              <AuditList title="Recomendaciones (por prioridad)" items={audit.priorities} tone="accent" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border-hairline py-1.5 last:border-0">
      <span className="text-text-muted">{label}</span>
      <span className="text-right text-text-primary">{value || "—"}</span>
    </div>
  );
}

function AuditList({ title, items, tone }: { title: string; items: string[]; tone: "critical" | "good" | "accent" }) {
  const dotClass = { critical: "bg-status-critical", good: "bg-status-good", accent: "bg-accent-450" }[tone];
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-text-secondary">{title}</p>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
            <span className="text-text-secondary">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatScanValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function ScanGroup({ title, data }: { title: string; data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([key]) => !key.startsWith("_"));
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-text-secondary">{title}</p>
      <dl className="space-y-1 text-xs">
        {entries.map(([key, value]) => (
          <div key={key} className="flex justify-between gap-2">
            <dt className="text-text-muted">{key.replace(/_/g, " ")}</dt>
            <dd className="text-right text-text-primary">{formatScanValue(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

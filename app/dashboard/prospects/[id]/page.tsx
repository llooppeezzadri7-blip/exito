import { notFound } from "next/navigation";
import { getRepository } from "@/lib/database";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge, scoreBucket } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { AnalyzeWebsiteButton } from "./AnalyzeWebsiteButton";
import { RecalculateScoreButton } from "./RecalculateScoreButton";
import { GenerateAuditButton } from "./GenerateAuditButton";
import { GenerateProposalButton } from "./GenerateProposalButton";
import { GenerateDemoButton } from "./GenerateDemoButton";
import { DemoPreview } from "./DemoPreview";
import { PipelineCard } from "./PipelineCard";
import { formatCurrencyEUR } from "@/lib/utils/format";
import {
  computeCommercialScore,
  TIER_LABELS,
  type CommercialTier,
  type VerificationStatus,
} from "@/lib/scoring/commercial-score";
import type { DemoContent } from "@/backend/demo-generator/generate-demo";

const SCORE_ROWS: { key: "opportunity_score" | "buying_intent_score" | "lead_score"; label: string }[] = [
  { key: "opportunity_score", label: "Opportunity Score" },
  { key: "buying_intent_score", label: "Buying Intent Score" },
  { key: "lead_score", label: "Lead Score" },
];

const TIER_TONES: Record<CommercialTier, "good" | "warning" | "serious" | "critical" | "neutral"> = {
  EXCEPCIONAL: "critical",
  MUY_ALTA: "serious",
  ALTA: "warning",
  MEDIA: "neutral",
  NO_PRIORITARIO: "neutral",
  INVESTIGAR_MAS: "neutral",
};

const STATUS_TONES: Record<VerificationStatus, "good" | "warning" | "neutral"> = {
  VERIFICADO: "good",
  PROBABLE: "warning",
  NO_VERIFICADO: "neutral",
};

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
  const lead = await repo.getLeadForBusiness(id);
  const activities = lead ? await repo.listLeadActivities(lead.id) : [];
  const proposal = await repo.getLatestProposalForBusiness(id);
  const demo = await repo.getLatestDemoForBusiness(id);

  // Competitors for the §19 comparison: same sector and city, from what we
  // already hold. Fewer than 3 and the factor reports NO_VERIFICADO rather
  // than inventing a competitive gap.
  const settings = await repo.getSettings();
  const peers = business.sector
    ? (await repo.listBusinesses({ sector: business.sector, city: business.city ?? undefined }))
        .filter((b) => b.id !== business.id)
    : [];
  const commercial = computeCommercialScore({
    business,
    scan,
    settings,
    peers: peers.map((b) => ({ review_count: b.review_count, rating: b.rating })),
  });

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
          <GenerateProposalButton businessId={business.id} />
          <GenerateDemoButton businessId={business.id} />
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
          <CardTitle>Oportunidad comercial</CardTitle>
          <Badge tone={TIER_TONES[commercial.tier]}>{TIER_LABELS[commercial.tier]}</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <div>
              <span className="text-2xl font-semibold tabular-nums">{commercial.score}</span>
              <span className="text-sm text-text-secondary">/100</span>
            </div>
            <div className="text-sm text-text-secondary">
              Evidencia disponible:{" "}
              <span className="tabular-nums text-text-primary">
                {Math.round(commercial.confidence * 100)}%
              </span>{" "}
              del modelo
            </div>
          </div>

          {commercial.recommendedService ? (
            <div className="rounded-lg border border-border-hairline bg-surface-2 p-3 text-sm">
              <p className="text-xs text-text-muted">Servicio a proponer</p>
              <p className="font-medium text-text-primary">{commercial.recommendedService}</p>
              {commercial.recommendationReason && (
                <p className="mt-1 text-text-secondary">{commercial.recommendationReason}</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-text-secondary">
              Sin servicio recomendado: no hay un problema demostrado que encaje con lo que vendemos.
            </p>
          )}

          <div className="space-y-3">
            {commercial.factors.map((f) => (
              <div key={f.key} className="border-b border-border-hairline pb-3 last:border-0 last:pb-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-text-primary">{f.label}</span>
                  <Badge tone={STATUS_TONES[f.status]}>{f.status.replace("_", " ")}</Badge>
                  <span className="ml-auto tabular-nums text-text-secondary">
                    {f.points}/{f.max}
                  </span>
                </div>
                <ul className="mt-1 space-y-0.5 text-xs text-text-secondary">
                  {f.evidence.map((e) => (
                    <li key={e}>· {e}</li>
                  ))}
                  {f.missing && <li className="text-status-warning">Falta comprobar: {f.missing}</li>}
                </ul>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Competencia</CardTitle>
          <Badge tone={peers.length >= 3 ? "good" : "neutral"}>
            {peers.length >= 3 ? "VERIFICADA" : "NO VERIFICADA"}
          </Badge>
        </CardHeader>
        <CardContent>
          {peers.length === 0 ? (
            <EmptyState
              title="Sin competidores en la base de datos"
              description="La comparación necesita al menos 3 negocios del mismo sector y municipio. Importa o descubre más para poder calcular la brecha."
            />
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-text-muted">
                {peers.length >= 3
                  ? `Comparado contra ${peers.length} competidores del mismo sector y municipio.`
                  : `Solo ${peers.length} competidor(es) disponibles: por debajo de 3 la brecha competitiva se reporta como NO_VERIFICADO en lugar de estimarse.`}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-xs">
                  <thead>
                    <tr className="border-b border-border-hairline text-left text-text-muted">
                      <th className="py-1.5 pr-3 font-medium">Negocio</th>
                      <th className="py-1.5 pr-3 font-medium">Municipio</th>
                      <th className="py-1.5 pr-3 font-medium">Web</th>
                      <th className="py-1.5 pr-3 font-medium">Valoración</th>
                      <th className="py-1.5 font-medium">Reseñas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {peers.map((peer) => (
                      <tr key={peer.id} className="border-b border-border-hairline">
                        <td className="py-1.5 pr-3 text-text-primary">{peer.name}</td>
                        <td className="py-1.5 pr-3 text-text-secondary">{peer.city ?? "—"}</td>
                        <td className="py-1.5 pr-3 text-text-secondary">
                          {peer.website_url ? "Sí" : "No detectada"}
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums">{peer.rating ?? "—"}</td>
                        <td className="py-1.5 tabular-nums">{peer.review_count ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-text-muted">
                Señales utilizadas para la brecha: número de reseñas (mediana del grupo) y
                valoración. Solo se comparan negocios del mismo sector y municipio.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <PipelineCard businessId={business.id} lead={lead} activities={activities} />
        </CardContent>
      </Card>

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

      <Card>
        <CardHeader>
          <CardTitle>Propuesta comercial</CardTitle>
          <div className="flex items-center gap-2">
            {proposal && <Badge tone="neutral">{proposal.status}</Badge>}
            {proposal && <span className="text-xs text-text-muted">{new Date(proposal.created_at).toLocaleString("es-ES")}</span>}
          </div>
        </CardHeader>
        <CardContent>
          {!proposal ? (
            <EmptyState
              title="Todavía no hay una propuesta generada"
              description='Pulsa "Generar propuesta" para crear una propuesta comercial a partir de los servicios y precios configurados en /settings y, si existe, la auditoría IA. Requiere ANTHROPIC_API_KEY configurada.'
            />
          ) : (
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-text-primary">{proposal.title}</h3>
                {proposal.price_total != null && (
                  <span className="text-lg font-semibold tabular-nums">{formatCurrencyEUR(proposal.price_total)}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {proposal.services.map((s) => (
                  <Badge key={s} tone="accent">
                    {s}
                  </Badge>
                ))}
              </div>
              <Row label="Plazo" value={proposal.timeline} />
              <Row label="Mantenimiento" value={proposal.maintenance_terms} />
              <Row label="Próximos pasos" value={proposal.next_steps} />
              {proposal.content && (
                <details className="pt-2">
                  <summary className="cursor-pointer text-xs font-medium text-accent-500">Ver propuesta completa</summary>
                  <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-xs text-text-secondary">{proposal.content}</pre>
                </details>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Demo de nueva web</CardTitle>
          {demo && <span className="text-xs text-text-muted">{new Date(demo.created_at).toLocaleString("es-ES")}</span>}
        </CardHeader>
        <CardContent>
          {!demo ? (
            <EmptyState
              title="Todavía no hay una demo generada"
              description='Pulsa "Generar demo" para crear una vista previa de nueva web con los datos reales de este negocio (placeholders para fotos/testimonios). Nunca se publica automáticamente. Requiere ANTHROPIC_API_KEY configurada.'
            />
          ) : (
            <DemoPreview content={demo.content as unknown as DemoContent} />
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
  if (Array.isArray(value)) {
    if (value.length === 0) return "ninguno";
    return value
      .map((entry) =>
        entry && typeof entry === "object" ? Object.values(entry).join(" → ") : String(entry)
      )
      .join(", ");
  }
  if (typeof value === "object") {
    // Nested groups (open_graph, redirect hops) would otherwise render as
    // "[object Object]" and hide the very data the audit collected.
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== null && v !== ""
    );
    return entries.length === 0 ? "—" : entries.map(([k, v]) => `${k}: ${String(v)}`).join(" · ");
  }
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

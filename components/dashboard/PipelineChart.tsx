import type { Lead, LeadStage } from "@/lib/database/types";
import { cn } from "@/lib/utils/cn";

const STAGE_LABELS: Record<LeadStage, string> = {
  NEW: "Nuevo",
  ANALYZING: "Analizando",
  QUALIFIED: "Cualificado",
  AUDIT_READY: "Auditoría lista",
  DEMO_READY: "Demo lista",
  CONTACTED: "Contactado",
  REPLIED: "Ha respondido",
  MEETING: "Reunión",
  PROPOSAL: "Propuesta",
  NEGOTIATION: "Negociación",
  WON: "Ganado",
  LOST: "Perdido",
  NOT_INTERESTED: "No interesado",
};

const STAGE_ORDER: LeadStage[] = [
  "NEW",
  "ANALYZING",
  "QUALIFIED",
  "AUDIT_READY",
  "DEMO_READY",
  "CONTACTED",
  "REPLIED",
  "MEETING",
  "PROPOSAL",
  "NEGOTIATION",
  "WON",
  "LOST",
  "NOT_INTERESTED",
];

export function PipelineChart({ leadsByStage }: { leadsByStage: Record<LeadStage, Lead[]> }) {
  const counts = STAGE_ORDER.map((stage) => ({ stage, count: leadsByStage[stage]?.length ?? 0 }));
  const max = Math.max(1, ...counts.map((c) => c.count));

  return (
    <div className="space-y-2.5" role="img" aria-label="Leads por etapa del pipeline">
      {counts.map(({ stage, count }) => (
        <div key={stage} className="flex items-center gap-3">
          <span className="w-28 shrink-0 text-xs text-text-secondary">{STAGE_LABELS[stage]}</span>
          <div className="relative h-4 flex-1 rounded bg-surface-2">
            <div
              className={cn(
                "h-4 rounded bg-accent-450 transition-[width]",
                stage === "WON" && "bg-status-good",
                stage === "LOST" && "bg-status-critical/70"
              )}
              style={{ width: `${(count / max) * 100}%`, minWidth: count > 0 ? "8px" : 0 }}
              title={`${STAGE_LABELS[stage]}: ${count}`}
            />
          </div>
          <span className="w-6 shrink-0 text-right text-xs font-medium tabular-nums text-text-primary">
            {count}
          </span>
        </div>
      ))}
    </div>
  );
}

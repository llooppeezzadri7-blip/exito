import Link from "next/link";
import { getRepository } from "@/lib/database";
import type { LeadStage } from "@/lib/database/types";
import { formatCurrencyEUR } from "@/lib/utils/format";
import { LeadStageSelect } from "@/components/dashboard/LeadStageSelect";

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
];

export default async function PipelinePage() {
  const repo = await getRepository();
  const [leadsByStage, businesses] = await Promise.all([repo.listLeadsByStage(), repo.listBusinesses()]);
  const businessById = new Map(businesses.map((b) => [b.id, b]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Pipeline comercial</h1>
        <p className="text-sm text-text-secondary">CRM interno — cambia la etapa de cada lead con el selector.</p>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {STAGE_ORDER.map((stage) => {
          const leads = leadsByStage[stage] ?? [];
          const total = leads.reduce((sum, l) => sum + (l.value_estimate ?? 0), 0);
          return (
            <div key={stage} className="w-64 shrink-0 rounded-xl border border-border-hairline bg-surface-1">
              <div className="border-b border-border-hairline px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-text-primary">{STAGE_LABELS[stage]}</span>
                  <span className="text-xs text-text-muted">{leads.length}</span>
                </div>
                {total > 0 && <div className="text-xs text-text-muted">{formatCurrencyEUR(total)}</div>}
              </div>
              <div className="space-y-2 p-2">
                {leads.map((lead) => {
                  const business = businessById.get(lead.business_id);
                  return (
                    <div
                      key={lead.id}
                      className="rounded-lg border border-border-hairline bg-surface-2 p-2.5 text-sm hover:border-accent-450/50"
                    >
                      <Link href={`/dashboard/prospects/${lead.business_id}`} className="font-medium text-text-primary hover:underline">
                        {business?.name ?? "—"}
                      </Link>
                      {lead.value_estimate && (
                        <div className="text-xs text-text-muted">{formatCurrencyEUR(lead.value_estimate)}</div>
                      )}
                      {lead.next_action && (
                        <div className="mt-1 text-xs text-accent-500">
                          {lead.next_action}
                          {lead.next_action_date ? ` · ${lead.next_action_date}` : ""}
                        </div>
                      )}
                      <div className="mt-2">
                        <LeadStageSelect leadId={lead.id} currentStage={lead.stage} className="h-7 w-full rounded border border-border-hairline bg-surface-1 px-1 text-xs" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

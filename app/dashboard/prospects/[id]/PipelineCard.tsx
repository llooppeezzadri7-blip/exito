"use client";

import { addToPipeline, updateLeadFollowUp } from "./actions";
import { buttonVariants } from "@/components/ui/Button";
import { LeadStageSelect } from "@/components/dashboard/LeadStageSelect";
import type { Lead, LeadActivity } from "@/lib/database/types";

export function PipelineCard({
  businessId,
  lead,
  activities,
}: {
  businessId: string;
  lead: Lead | null;
  activities: LeadActivity[];
}) {
  if (!lead) {
    return (
      <form action={addToPipeline.bind(null, businessId)}>
        <button type="submit" className={buttonVariants()}>
          Añadir a pipeline
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-secondary">Etapa</span>
        <LeadStageSelect
          leadId={lead.id}
          currentStage={lead.stage}
          className="h-9 rounded-lg border border-border-hairline bg-surface-1 px-2 text-sm"
        />
      </div>

      <form action={updateLeadFollowUp.bind(null, lead.id)} className="space-y-2">
        <input type="hidden" name="business_id" value={businessId} />
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs">
            <span className="mb-1 block text-text-secondary">Próxima acción</span>
            <input
              name="next_action"
              defaultValue={lead.next_action ?? ""}
              placeholder="Llamar, enviar propuesta..."
              className="h-9 w-full rounded-lg border border-border-hairline bg-surface-1 px-2 text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block text-text-secondary">Fecha</span>
            <input
              type="date"
              name="next_action_date"
              defaultValue={lead.next_action_date ?? ""}
              className="h-9 w-full rounded-lg border border-border-hairline bg-surface-1 px-2 text-sm"
            />
          </label>
        </div>
        <label className="block text-xs">
          <span className="mb-1 block text-text-secondary">Notas</span>
          <textarea
            name="notes"
            defaultValue={lead.notes ?? ""}
            rows={2}
            className="w-full rounded-lg border border-border-hairline bg-surface-1 px-2 py-1.5 text-sm"
          />
        </label>
        <button type="submit" className={buttonVariants({ variant: "secondary", size: "sm" })}>
          Guardar seguimiento
        </button>
      </form>

      {activities.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-text-secondary">Actividad</p>
          <ul className="space-y-1.5 text-xs">
            {activities.map((a) => (
              <li key={a.id} className="flex justify-between gap-2 border-b border-border-hairline pb-1.5 last:border-0">
                <span className="text-text-secondary">{a.description}</span>
                <span className="shrink-0 text-text-muted">{new Date(a.created_at).toLocaleDateString("es-ES")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

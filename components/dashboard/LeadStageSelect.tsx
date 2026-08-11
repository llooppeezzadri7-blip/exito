"use client";

import { useTransition } from "react";
import type { LeadStage } from "@/lib/database/types";
import { changeLeadStage } from "@/app/dashboard/prospects/[id]/actions";

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

export function LeadStageSelect({
  leadId,
  currentStage,
  className,
}: {
  leadId: string;
  currentStage: LeadStage;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      defaultValue={currentStage}
      disabled={pending}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        e.stopPropagation();
        const stage = e.target.value as LeadStage;
        startTransition(() => {
          changeLeadStage(leadId, stage, "/dashboard/pipeline");
        });
      }}
      className={className ?? "h-7 rounded border border-border-hairline bg-surface-1 px-1 text-xs"}
    >
      {STAGE_ORDER.map((s) => (
        <option key={s} value={s}>
          {STAGE_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

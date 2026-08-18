import type { LeadStage } from "@/lib/database/types";
import type { AgencyRepository } from "@/lib/database";
import { lastConclusionFor, recordOutcome, type LeadOutcome, type OutcomeRecord } from "@/lib/memory/research-memory";

/**
 * FASE 5.3 — ground truth.
 *
 * Until now the system only ever compared its opinions with its own opinions.
 * This closes the loop: when a lead reaches a terminal state, what actually
 * happened is written next to what the system predicted, and that pairing is
 * the only evidence the learning engine is allowed to treat as truth.
 *
 * The score recorded is the one from the *conclusion event*, not a fresh
 * computation. Re-scoring at outcome time would compare the prediction with
 * an already-corrected version of itself, and the system would look far more
 * accurate than it is.
 */

/** Terminal stages, and how each maps to an outcome. */
const TERMINAL_STAGES: Partial<Record<LeadStage, LeadOutcome>> = {
  WON: "WON",
  LOST: "LOST",
  // "No interesado" is not the same as "lost": one said no, the other went
  // nowhere. Keeping them apart is what lets the engine tell "we picked the
  // wrong business" from "we lost a fair fight".
  NOT_INTERESTED: "NOT_A_FIT",
};

export function isTerminalStage(stage: LeadStage): boolean {
  return stage in TERMINAL_STAGES;
}

export function outcomeForStage(stage: LeadStage): LeadOutcome | null {
  return TERMINAL_STAGES[stage] ?? null;
}

export interface RecordLeadOutcomeInput {
  businessId: string;
  stage: LeadStage;
  repository: AgencyRepository;
  soldService?: string | null;
  notes?: string | null;
  /** Overrides the stage mapping, e.g. to record NO_REPLY explicitly. */
  outcome?: LeadOutcome;
}

export interface RecordLeadOutcomeResult {
  recorded: boolean;
  outcome: LeadOutcome | null;
  /** Whether a prediction existed to contrast the outcome with. */
  hadPrediction: boolean;
  reason: string;
}

export async function recordLeadOutcome(
  input: RecordLeadOutcomeInput
): Promise<RecordLeadOutcomeResult> {
  const outcome = input.outcome ?? outcomeForStage(input.stage);

  if (!outcome) {
    return {
      recorded: false,
      outcome: null,
      hadPrediction: false,
      reason: `${input.stage} no es un estado final: todavía no hay desenlace que registrar.`,
    };
  }

  const conclusion = lastConclusionFor(input.businessId);
  const business = await input.repository.getBusiness(input.businessId);

  const record: OutcomeRecord = {
    businessId: input.businessId,
    outcome,
    scoreAtTime: conclusion?.score ?? null,
    confidenceAtTime: conclusion?.confidence ?? null,
    recommendedService: conclusion?.recommendedService ?? null,
    soldService: input.soldService ?? null,
    // Preferring the conclusion's own values keeps the segmentation aligned
    // with what was true when the prediction was made, not with a record that
    // may have been edited since.
    municipality: conclusion?.municipality ?? business?.city ?? null,
    sector: conclusion?.sector ?? business?.sector ?? null,
    businessSource: conclusion?.source ?? business?.source ?? null,
    factorsAtTime: conclusion?.factors ?? null,
    notes: input.notes ?? null,
  };

  recordOutcome(record);

  return {
    recorded: true,
    outcome,
    hadPrediction: conclusion !== null,
    reason: conclusion
      ? `Desenlace ${outcome} contrastado con la puntuación de ${conclusion.score}/100 del ${conclusion.at.slice(0, 10)}.`
      : `Desenlace ${outcome} registrado sin predicción previa: este negocio nunca fue puntuado por el sistema, así que no cuenta para medir su acierto.`,
  };
}

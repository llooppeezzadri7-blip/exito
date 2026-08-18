import { priorityAdjustments, type PriorityAdjustment } from "@/lib/memory/predictive";
import { buildProposals, type LearningProposal } from "@/lib/memory/learning";
import { checkAutonomousChange, AUTONOMOUS_AREAS } from "@/lib/memory/hard-constraints";
import { autoApplicableConclusions } from "@/lib/memory/experiments";
import { recordEvent } from "@/lib/memory/research-memory";

/**
 * FASE 5 — where "apply everything permitted" is turned into code.
 *
 * The operator asked for the highest autonomy level: anything inside an
 * autonomous area gets applied without asking. This module is the one place
 * that decides what "permitted" means, and it decides it by asking
 * `checkAutonomousChange()` — which refuses by default for anything it does
 * not explicitly recognise.
 *
 * Three separate gates, all of which must open:
 *
 *   1. the area is autonomous (not verification, scoring, corroboration…);
 *   2. the evidence meets the sample threshold;
 *   3. the effect size clears the margin.
 *
 * Anything that fails a gate is still *returned*, so the dashboard can show
 * what the system wanted to do and why it did not. Silently dropping refused
 * changes would hide exactly the decisions worth auditing.
 */

export interface AppliedAdjustment {
  area: string;
  target: string;
  effect: string;
  evidence: string;
  sampleSize: number;
  applied: boolean;
  /** Why it was or was not applied. */
  reason: string;
}

/** Adjustments the system is currently prepared to apply, and the refused ones. */
export function pendingAdjustments(): AppliedAdjustment[] {
  const fromOutcomes: AppliedAdjustment[] = priorityAdjustments().map((adjustment) =>
    describeAdjustment(adjustment)
  );

  const fromProposals: AppliedAdjustment[] = buildProposals().map((proposal) =>
    describeProposal(proposal)
  );

  // A concluded experiment whose winning variant is in an autonomous area.
  const fromExperiments: AppliedAdjustment[] = autoApplicableConclusions().map((experiment) => ({
    area: experiment.targetArea,
    target: experiment.conclusion?.winningVariantId ?? "sin ganador",
    effect: `Adoptar la variante ganadora del experimento "${experiment.hypothesis}".`,
    evidence: experiment.conclusion?.summary ?? "",
    sampleSize:
      experiment.variants.reduce((sum, variant) => sum + variant.observations.length, 0) ?? 0,
    applied: experiment.constraint.allowed,
    reason: experiment.constraint.allowed
      ? `Área autónoma (${experiment.targetArea}) y experimento concluido con datos suficientes.`
      : experiment.constraint.reason,
  }));

  return [...fromOutcomes, ...fromProposals, ...fromExperiments];
}

function describeAdjustment(adjustment: PriorityAdjustment): AppliedAdjustment {
  const direction = adjustment.liftPoints >= 0 ? "Subir" : "Bajar";

  return {
    area: adjustment.area,
    target: adjustment.target,
    effect: `${direction} la prioridad de ${adjustment.target} en los próximos ciclos.`,
    evidence: adjustment.evidence,
    sampleSize: adjustment.sampleSize,
    applied: adjustment.applicable,
    reason: adjustment.applicable
      ? `Área autónoma (${adjustment.area}), ${adjustment.sampleSize} desenlaces reales y una diferencia de ${Math.round(adjustment.liftPoints)} puntos sobre la tasa base.`
      : adjustment.constraint.allowed
        ? `La diferencia observada (${Math.round(adjustment.liftPoints)} puntos) no llega al margen exigido.`
        : adjustment.constraint.reason,
  };
}

function describeProposal(proposal: LearningProposal): AppliedAdjustment {
  return {
    area: proposal.kind,
    target: proposal.statement,
    effect: proposal.statement,
    evidence: proposal.evidence,
    sampleSize: proposal.sampleSize,
    applied: proposal.applicable,
    reason: proposal.applicable
      ? `Área autónoma (${proposal.kind}) con ${proposal.sampleSize} observaciones.`
      : proposal.constraint.allowed
        ? `Solo ${proposal.sampleSize} observaciones: por debajo del mínimo para actuar.`
        : proposal.constraint.reason,
  };
}

/**
 * Applies what may be applied and records every decision, including the
 * refusals. Returns the full set so the caller can show both.
 *
 * "Applying" a priority adjustment does not mutate any rule — the planner
 * reads the learned order on every run. What this function actually does is
 * make the decision explicit and auditable, which is the part that was
 * missing: a change nobody can point to afterwards is not a change anyone
 * can trust.
 */
export function applyAdjustments(): AppliedAdjustment[] {
  const adjustments = pendingAdjustments();

  for (const adjustment of adjustments) {
    // Second, independent check. `pendingAdjustments` already asked, but this
    // is the function that acts, and a permission check belongs at the point
    // of action, not only at the point of proposal.
    const constraint = checkAutonomousChange(adjustment.area);
    const permitted = adjustment.applied && constraint.allowed;

    recordEvent({
      type: permitted ? "CHANGE_DETECTED" : "DECISION_MADE",
      runId: null,
      businessId: null,
      businessName: null,
      municipality: null,
      sector: null,
      source: null,
      summary: permitted
        ? `Ajuste aplicado automáticamente: ${adjustment.effect}`
        : `Ajuste NO aplicado: ${adjustment.effect} Motivo: ${adjustment.reason}`,
      data: {
        area: adjustment.area,
        target: adjustment.target,
        sampleSize: adjustment.sampleSize,
        applied: permitted,
        reason: permitted ? adjustment.reason : constraint.reason,
        autonomousAreas: AUTONOMOUS_AREAS,
      },
    });

    adjustment.applied = permitted;
  }

  return adjustments;
}

/** Just the ones that were applied, for the cycle record. */
export function appliedOnly(adjustments: AppliedAdjustment[]): AppliedAdjustment[] {
  return adjustments.filter((adjustment) => adjustment.applied);
}

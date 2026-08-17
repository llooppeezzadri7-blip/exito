import type { CommercialScoreResult } from "@/lib/scoring/commercial-score";
import type { ResearchResultItem } from "@/backend/research/types";
import type { DeepeningCriteria, ResearchDirective, StopCriteria, StopDecision, TriageDecision, UncertaintyKind } from "./types";

/**
 * FASE 4.2 / 4.3 / 4.5 — adaptive depth, targeted follow-up, and stopping.
 *
 * The three decisions are here together because they are one judgement seen
 * from different angles: given what is still unknown and how much it could
 * move the score, is this business worth more effort?
 *
 * The asymmetry is deliberate. A business that looks weak *and* is fully
 * assessed can be dropped cheaply. A business that looks weak but is barely
 * assessed cannot — that is not a bad prospect, it is an unexamined one, and
 * discarding it would be mistaking absence of evidence for evidence of
 * absence.
 */

export interface TriageInput {
  businessId: string;
  businessName: string;
  score: CommercialScoreResult;
  websiteResolved: boolean;
  hasScan: boolean;
  hasMobileAudit: boolean;
  competitorCount: number;
  hasContradictions: boolean;
}

/** Points sitting in factors that could not be evaluated. */
export function unassessedPoints(score: CommercialScoreResult): number {
  return score.factors
    .filter((factor) => factor.status === "NO_VERIFICADO")
    .reduce((sum, factor) => sum + factor.max, 0);
}

export function triage(input: TriageInput, criteria: DeepeningCriteria): TriageDecision {
  const { score } = input;
  const openQuestions = openQuestionsFor(input).map((d) => d.action);
  const atStake = unassessedPoints(score);

  // Contradictions come first: nothing downstream is trustworthy until the
  // sources agree on who this business even is.
  if (input.hasContradictions) {
    return {
      businessId: input.businessId,
      businessName: input.businessName,
      triage: "A",
      reason: "Fuentes contradictorias sobre su identidad: hay que resolverlo antes de puntuarlo en serio.",
      openQuestions,
    };
  }

  if (score.score >= criteria.deepenAboveScore) {
    return {
      businessId: input.businessId,
      businessName: input.businessName,
      triage: "A",
      reason: `Puntúa ${score.score} con ${Math.round(score.confidence * 100)}% de evidencia: merece investigación profunda.`,
      openQuestions,
    };
  }

  // A low score built on little evidence is not a rejection, it is an
  // unfinished investigation.
  if (score.score < criteria.discardBelowScore && atStake <= 20) {
    return {
      businessId: input.businessId,
      businessName: input.businessName,
      triage: "D",
      reason: `Puntúa ${score.score} con la mayor parte del modelo ya evaluado (${Math.round(score.confidence * 100)}%): no hay indicios de oportunidad.`,
      openQuestions: [],
    };
  }

  if (atStake >= 25) {
    return {
      businessId: input.businessId,
      businessName: input.businessName,
      triage: "B",
      reason: `Quedan ${atStake} puntos sin evaluar: demasiado ambiguo para descartarlo o priorizarlo.`,
      openQuestions,
    };
  }

  return {
    businessId: input.businessId,
    businessName: input.businessName,
    triage: "C",
    reason: `Evaluado al ${Math.round(score.confidence * 100)}% sin incertidumbres grandes: la evidencia disponible ya es suficiente.`,
    openQuestions,
  };
}

/**
 * FASE 4.3 — what is actually missing, expressed as concrete actions.
 * Never "investigar más": each directive names the check to run and the
 * points it would unblock.
 */
export function openQuestionsFor(input: TriageInput): ResearchDirective[] {
  const directives: ResearchDirective[] = [];
  const pointsOf = (key: string) =>
    input.score.factors.find((f) => f.key === key && f.status === "NO_VERIFICADO")?.max ?? 0;

  if (input.hasContradictions) {
    directives.push({
      kind: "contradictory_sources" satisfies UncertaintyKind,
      action: "Comparar teléfono y dominio entre las fuentes en conflicto y quedarse con el que corrobore la dirección.",
      unblocks: "identidad",
      pointsAtStake: 25,
    });
  }

  if (!input.websiteResolved) {
    directives.push({
      kind: "website_unresolved",
      action:
        "Probar los candidatos de web pendientes y comprobar si la página menciona el teléfono o la dirección del negocio.",
      unblocks: "necesidad",
      pointsAtStake: pointsOf("necesidad"),
    });
  }

  if (input.websiteResolved && !input.hasScan) {
    directives.push({
      kind: "no_scan",
      action: "Analizar la web resuelta: HTTPS, título, meta description, vías de contacto y enlaces rotos.",
      unblocks: "necesidad",
      pointsAtStake: pointsOf("necesidad"),
    });
  }

  if (input.hasScan && !input.hasMobileAudit) {
    directives.push({
      kind: "mobile_unknown",
      action: "Renderizar la web a 390 px y medir desbordamiento, tamaño de pulsación y legibilidad.",
      unblocks: "necesidad",
      pointsAtStake: 0,
    });
  }

  if (input.hasScan) {
    directives.push({
      kind: "booking_unknown",
      action:
        "Revisar páginas internas y enlaces salientes en busca de sistema de reservas o CTA de contacto que no estén en la portada.",
      unblocks: "ajuste_servicios",
      pointsAtStake: pointsOf("ajuste_servicios"),
    });
  }

  if (input.competitorCount < 3) {
    directives.push({
      kind: "competitors_insufficient",
      action: `Descubrir ${3 - input.competitorCount} competidor(es) más del mismo sector y municipio.`,
      unblocks: "competencia",
      pointsAtStake: pointsOf("competencia"),
    });
  }

  if (pointsOf("capacidad_pago") > 0) {
    directives.push({
      kind: "payment_capacity_unknown",
      action: "Buscar valoración y número de reseñas del negocio en una fuente que los publique.",
      unblocks: "capacidad_pago",
      pointsAtStake: pointsOf("capacidad_pago"),
    });
  }

  // Highest stake first: effort goes where it can move the score most.
  return directives.sort((a, b) => b.pointsAtStake - a.pointsAtStake);
}

export interface StopInput {
  round: number;
  requestsUsed: number;
  elapsedMs: number;
  score: CommercialScoreResult;
  directives: ResearchDirective[];
  triage: TriageDecision["triage"];
  /** Score from the previous round, to detect rounds that changed nothing. */
  previousScore: number | null;
}

/** FASE 4.5 — when to stop, and the reason recorded for it. */
export function shouldStop(input: StopInput, criteria: StopCriteria): StopDecision {
  if (input.triage === "D") {
    return { stop: true, code: "DISCARDED", reason: "Descartado en el triaje: no hay indicios de oportunidad." };
  }

  if (input.elapsedMs >= criteria.maxDurationMs) {
    return { stop: true, code: "TIMEOUT", reason: `Se alcanzó el límite de tiempo (${Math.round(criteria.maxDurationMs / 60000)} min).` };
  }

  if (input.requestsUsed >= criteria.maxRequestsPerBusiness) {
    return {
      stop: true,
      code: "MAX_REQUESTS",
      reason: `Se alcanzó el límite de ${criteria.maxRequestsPerBusiness} peticiones para este negocio.`,
    };
  }

  if (input.round >= criteria.maxRounds) {
    return { stop: true, code: "MAX_ROUNDS", reason: `Se alcanzó el máximo de ${criteria.maxRounds} rondas.` };
  }

  const stake = input.directives.reduce((sum, d) => sum + d.pointsAtStake, 0);

  if (input.score.confidence >= criteria.sufficientConfidence && stake < 10) {
    return {
      stop: true,
      code: "SUFFICIENT_CONFIDENCE",
      reason: `Evidencia al ${Math.round(input.score.confidence * 100)}% y solo ${stake} puntos en juego: seguir no cambiaría la conclusión.`,
    };
  }

  if (input.directives.length === 0) {
    return { stop: true, code: "NO_OPEN_QUESTIONS", reason: "No queda ninguna comprobación pendiente que ejecutar." };
  }

  // A round that moved nothing is a signal the remaining questions are not
  // answerable with the sources available.
  if (input.previousScore !== null && input.previousScore === input.score.score && input.round > 1) {
    return {
      stop: true,
      code: "NO_PROGRESS",
      reason: "La última ronda no cambió la puntuación: las incertidumbres restantes no se resuelven con estas fuentes.",
    };
  }

  return {
    stop: false,
    code: null,
    reason: `Quedan ${stake} puntos en juego en ${input.directives.length} comprobación(es) pendiente(s).`,
  };
}

/** FASE 4.9 — whether a known business needs revisiting, and what for. */
export interface RevisitDecision {
  revisit: boolean;
  reason: string;
  /** Only the parts worth re-checking, not the whole investigation. */
  checks: string[];
}

export const REVISIT_AFTER_DAYS = 30;

export function shouldRevisit(
  lastResearchedAt: string | null,
  now: Date,
  previous: { score: number; confidence: number } | null
): RevisitDecision {
  if (!lastResearchedAt) {
    return { revisit: true, reason: "Nunca se ha investigado.", checks: ["investigación completa"] };
  }

  const days = (now.getTime() - new Date(lastResearchedAt).getTime()) / 86_400_000;

  if (days < REVISIT_AFTER_DAYS) {
    return {
      revisit: false,
      reason: `Investigado hace ${Math.round(days)} días: por debajo del umbral de ${REVISIT_AFTER_DAYS}.`,
      checks: [],
    };
  }

  // After the window, only the things that actually change get re-checked.
  const checks = ["web (cambios y disponibilidad)", "redes enlazadas desde la web", "valoración y reseñas"];
  if (previous && previous.confidence < 0.8) checks.push("factores que quedaron sin evaluar");

  return {
    revisit: true,
    reason: `Han pasado ${Math.round(days)} días desde la última investigación.`,
    checks,
  };
}

/** Ranking used for the final list (FASE 4.6). Weights are untouched. */
export function prioritize(items: ResearchResultItem[]): ResearchResultItem[] {
  return [...items].sort((a, b) => {
    // Score first, then evidence: between two equal scores, the better
    // supported one goes first, because it is the one you can defend.
    if (b.score !== a.score) return b.score - a.score;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const contactA = a.factors.find((f) => f.key === "facilidad_contacto")?.points ?? 0;
    const contactB = b.factors.find((f) => f.key === "facilidad_contacto")?.points ?? 0;
    return contactB - contactA;
  });
}

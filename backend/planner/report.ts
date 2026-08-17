import type { ResearchIssue, ResearchResultItem } from "@/backend/research/types";
import type { ResearchPlan } from "./types";
import type { BusinessDecision, TargetOutcome } from "./autonomous-run";

/**
 * FASE 4.11 — the final report.
 *
 * Everything here is derived from what the run actually produced. There is no
 * narrative layer: if a lead has no verified problem, the report says the
 * problem is unverified rather than describing one. The "what we could not
 * verify" section is not an appendix — it is the part that keeps the rest
 * honest, so it is built with the same care as the top leads.
 */

export interface ReportedLead {
  rank: number;
  businessId: string;
  name: string;
  city: string | null;
  sector: string | null;
  score: number;
  confidence: number;
  tier: string;
  /** Why it ranks here, in terms of the factors that actually scored. */
  whyItRanks: string;
  /** The strongest verified finding, or an explicit absence. */
  mainFinding: string;
  recommendedService: string | null;
  recommendationReason: string | null;
  verificationStatus: string;
  /** What is still unknown about this lead. */
  openQuestions: string[];
  contact: { phone: string | null; website: string | null };
}

export interface ReportSection {
  title: string;
  lines: string[];
}

export interface FinalReport {
  goal: string;
  zone: string;
  createdAt: string;
  topLeads: ReportedLead[];
  summary: ReportSection;
  coverage: ReportSection;
  notVerified: ReportSection;
  patterns: ReportSection;
  decisionsTaken: ReportSection;
  /** Plain-text rendering for export, built from the sections above. */
  text: string;
}

export interface BuildReportInput {
  plan: ResearchPlan;
  leads: ResearchResultItem[];
  decisions: BusinessDecision[];
  targets: TargetOutcome[];
  issues: ResearchIssue[];
  stoppedBecause: string;
  elapsedMs: number;
  topN?: number;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function whyItRanks(item: ResearchResultItem): string {
  const scored = item.factors
    .filter((factor) => factor.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((factor) => `${factor.label} ${factor.points}/${factor.max}`);

  if (scored.length === 0) {
    return `Puntúa ${item.score}/100 sin ningún factor evaluado por encima de cero: la posición se sostiene solo en lo que se pudo comprobar.`;
  }

  return `Puntúa ${item.score}/100 (evidencia ${pct(item.confidence)}) principalmente por ${scored.join(", ")}.`;
}

function mainFinding(item: ResearchResultItem): string {
  const verifiedFact = item.evidence.find((e) => e.kind === "FACT" && e.status === "VERIFICADO");
  if (verifiedFact) return verifiedFact.statement;
  if (item.primaryProblem) return item.primaryProblem;
  return "No se obtuvo ningún hallazgo verificado: no hay problema confirmado que presentar.";
}

export function buildFinalReport(input: BuildReportInput): FinalReport {
  const { plan, leads, decisions, targets, issues } = input;
  const topN = input.topN ?? 10;

  const decisionByBusiness = new Map(decisions.map((d) => [d.businessId, d]));

  const topLeads: ReportedLead[] = leads.slice(0, topN).map((item, index) => ({
    rank: index + 1,
    businessId: item.businessId,
    name: item.name,
    city: item.city,
    sector: item.sector,
    score: item.score,
    confidence: item.confidence,
    tier: item.tier,
    whyItRanks: whyItRanks(item),
    mainFinding: mainFinding(item),
    recommendedService: item.recommendedService,
    recommendationReason: item.recommendationReason,
    verificationStatus: item.verificationStatus,
    openQuestions: (decisionByBusiness.get(item.businessId)?.directives ?? []).map((d) => d.action),
    contact: {
      phone: null,
      website: item.websiteResolution?.url ?? null,
    },
  }));

  const executed = targets.filter((t) => !t.skipped);
  const skipped = targets.filter((t) => t.skipped);
  const byTriage = { A: 0, B: 0, C: 0, D: 0 };
  for (const decision of decisions) byTriage[decision.triage.triage] += 1;

  const summary: ReportSection = {
    title: "Resumen general",
    lines: [
      `Objetivo: ${plan.goal.statement}`,
      `Zona: ${plan.goal.zone}. Profundidad: ${plan.depth}.`,
      `Objetivos ejecutados: ${executed.length} de ${targets.length}${skipped.length ? ` (${skipped.length} no ejecutados)` : ""}.`,
      `Negocios analizados: ${decisions.length}. Leads retenidos: ${leads.length}.`,
      `Triaje: ${byTriage.A} de clase A, ${byTriage.B} de clase B, ${byTriage.C} de clase C, ${byTriage.D} descartados.`,
      `Duración: ${Math.round(input.elapsedMs / 1000)} s. Fin: ${input.stoppedBecause}`,
    ],
  };

  const coverage: ReportSection = {
    title: "Cobertura",
    lines: [
      ...executed.map((target) => `${target.target.subsector} en ${target.target.municipality}: ${target.reason}`),
      ...skipped.map(
        (target) => `${target.target.subsector} en ${target.target.municipality}: NO investigado — ${target.reason}`
      ),
    ],
  };

  // What could not be established. Counted, not narrated.
  const unresolvedWebsites = leads.filter((l) => (l.websiteResolution?.status ?? "NO_VERIFICADO") === "NO_VERIFICADO");
  const withoutCompetitors = leads.filter((l) => !l.competitorsVerified);
  const contradictory = leads.filter((l) => l.verificationStatus === "NO_VERIFICADO");
  const lowConfidence = leads.filter((l) => l.confidence < plan.stop.sufficientConfidence);
  const sourceFailures = issues.filter((i) => i.code === "SOURCE_UNAVAILABLE");

  const notVerified: ReportSection = {
    title: "Lo que no se ha podido verificar",
    lines: [
      unresolvedWebsites.length
        ? `${unresolvedWebsites.length} negocio(s) sin web confirmada: no se afirma que no tengan web, solo que no se ha podido confirmar cuál es.`
        : "Todos los leads retenidos tienen una web resuelta o una ausencia corroborada.",
      contradictory.length
        ? `${contradictory.length} negocio(s) con fuentes contradictorias sobre su identidad: pendientes de resolver antes de contactarlos.`
        : "Ningún lead retenido presenta contradicciones entre fuentes.",
      withoutCompetitors.length
        ? `${withoutCompetitors.length} negocio(s) con menos de 3 competidores localizados: el factor competencia queda sin evaluar en ellos.`
        : "Todos los leads retenidos tienen al menos 3 competidores localizados.",
      lowConfidence.length
        ? `${lowConfidence.length} negocio(s) por debajo del ${pct(plan.stop.sufficientConfidence)} de evidencia: su puntuación es provisional.`
        : `Todos los leads retenidos alcanzan el ${pct(plan.stop.sufficientConfidence)} de evidencia.`,
      ...sourceFailures.map((issue) => `Fuente no disponible durante la ejecución: ${issue.message}`),
    ],
  };

  // Patterns are only reported when there are enough cases to be a pattern
  // rather than an anecdote.
  const MIN_FOR_PATTERN = 3;
  const patternLines: string[] = [];

  const bySector = new Map<string, ResearchResultItem[]>();
  for (const lead of leads) {
    const key = lead.sector ?? "sin sector";
    bySector.set(key, [...(bySector.get(key) ?? []), lead]);
  }
  for (const [sector, items] of bySector) {
    if (items.length < MIN_FOR_PATTERN) continue;
    const average = items.reduce((sum, i) => sum + i.score, 0) / items.length;
    patternLines.push(
      `${sector}: ${items.length} leads, puntuación media ${average.toFixed(1)}/100.`
    );
  }

  const byMunicipality = new Map<string, ResearchResultItem[]>();
  for (const lead of leads) {
    const key = lead.city ?? "sin municipio";
    byMunicipality.set(key, [...(byMunicipality.get(key) ?? []), lead]);
  }
  for (const [city, items] of byMunicipality) {
    if (items.length < MIN_FOR_PATTERN) continue;
    const withoutWeb = items.filter(
      (i) => (i.websiteResolution?.status ?? "NO_VERIFICADO") === "NO_VERIFICADO"
    ).length;
    patternLines.push(`${city}: ${items.length} leads, ${withoutWeb} sin web confirmada.`);
  }

  const services = new Map<string, number>();
  for (const lead of leads) {
    if (!lead.recommendedService) continue;
    services.set(lead.recommendedService, (services.get(lead.recommendedService) ?? 0) + 1);
  }
  for (const [service, count] of services) {
    if (count < MIN_FOR_PATTERN) continue;
    patternLines.push(`${count} leads apuntan al mismo servicio recomendado: ${service}.`);
  }

  const patterns: ReportSection = {
    title: "Patrones detectados",
    lines: patternLines.length
      ? patternLines
      : [`No hay suficientes casos (mínimo ${MIN_FOR_PATTERN} por grupo) para afirmar ningún patrón.`],
  };

  const decisionsTaken: ReportSection = {
    title: "Decisiones del planificador",
    lines: plan.decisions.map(
      (decision) =>
        `${decision.decision} — ${decision.reason}${decision.sampleSize > 0 ? ` (n=${decision.sampleSize})` : ""}`
    ),
  };

  const sections = [summary, coverage, notVerified, patterns, decisionsTaken];

  const leadsText = topLeads.length
    ? topLeads
        .map((lead) =>
          [
            `${lead.rank}. ${lead.name}${lead.city ? ` (${lead.city})` : ""} — ${lead.score}/100 · ${lead.tier} · evidencia ${pct(lead.confidence)} · identidad ${lead.verificationStatus}`,
            `   ${lead.whyItRanks}`,
            `   Hallazgo principal: ${lead.mainFinding}`,
            `   Servicio recomendado: ${lead.recommendedService ?? "sin recomendación (falta evidencia)"}${
              lead.recommendationReason ? ` — ${lead.recommendationReason}` : ""
            }`,
            lead.openQuestions.length ? `   Pendiente: ${lead.openQuestions.join(" | ")}` : "   Pendiente: nada.",
          ].join("\n")
        )
        .join("\n\n")
    : "No se retuvo ningún lead.";

  const text = [
    `INFORME DE INVESTIGACIÓN — ${plan.goal.zone}`,
    `Generado: ${plan.createdAt}`,
    "",
    "MEJORES OPORTUNIDADES",
    leadsText,
    "",
    ...sections.map((section) => [section.title.toUpperCase(), ...section.lines.map((l) => `- ${l}`), ""].join("\n")),
  ].join("\n");

  return {
    goal: plan.goal.statement,
    zone: plan.goal.zone,
    createdAt: plan.createdAt,
    topLeads,
    summary,
    coverage,
    notVerified,
    patterns,
    decisionsTaken,
    text,
  };
}

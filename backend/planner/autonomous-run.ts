import type { AgencyRepository } from "@/lib/database";
import { runResearch, type DiscoveryPort } from "@/backend/research/run-research";
import type { ScanOptions } from "@/backend/scanner/scan-website";
import type { ProgressStep, ResearchIssue, ResearchResultItem } from "@/backend/research/types";
import { recordEvent } from "@/lib/memory/research-memory";
import { buildPlan, type BuildPlanOptions } from "./planner";
import { openQuestionsFor, prioritize, shouldStop, triage, type TriageInput } from "./triage";
import { buildFinalReport, type FinalReport } from "./report";
import type {
  PlannedTarget,
  ResearchDirective,
  ResearchGoal,
  ResearchPlan,
  StopDecision,
  TriageDecision,
} from "./types";

/**
 * FASE 4.4 / 4.10 — the autonomous run.
 *
 * The planner decides *what* to investigate; this executes the plan target by
 * target and decides, after each one, whether to keep going. It owns no
 * analysis of its own: scoring, verification and corroboration all stay in the
 * modules that already implement them.
 *
 * Two ceilings are enforced here and cannot be exceeded by anything the
 * planner decides: the lead quota and the wall-clock budget. An autonomous
 * loop without a hard stop is precisely the failure mode we were asked to
 * make impossible.
 */

export interface TargetOutcome {
  target: PlannedTarget;
  /** Null when the target was planned but never executed. */
  found: number;
  skipped: boolean;
  reason: string;
  issues: ResearchIssue[];
}

export interface BusinessDecision {
  businessId: string;
  businessName: string;
  triage: TriageDecision;
  directives: ResearchDirective[];
  stop: StopDecision;
}

export interface AutonomousProgress {
  phase: "PLANNING" | "RESEARCHING" | "DECIDING" | "REPORTING" | "DONE";
  targetIndex: number;
  targetCount: number;
  currentTarget: string | null;
  leadsSoFar: number;
  steps: ProgressStep[];
}

export interface AutonomousRunOptions {
  goal: ResearchGoal;
  repository: AgencyRepository;
  runId?: string;
  /** A plan already shown to and approved by the operator. */
  plan?: ResearchPlan;
  planOptions?: BuildPlanOptions;
  discovery?: DiscoveryPort;
  onProgress?: (progress: AutonomousProgress) => void;
  now?: () => Date;
  scanOptions?: ScanOptions;
  mobileOptions?: { executablePath?: string; allowLoopbackForTesting?: boolean };
  disableMobile?: boolean;
  /** Safety valve for the first real runs: never touch more than N targets. */
  maxTargets?: number;
}

export interface AutonomousRunResult {
  plan: ResearchPlan;
  leads: ResearchResultItem[];
  decisions: BusinessDecision[];
  targets: TargetOutcome[];
  issues: ResearchIssue[];
  report: FinalReport;
  stoppedBecause: string;
  startedAt: string;
  finishedAt: string;
}

/** Reads from the result what the triage needs, without re-deriving anything. */
export function toTriageInput(item: ResearchResultItem): TriageInput {
  return {
    businessId: item.businessId,
    businessName: item.name,
    score: {
      score: item.score,
      confidence: item.confidence,
      tier: item.tier,
      factors: item.factors,
      recommendedService: item.recommendedService,
      recommendationReason: item.recommendationReason,
    },
    websiteResolved: item.websiteResolution?.status ? item.websiteResolution.status !== "NO_VERIFICADO" : false,
    hasScan: item.evidence.some((e) => e.method === "html_parse"),
    hasMobileAudit: item.mobileAudit?.status === "completed",
    competitorCount: item.competitors.length,
    hasContradictions: item.verificationStatus === "NO_VERIFICADO",
  };
}

export async function runAutonomousResearch(options: AutonomousRunOptions): Promise<AutonomousRunResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const runId = options.runId ?? null;

  const emit = (progress: AutonomousProgress) => options.onProgress?.(progress);

  emit({
    phase: "PLANNING",
    targetIndex: 0,
    targetCount: 0,
    currentTarget: null,
    leadsSoFar: 0,
    steps: [],
  });

  const plan = options.plan ?? buildPlan(options.goal, { now: startedAt, ...options.planOptions });
  const plannedTargets =
    options.maxTargets != null ? plan.targets.slice(0, options.maxTargets) : plan.targets;

  const leads: ResearchResultItem[] = [];
  const decisions: BusinessDecision[] = [];
  const outcomes: TargetOutcome[] = [];
  const issues: ResearchIssue[] = [];
  let stoppedBecause = "Plan completado: se agotaron los objetivos previstos.";

  for (const [index, target] of plannedTargets.entries()) {
    const elapsed = now().getTime() - startedAt.getTime();

    // Global ceilings, checked before spending anything on the next target.
    if (leads.length >= plan.stop.maxLeads) {
      stoppedBecause = `Se alcanzó el objetivo de ${plan.stop.maxLeads} leads.`;
      outcomes.push({ target, found: 0, skipped: true, reason: stoppedBecause, issues: [] });
      continue;
    }
    if (elapsed >= plan.stop.maxDurationMs) {
      stoppedBecause = `Se agotó el presupuesto de tiempo (${Math.round(plan.stop.maxDurationMs / 60000)} min).`;
      outcomes.push({ target, found: 0, skipped: true, reason: stoppedBecause, issues: [] });
      continue;
    }

    emit({
      phase: "RESEARCHING",
      targetIndex: index,
      targetCount: plannedTargets.length,
      currentTarget: `${target.subsector} en ${target.municipality}`,
      leadsSoFar: leads.length,
      steps: [],
    });

    const remaining = plan.stop.maxLeads - leads.length;
    const run = await runResearch({
      config: {
        municipality: target.municipality,
        sector: target.sector,
        subsector: target.subsector,
        maxBusinesses: Math.min(target.maxBusinesses, remaining),
        depth: plan.depth,
      },
      repository: options.repository,
      runId: runId ?? undefined,
      discovery: options.discovery,
      now,
      scanOptions: options.scanOptions,
      mobileOptions: options.mobileOptions,
      disableMobile: options.disableMobile,
      onProgress: (steps) =>
        emit({
          phase: "RESEARCHING",
          targetIndex: index,
          targetCount: plannedTargets.length,
          currentTarget: `${target.subsector} en ${target.municipality}`,
          leadsSoFar: leads.length,
          steps,
        }),
    });

    issues.push(...run.issues);

    if (run.status === "FAILED") {
      // One dead target does not end the sweep (§13); it is recorded and the
      // plan continues with the next one.
      outcomes.push({
        target,
        found: 0,
        skipped: false,
        reason: `El objetivo falló: ${run.error ?? "error desconocido"}.`,
        issues: run.issues,
      });
      continue;
    }

    emit({
      phase: "DECIDING",
      targetIndex: index,
      targetCount: plannedTargets.length,
      currentTarget: `${target.subsector} en ${target.municipality}`,
      leadsSoFar: leads.length,
      steps: run.steps,
    });

    let kept = 0;
    for (const item of run.results) {
      const input = toTriageInput(item);
      const decision = triage(input, plan.deepening);
      const directives = openQuestionsFor(input);
      const stop = shouldStop(
        {
          round: 1,
          requestsUsed: 0,
          elapsedMs: now().getTime() - startedAt.getTime(),
          score: input.score,
          directives,
          triage: decision.triage,
          previousScore: null,
        },
        plan.stop
      );

      decisions.push({
        businessId: item.businessId,
        businessName: item.name,
        triage: decision,
        directives,
        stop,
      });

      recordEvent({
        type: "DECISION_MADE",
        runId,
        businessId: item.businessId,
        businessName: item.name,
        municipality: item.city,
        sector: item.sector,
        source: null,
        summary: `Triaje ${decision.triage}: ${decision.reason} Parada: ${stop.code ?? "continúa"}.`,
        data: {
          triage: decision.triage,
          stopCode: stop.code,
          openQuestions: directives.map((d) => d.kind),
          pointsAtStake: directives.reduce((sum, d) => sum + d.pointsAtStake, 0),
        },
      });

      // Class D is dropped from the deliverable but kept in the memory log:
      // the discard is a decision, and it has to be auditable.
      if (decision.triage === "D") continue;
      leads.push(item);
      kept += 1;
    }

    outcomes.push({
      target,
      found: kept,
      skipped: false,
      reason:
        kept > 0
          ? `${kept} de ${run.results.length} negocios pasaron el triaje.`
          : `Ninguno de los ${run.results.length} negocios analizados superó el triaje.`,
      issues: run.issues,
    });
  }

  emit({
    phase: "REPORTING",
    targetIndex: plannedTargets.length,
    targetCount: plannedTargets.length,
    currentTarget: null,
    leadsSoFar: leads.length,
    steps: [],
  });

  const ranked = prioritize(leads);
  const finishedAt = now();
  const report = buildFinalReport({
    plan,
    leads: ranked,
    decisions,
    targets: outcomes,
    issues,
    stoppedBecause,
    elapsedMs: finishedAt.getTime() - startedAt.getTime(),
  });

  recordEvent({
    type: "CONCLUSION_REACHED",
    runId,
    businessId: null,
    businessName: null,
    municipality: null,
    sector: null,
    source: null,
    summary: `Investigación autónoma terminada: ${ranked.length} leads sobre ${outcomes.filter((o) => !o.skipped).length} objetivos. ${stoppedBecause}`,
    data: {
      leads: ranked.length,
      targetsExecuted: outcomes.filter((o) => !o.skipped).length,
      targetsSkipped: outcomes.filter((o) => o.skipped).length,
      stoppedBecause,
    },
    at: finishedAt.toISOString(),
  });

  emit({
    phase: "DONE",
    targetIndex: plannedTargets.length,
    targetCount: plannedTargets.length,
    currentTarget: null,
    leadsSoFar: ranked.length,
    steps: [],
  });

  return {
    plan,
    leads: ranked,
    decisions,
    targets: outcomes,
    issues,
    report,
    stoppedBecause,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };
}

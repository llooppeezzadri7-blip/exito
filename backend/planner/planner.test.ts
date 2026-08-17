import { beforeEach, describe, expect, it } from "vitest";
import { buildPlan, planUsesHistory } from "./planner";
import {
  openQuestionsFor,
  prioritize,
  shouldRevisit,
  shouldStop,
  triage,
  unassessedPoints,
  type TriageInput,
} from "./triage";
import { recordSourceQuery, resetMemory } from "@/lib/memory/research-memory";
import { resetErrorMemory, seedKnownErrors } from "@/lib/memory/error-memory";
import { MIN_SAMPLE_FOR_ACTION } from "@/lib/memory/learning";
import type { CommercialFactor, CommercialScoreResult } from "@/lib/scoring/commercial-score";
import type { ResearchGoal, DeepeningCriteria, StopCriteria } from "./types";
import type { ResearchResultItem } from "@/backend/research/types";

const GOAL: ResearchGoal = {
  statement: "Encuentra los mejores prospectos de la Costa Brava para mi agencia.",
  zone: "Costa Brava",
  maxLeads: 20,
  maxDepth: "profunda",
  municipalities: ["Blanes", "Roses"],
  sectors: ["Hostelería"],
};

const DEEPENING: DeepeningCriteria = {
  deepenAboveScore: 60,
  reResearchBelowConfidence: 0.8,
  discardBelowScore: 25,
};

const STOP: StopCriteria = {
  maxRounds: 2,
  maxRequestsPerBusiness: 25,
  maxDurationMs: 600_000,
  sufficientConfidence: 0.8,
  maxLeads: 20,
};

function factor(key: string, points: number, max: number, status: CommercialFactor["status"]): CommercialFactor {
  return { key: key as CommercialFactor["key"], label: key, max, points, status, evidence: [] };
}

function scoreResult(overrides: Partial<CommercialScoreResult> = {}): CommercialScoreResult {
  return {
    score: 50,
    confidence: 0.7,
    tier: "MEDIA",
    recommendedService: null,
    recommendationReason: null,
    factors: [
      factor("necesidad", 10, 25, "VERIFICADO"),
      factor("impacto_economico", 12, 20, "VERIFICADO"),
      factor("capacidad_pago", 10, 15, "VERIFICADO"),
      factor("facilidad_contacto", 6, 10, "VERIFICADO"),
      factor("competencia", 0, 10, "NO_VERIFICADO"),
      factor("urgencia", 6, 10, "PROBABLE"),
      factor("ajuste_servicios", 6, 10, "VERIFICADO"),
    ],
    ...overrides,
  };
}

function triageInput(overrides: Partial<TriageInput> = {}): TriageInput {
  return {
    businessId: "b1",
    businessName: "Can Prova",
    score: scoreResult(),
    websiteResolved: true,
    hasScan: true,
    hasMobileAudit: true,
    competitorCount: 3,
    hasContradictions: false,
    ...overrides,
  };
}

beforeEach(() => {
  resetMemory();
  resetErrorMemory();
});

describe("FASE 4.1 — planificación", () => {
  it("genera objetivos para cada municipio y subsector del ámbito", () => {
    const plan = buildPlan(GOAL, { now: new Date("2026-02-10") });

    expect(plan.targets.length).toBeGreaterThan(0);
    expect(new Set(plan.targets.map((t) => t.municipality))).toEqual(new Set(["Blanes", "Roses"]));
    expect(plan.targets.every((t) => t.sector === "Hostelería")).toBe(true);
  });

  it("NO inventa estadísticas cuando no hay historial", () => {
    const plan = buildPlan(GOAL, { now: new Date("2026-02-10") });

    const municipal = plan.targets[0].justification;
    expect(municipal.basis).toBe("no_history_yet");
    expect(municipal.sampleSize).toBe(0);
    expect(municipal.reason).toContain("no hay evidencia histórica suficiente");
    expect(planUsesHistory(plan)).toBe(false);
  });

  it("usa el historial cuando la muestra es suficiente, citando la cifra", () => {
    for (let i = 0; i < MIN_SAMPLE_FOR_ACTION; i++) {
      recordSourceQuery(
        {
          source: "openstreetmap", municipality: "Roses", sector: "Hostelería",
          category: "Restaurantes", returned: 20, usable: 15, ok: true, durationMs: 10, error: null,
        },
        { runId: `r${i}` }
      );
    }

    const plan = buildPlan(GOAL, { now: new Date("2026-02-10") });
    const roses = plan.targets.find((t) => t.municipality === "Roses")!;

    expect(roses.justification.basis).toBe("historical_evidence");
    expect(roses.justification.sampleSize).toBe(MIN_SAMPLE_FOR_ACTION);
    expect(roses.justification.reason).toContain("15.0 negocios aprovechables");
    expect(planUsesHistory(plan)).toBe(true);
  });

  it("expone los riesgos conocidos por errores anteriores", () => {
    seedKnownErrors();
    const withFixed = buildPlan(GOAL, { now: new Date("2026-02-10") });
    // Los dos errores sembrados están corregidos: no deben figurar como riesgo abierto.
    expect(withFixed.decisions.some((d) => d.decision.startsWith("Riesgo conocido"))).toBe(false);
  });

  it("declara sus criterios de parada y profundización", () => {
    const plan = buildPlan(GOAL, { now: new Date("2026-02-10") });

    expect(plan.stop.maxLeads).toBe(20);
    expect(plan.decisions.some((d) => d.decision === "Criterios de parada")).toBe(true);
    expect(plan.decisions.some((d) => d.decision === "Criterios de profundización")).toBe(true);
  });

  it("el coste estimado sigue siendo cero con fuentes abiertas", () => {
    const plan = buildPlan(GOAL, { now: new Date("2026-02-10") });
    expect(plan.estimatedCostUsd).toBe(0);
  });

  it("ordena por estacionalidad: la antesala de temporada va antes que el pico", () => {
    const agosto = buildPlan(GOAL, { now: new Date("2026-08-14") });
    const febrero = buildPlan(GOAL, { now: new Date("2026-02-10") });

    const posicion = (plan: typeof agosto, subsector: string) =>
      plan.targets.findIndex((t) => t.subsector === subsector);

    // El mismo subsector cambia de sitio según el mes: en febrero los
    // restaurantes están en la antesala de temporada y encabezan el plan; en
    // agosto están saturados y caen por detrás de los sectores no estacionales.
    expect(febrero.targets[0].subsector).toBe("Restaurantes");
    expect(febrero.targets[0].justification.reason).toContain("Antesala");

    expect(posicion(agosto, "Restaurantes")).toBeGreaterThan(posicion(agosto, "Bares y cafeterías"));
    const restaurantesEnAgosto = agosto.targets[posicion(agosto, "Restaurantes")];
    expect(restaurantesEnAgosto.justification.reason).toContain("Temporada alta");
  });
});

describe("FASE 4.2 — triaje adaptativo", () => {
  it("clase A para una puntuación alta", () => {
    const decision = triage(triageInput({ score: scoreResult({ score: 78, confidence: 0.9 }) }), DEEPENING);
    expect(decision.triage).toBe("A");
  });

  it("clase A cuando las fuentes se contradicen, por encima de cualquier puntuación", () => {
    const decision = triage(
      triageInput({ hasContradictions: true, score: scoreResult({ score: 10 }) }),
      DEEPENING
    );
    expect(decision.triage).toBe("A");
    expect(decision.reason).toContain("contradictorias");
  });

  it("NO descarta un negocio con puntuación baja pero apenas evaluado", () => {
    const decision = triage(
      triageInput({
        score: scoreResult({
          score: 10,
          confidence: 0.3,
          factors: [
            factor("necesidad", 0, 25, "NO_VERIFICADO"),
            factor("impacto_economico", 0, 20, "NO_VERIFICADO"),
            factor("capacidad_pago", 0, 15, "NO_VERIFICADO"),
            factor("facilidad_contacto", 10, 10, "VERIFICADO"),
            factor("competencia", 0, 10, "NO_VERIFICADO"),
            factor("urgencia", 0, 10, "NO_VERIFICADO"),
            factor("ajuste_servicios", 0, 10, "NO_VERIFICADO"),
          ],
        }),
        websiteResolved: false,
        hasScan: false,
        competitorCount: 0,
      }),
      DEEPENING
    );

    expect(decision.triage).toBe("B");
    expect(decision.reason).toContain("sin evaluar");
  });

  it("descarta solo cuando la puntuación es baja Y el modelo está evaluado", () => {
    const decision = triage(
      triageInput({
        score: scoreResult({
          score: 15,
          confidence: 0.95,
          factors: [
            factor("necesidad", 0, 25, "VERIFICADO"),
            factor("impacto_economico", 5, 20, "VERIFICADO"),
            factor("capacidad_pago", 4, 15, "VERIFICADO"),
            factor("facilidad_contacto", 6, 10, "VERIFICADO"),
            factor("competencia", 0, 10, "VERIFICADO"),
            factor("urgencia", 0, 10, "PROBABLE"),
            factor("ajuste_servicios", 0, 10, "VERIFICADO"),
          ],
        }),
      }),
      DEEPENING
    );

    expect(decision.triage).toBe("D");
  });

  it("clase C cuando la evidencia ya alcanza y no hay grandes incógnitas", () => {
    const decision = triage(
      triageInput({
        score: scoreResult({
          score: 45,
          confidence: 0.9,
          factors: [
            factor("necesidad", 10, 25, "VERIFICADO"),
            factor("impacto_economico", 12, 20, "VERIFICADO"),
            factor("capacidad_pago", 10, 15, "VERIFICADO"),
            factor("facilidad_contacto", 6, 10, "VERIFICADO"),
            factor("competencia", 3, 10, "VERIFICADO"),
            factor("urgencia", 4, 10, "PROBABLE"),
            factor("ajuste_servicios", 0, 10, "NO_VERIFICADO"),
          ],
        }),
      }),
      DEEPENING
    );

    expect(decision.triage).toBe("C");
  });

  it("cuenta los puntos que quedan sin evaluar", () => {
    expect(unassessedPoints(scoreResult())).toBe(10);
  });
});

describe("FASE 4.3 — segunda investigación dirigida", () => {
  it("nombra la comprobación concreta, no 'investigar más'", () => {
    const directives = openQuestionsFor(triageInput({ websiteResolved: false }));
    const website = directives.find((d) => d.kind === "website_unresolved")!;

    expect(website.action).toContain("candidatos de web");
    expect(website.action).not.toMatch(/investigar más/i);
  });

  it("prioriza la incógnita que más puntos puede mover", () => {
    const directives = openQuestionsFor(
      triageInput({
        websiteResolved: false,
        hasScan: false,
        competitorCount: 0,
        score: scoreResult({
          factors: [
            factor("necesidad", 0, 25, "NO_VERIFICADO"),
            factor("competencia", 0, 10, "NO_VERIFICADO"),
            factor("capacidad_pago", 10, 15, "VERIFICADO"),
            factor("impacto_economico", 12, 20, "VERIFICADO"),
            factor("facilidad_contacto", 6, 10, "VERIFICADO"),
            factor("urgencia", 6, 10, "PROBABLE"),
            factor("ajuste_servicios", 6, 10, "VERIFICADO"),
          ],
        }),
      })
    );

    expect(directives[0].pointsAtStake).toBe(25);
    expect(directives[0].kind).toBe("website_unresolved");
  });

  it("pide reservas en páginas internas cuando ya hay escaneo", () => {
    const directives = openQuestionsFor(triageInput());
    const booking = directives.find((d) => d.kind === "booking_unknown")!;

    expect(booking.action).toContain("páginas internas");
  });

  it("pide competidores exactamente los que faltan para llegar a 3", () => {
    const directives = openQuestionsFor(triageInput({ competitorCount: 1 }));
    const competitors = directives.find((d) => d.kind === "competitors_insufficient")!;

    expect(competitors.action).toContain("2 competidor");
  });

  it("no pide nada cuando todo está resuelto", () => {
    const directives = openQuestionsFor(
      triageInput({
        score: scoreResult({
          factors: scoreResult().factors.map((f) => ({ ...f, status: "VERIFICADO" as const })),
        }),
      })
    );

    expect(directives.every((d) => d.pointsAtStake === 0)).toBe(true);
  });
});

describe("FASE 4.5 — decisión de parada", () => {
  it("para al alcanzar confianza suficiente sin incógnitas grandes", () => {
    const decision = shouldStop(
      {
        round: 1, requestsUsed: 5, elapsedMs: 1000,
        score: scoreResult({ confidence: 0.85 }), directives: [], triage: "C", previousScore: null,
      },
      STOP
    );

    expect(decision.stop).toBe(true);
    expect(decision.code).toBe("SUFFICIENT_CONFIDENCE");
  });

  it("para al agotar las rondas", () => {
    const decision = shouldStop(
      {
        round: 2, requestsUsed: 5, elapsedMs: 1000,
        score: scoreResult({ confidence: 0.4 }),
        directives: [{ kind: "no_scan", action: "x", unblocks: "necesidad", pointsAtStake: 25 }],
        triage: "A", previousScore: null,
      },
      STOP
    );

    expect(decision.stop).toBe(true);
    expect(decision.code).toBe("MAX_ROUNDS");
  });

  it("para al agotar las peticiones por negocio", () => {
    const decision = shouldStop(
      {
        round: 1, requestsUsed: 25, elapsedMs: 1000,
        score: scoreResult({ confidence: 0.4 }), directives: [], triage: "A", previousScore: null,
      },
      STOP
    );

    expect(decision.code).toBe("MAX_REQUESTS");
  });

  it("para por tiempo límite", () => {
    const decision = shouldStop(
      {
        round: 1, requestsUsed: 1, elapsedMs: 700_000,
        score: scoreResult(), directives: [], triage: "A", previousScore: null,
      },
      STOP
    );

    expect(decision.code).toBe("TIMEOUT");
  });

  it("para cuando una ronda no cambió nada", () => {
    const decision = shouldStop(
      {
        round: 2, requestsUsed: 5, elapsedMs: 1000,
        score: scoreResult({ score: 50, confidence: 0.5 }),
        directives: [{ kind: "no_scan", action: "x", unblocks: "necesidad", pointsAtStake: 25 }],
        triage: "A", previousScore: 50,
      },
      { ...STOP, maxRounds: 5 }
    );

    expect(decision.code).toBe("NO_PROGRESS");
  });

  it("continúa mientras haya puntos importantes en juego", () => {
    const decision = shouldStop(
      {
        round: 1, requestsUsed: 2, elapsedMs: 1000,
        score: scoreResult({ confidence: 0.5 }),
        directives: [{ kind: "no_scan", action: "x", unblocks: "necesidad", pointsAtStake: 25 }],
        triage: "A", previousScore: null,
      },
      STOP
    );

    expect(decision.stop).toBe(false);
    expect(decision.reason).toContain("25 puntos en juego");
  });

  it("siempre registra el motivo de la parada", () => {
    const decision = shouldStop(
      { round: 1, requestsUsed: 1, elapsedMs: 1, score: scoreResult(), directives: [], triage: "D", previousScore: null },
      STOP
    );

    expect(decision.reason.length).toBeGreaterThan(10);
    expect(decision.code).toBe("DISCARDED");
  });
});

describe("FASE 4.9 — evitar repeticiones", () => {
  const now = new Date("2026-08-14T00:00:00Z");

  it("investiga un negocio nunca visto", () => {
    expect(shouldRevisit(null, now, null).revisit).toBe(true);
  });

  it("no repite un negocio investigado hace poco", () => {
    const decision = shouldRevisit("2026-08-01T00:00:00Z", now, { score: 70, confidence: 0.9 });

    expect(decision.revisit).toBe(false);
    expect(decision.reason).toContain("13 días");
  });

  it("pasados 30 días revisa solo lo que puede haber cambiado", () => {
    const decision = shouldRevisit("2026-06-01T00:00:00Z", now, { score: 70, confidence: 0.9 });

    expect(decision.revisit).toBe(true);
    expect(decision.checks).toContain("web (cambios y disponibilidad)");
    expect(decision.checks).not.toContain("investigación completa");
  });

  it("añade los factores pendientes si la confianza era baja", () => {
    const decision = shouldRevisit("2026-06-01T00:00:00Z", now, { score: 70, confidence: 0.5 });
    expect(decision.checks).toContain("factores que quedaron sin evaluar");
  });
});

describe("FASE 4.6 — priorización", () => {
  it("ordena por puntuación y desempata por evidencia", () => {
    const items = [
      { score: 70, confidence: 0.6, factors: [] },
      { score: 70, confidence: 0.9, factors: [] },
      { score: 85, confidence: 0.5, factors: [] },
    ] as unknown as ResearchResultItem[];

    const ordered = prioritize(items);
    expect(ordered.map((i) => i.score)).toEqual([85, 70, 70]);
    expect(ordered[1].confidence).toBe(0.9);
  });

  it("desempata por facilidad de contacto cuando todo lo demás empata", () => {
    const items = [
      { score: 70, confidence: 0.8, factors: [factor("facilidad_contacto", 4, 10, "VERIFICADO")] },
      { score: 70, confidence: 0.8, factors: [factor("facilidad_contacto", 10, 10, "VERIFICADO")] },
    ] as unknown as ResearchResultItem[];

    expect(prioritize(items)[0].factors[0].points).toBe(10);
  });
});

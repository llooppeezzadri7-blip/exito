import { beforeEach, describe, expect, it } from "vitest";
import {
  hasBeenResearched,
  memoryStats,
  queryEvents,
  recordEvent,
  recordOutcome,
  recordSourceQuery,
  resetMemory,
} from "./research-memory";
import {
  buildLearningReport,
  MIN_SAMPLE_FOR_ACTION,
  preferredSourceOrder,
  signalPerformance,
  sourcePerformance,
} from "./learning";
import {
  attachRegressionTest,
  errorPatterns,
  isKnownRisk,
  listErrors,
  markFixed,
  recordError,
  resetErrorMemory,
  seedKnownErrors,
} from "./error-memory";
import {
  concludeExperiment,
  createExperiment,
  MIN_OBSERVATIONS_PER_VARIANT,
  pendingApproval,
  recordObservation,
  resetExperiments,
} from "./experiments";
import { checkAutonomousChange, HARD_CONSTRAINTS } from "./hard-constraints";

beforeEach(() => {
  resetMemory();
  resetErrorMemory();
  resetExperiments();
});

function logQueries(source: "openstreetmap" | "turisme_cat", times: number, usable: number) {
  for (let i = 0; i < times; i++) {
    recordSourceQuery(
      {
        source,
        municipality: "Blanes",
        sector: "Hostelería",
        category: "Restaurantes",
        returned: usable + 2,
        usable,
        ok: true,
        durationMs: 100,
        error: null,
      },
      { runId: `run-${i}` }
    );
  }
}

/** Campos de segmentación que la fase 5 añadió a OutcomeRecord. */
const OUTCOME_CONTEXT = {
  municipality: null,
  sector: null,
  businessSource: null,
  factorsAtTime: null,
  notes: null,
} as const;

describe("FASE 1 — memoria e historial", () => {
  it("registra lo que hizo cada fuente y lo puede consultar después", () => {
    logQueries("openstreetmap", 2, 8);

    const events = queryEvents({ type: "SOURCE_QUERIED", source: "openstreetmap" });
    expect(events).toHaveLength(2);
    expect(events[0].summary).toContain("8 aprovechables");
    expect(events[0].municipality).toBe("Blanes");
  });

  it("recuerda qué negocios ya investigó, para no repetirlos", () => {
    expect(hasBeenResearched("b1")).toBe(false);

    recordEvent({
      type: "CONCLUSION_REACHED",
      runId: "r1",
      businessId: "b1",
      businessName: "Can Prova",
      municipality: "Blanes",
      sector: "Hostelería",
      source: "openstreetmap",
      summary: "Puntuado 62 con confianza 78%.",
      data: { score: 62 },
    });

    expect(hasBeenResearched("b1")).toBe(true);
  });

  it("es append-only: una corrección no borra la conclusión equivocada", () => {
    recordEvent({
      type: "CONCLUSION_REACHED", runId: "r1", businessId: "b1", businessName: "X",
      municipality: null, sector: null, source: null,
      summary: "No tiene web.", data: {},
    });
    recordEvent({
      type: "CORRECTION_APPLIED", runId: "r1", businessId: "b1", businessName: "X",
      municipality: null, sector: null, source: null,
      summary: "Sí tenía web.", data: {},
    });

    const history = queryEvents({ businessId: "b1" });
    expect(history).toHaveLength(2);
    expect(history[0].summary).toBe("No tiene web.");
    expect(history[1].summary).toBe("Sí tenía web.");
  });

  it("resume el estado de la memoria", () => {
    logQueries("openstreetmap", 3, 5);
    recordOutcome({
      businessId: "b1", outcome: "WON", scoreAtTime: 82, confidenceAtTime: 0.9,
      recommendedService: "SEO local", soldService: "SEO local", ...OUTCOME_CONTEXT,
    });

    const stats = memoryStats();
    expect(stats.events).toBe(4);
    expect(stats.outcomes).toBe(1);
  });
});

describe("FASE 2 — aprendizaje", () => {
  it("mide el rendimiento real de cada fuente", () => {
    logQueries("openstreetmap", 4, 10);
    logQueries("turisme_cat", 4, 2);

    const performance = sourcePerformance();
    expect(performance[0].source).toBe("openstreetmap");
    expect(performance[0].yieldPerQuery).toBe(10);
    expect(performance[1].yieldPerQuery).toBe(2);
  });

  it("marca como insuficiente una muestra pequeña en vez de sacar conclusiones", () => {
    logQueries("openstreetmap", 3, 10);

    expect(sourcePerformance()[0].sampleSufficient).toBe(false);
    const report = buildLearningReport();
    expect(report.actionable).toHaveLength(0);
  });

  it("solo propone reordenar fuentes con muestra suficiente", () => {
    logQueries("openstreetmap", MIN_SAMPLE_FOR_ACTION, 10);
    logQueries("turisme_cat", MIN_SAMPLE_FOR_ACTION, 2);

    const report = buildLearningReport();
    const proposal = report.proposals.find((p) => p.kind === "source_priority")!;

    expect(proposal.statement).toContain("openstreetmap");
    expect(proposal.applicable).toBe(true);
    expect(proposal.evidence).toContain("consultas");
  });

  it("no reordena fuentes sin evidencia suficiente", () => {
    logQueries("openstreetmap", 2, 10);
    expect(preferredSourceOrder(["turisme_cat", "openstreetmap"])).toEqual([
      "turisme_cat",
      "openstreetmap",
    ]);
  });

  it("aprende qué señales preceden a una venta", () => {
    recordOutcome({ businessId: "b1", outcome: "WON", scoreAtTime: 85, confidenceAtTime: 0.9, recommendedService: "SEO local", soldService: "SEO local", ...OUTCOME_CONTEXT });
    recordOutcome({ businessId: "b2", outcome: "WON", scoreAtTime: 82, confidenceAtTime: 0.85, recommendedService: "SEO local", soldService: "SEO local", ...OUTCOME_CONTEXT });
    recordOutcome({ businessId: "b3", outcome: "LOST", scoreAtTime: 45, confidenceAtTime: 0.7, recommendedService: "Web", soldService: null, ...OUTCOME_CONTEXT });

    const signals = signalPerformance();
    const alto = signals.find((s) => s.signal === "score>=80")!;
    const bajo = signals.find((s) => s.signal === "score<60")!;

    expect(alto.winRate).toBe(1);
    expect(bajo.winRate).toBe(0);
    expect(alto.sampleSufficient).toBe(false); // 2 casos: se ve, no se actúa
  });

  it("NUNCA propone tocar el scoring de forma automática", () => {
    for (let i = 0; i < 20; i++) {
      recordOutcome({
        businessId: `b${i}`, outcome: "WON", scoreAtTime: 85, confidenceAtTime: 0.9,
        recommendedService: "SEO local", soldService: "SEO local", ...OUTCOME_CONTEXT,
      });
    }

    const report = buildLearningReport();
    const scoringProposals = report.proposals.filter((p) => p.constraint.violated?.area === "scoring_weights");

    expect(scoringProposals.length).toBeGreaterThan(0);
    expect(scoringProposals.every((p) => p.applicable === false)).toBe(true);
    expect(report.actionable.every((p) => p.constraint.allowed)).toBe(true);
  });
});

describe("restricciones duras", () => {
  it("ninguna regla crítica es modificable automáticamente", () => {
    for (const constraint of HARD_CONSTRAINTS) {
      expect(checkAutonomousChange(constraint.area).allowed).toBe(false);
    }
  });

  it("un área desconocida se rechaza por defecto", () => {
    expect(checkAutonomousChange("algo_nuevo_sin_clasificar").allowed).toBe(false);
  });

  it("las áreas de ajuste de búsqueda sí son autónomas", () => {
    expect(checkAutonomousChange("query_strategy").allowed).toBe(true);
    expect(checkAutonomousChange("source_priority").allowed).toBe(true);
  });
});

describe("FASE 2 — memoria de errores", () => {
  it("no deja marcar un error como corregido sin test de regresión", () => {
    const error = recordError({
      category: "false_absence", claim: "No tiene web", reality: "Sí la tiene",
      cause: "Se dedujo de no encontrarla", detectedBy: "user",
    });

    expect(() => markFixed(error.id, "arreglado")).toThrow(/test de regresión/);

    attachRegressionTest(error.id, "lib/scoring/website-absence.regression.test.ts");
    const fixed = markFixed(error.id, "Regla de dos fuentes");
    expect(fixed.status).toBe("FIXED");
  });

  it("recuerda los dos errores reales de este proyecto y sus correcciones", () => {
    seedKnownErrors();

    const errors = listErrors();
    expect(errors).toHaveLength(2);
    expect(errors.every((e) => e.status === "FIXED")).toBe(true);
    expect(errors.every((e) => e.regressionTest !== null)).toBe(true);
    expect(errors.map((e) => e.businessName)).toContain("Smile Dentik");
  });

  it("agrupa los errores en patrones con su lección", () => {
    seedKnownErrors();

    const patterns = errorPatterns();
    expect(patterns.map((p) => p.category)).toContain("false_absence");
    expect(patterns.find((p) => p.category === "false_absence")!.lesson).toContain("no existe");
  });

  it("sabe si un tipo de error sigue abierto", () => {
    recordError({
      category: "wrong_identity", claim: "x", reality: "y", cause: "z", detectedBy: "self_check",
    });

    expect(isKnownRisk("wrong_identity")).toBe(true);
    expect(isKnownRisk("duplicate_merge")).toBe(false);
  });
});

describe("FASE 3 — experimentos", () => {
  it("exige al menos dos variantes", () => {
    expect(() =>
      createExperiment({ hypothesis: "x", targetArea: "query_strategy", variants: [{ id: "a", description: "a" }] })
    ).toThrow(/dos variantes/);
  });

  it("no declara ganador sin observaciones suficientes", () => {
    const exp = createExperiment({
      hypothesis: "La consulta con especialidad rinde más",
      targetArea: "query_strategy",
      variants: [{ id: "a", description: "genérica" }, { id: "b", description: "con especialidad" }],
    });

    recordObservation(exp.id, "a", 5);
    recordObservation(exp.id, "b", 20);

    const concluded = concludeExperiment(exp.id);
    expect(concluded.conclusion!.verdict).toBe("insufficient_data");
    expect(concluded.conclusion!.autoApplicable).toBe(false);
  });

  it("declara ganador con muestra suficiente y diferencia clara", () => {
    const exp = createExperiment({
      hypothesis: "La consulta con especialidad rinde más",
      targetArea: "query_strategy",
      variants: [{ id: "a", description: "genérica" }, { id: "b", description: "con especialidad" }],
    });

    for (let i = 0; i < MIN_OBSERVATIONS_PER_VARIANT; i++) {
      recordObservation(exp.id, "a", 5);
      recordObservation(exp.id, "b", 10);
    }

    const concluded = concludeExperiment(exp.id);
    expect(concluded.conclusion!.verdict).toBe("winner");
    expect(concluded.conclusion!.winningVariantId).toBe("b");
    expect(concluded.conclusion!.autoApplicable).toBe(true);
  });

  it("no cambia nada si la diferencia es pequeña", () => {
    const exp = createExperiment({
      hypothesis: "x", targetArea: "query_strategy",
      variants: [{ id: "a", description: "a" }, { id: "b", description: "b" }],
    });

    for (let i = 0; i < MIN_OBSERVATIONS_PER_VARIANT; i++) {
      recordObservation(exp.id, "a", 10);
      recordObservation(exp.id, "b", 11);
    }

    expect(concludeExperiment(exp.id).conclusion!.verdict).toBe("no_difference");
  });

  it("un experimento sobre el scoring nunca se aplica solo", () => {
    const exp = createExperiment({
      hypothesis: "Subir el peso de capacidad de pago mejora el cierre",
      targetArea: "scoring_weights",
      variants: [{ id: "actual", description: "15 puntos" }, { id: "nuevo", description: "25 puntos" }],
    });

    expect(exp.constraint.allowed).toBe(false);

    for (let i = 0; i < MIN_OBSERVATIONS_PER_VARIANT; i++) {
      recordObservation(exp.id, "actual", 5);
      recordObservation(exp.id, "nuevo", 15);
    }

    const concluded = concludeExperiment(exp.id);
    expect(concluded.conclusion!.verdict).toBe("winner");
    expect(concluded.conclusion!.autoApplicable).toBe(false);
    expect(pendingApproval()).toHaveLength(1);
  });

  it("no acepta observaciones sobre un experimento ya cerrado", () => {
    const exp = createExperiment({
      hypothesis: "x", targetArea: "query_strategy",
      variants: [{ id: "a", description: "a" }, { id: "b", description: "b" }],
    });
    concludeExperiment(exp.id);

    expect(() => recordObservation(exp.id, "a", 1)).toThrow(/no está en curso/);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  baseWinRate,
  learnedMunicipalityOrder,
  predictiveSignals,
  priorityAdjustments,
  MIN_LIFT_POINTS,
} from "./predictive";
import { MIN_SAMPLE_FOR_ACTION } from "./learning";
import { recordEvent, recordOutcome, resetMemory, type LeadOutcome } from "./research-memory";
import { computeCommercialScore } from "@/lib/scoring/commercial-score";
import { MOCK_BUSINESSES, MOCK_SETTINGS } from "@/lib/database/mock-data";

/**
 * FASE 5.4 — does it actually learn, and does it stay inside the rules.
 *
 * The two halves matter equally. A system that never learns is useless; a
 * system that learns its way out of its own verification rules is dangerous.
 */

function outcome(
  overrides: Partial<Parameters<typeof recordOutcome>[0]> & { outcome: LeadOutcome }
) {
  recordOutcome({
    businessId: `b-${Math.random()}`,
    scoreAtTime: 70,
    confidenceAtTime: 0.85,
    recommendedService: null,
    soldService: null,
    municipality: null,
    sector: null,
    businessSource: null,
    factorsAtTime: null,
    notes: null,
    ...overrides,
  });
}

/** n leads in a municipality, of which `won` closed. */
function leadsIn(municipality: string, total: number, won: number) {
  for (let i = 0; i < total; i++) {
    outcome({ outcome: i < won ? "WON" : "LOST", municipality });
  }
}

beforeEach(() => {
  resetMemory();
});

describe("tasa base", () => {
  it("es cero mientras no haya ningún desenlace registrado", () => {
    expect(baseWinRate()).toEqual({ rate: 0, won: 0, total: 0 });
    expect(predictiveSignals()).toEqual([]);
  });

  it("cuenta también los leads que el sistema nunca puntuó", () => {
    outcome({ outcome: "WON", scoreAtTime: null, confidenceAtTime: null });
    outcome({ outcome: "LOST" });

    expect(baseWinRate().total).toBe(2);
    // ...pero ese lead no aporta nada a las bandas de puntuación, porque no
    // hay predicción que contrastar.
    const bands = predictiveSignals().filter((s) => s.dimension === "score");
    expect(bands.reduce((sum, b) => sum + b.total, 0)).toBe(1);
  });
});

describe("señales predictivas", () => {
  it("NO declara predictiva una señal sin muestra suficiente", () => {
    // 3 de 3 cerrados: 100% de acierto aparente, pero solo 3 casos.
    leadsIn("Blanes", 3, 3);
    leadsIn("Roses", 3, 0);

    const blanes = predictiveSignals().find((s) => s.signal === "municipio=Blanes")!;
    expect(blanes.winRate).toBe(1);
    expect(blanes.sampleSufficient).toBe(false);
    expect(blanes.predictive).toBe(false);
    expect(blanes.statement).toContain("Muestra insuficiente");
  });

  it("declara predictiva una señal con muestra y ventaja reales", () => {
    leadsIn("Blanes", 20, 16); // 80%
    leadsIn("Roses", 20, 2); //  10%

    const blanes = predictiveSignals().find((s) => s.signal === "municipio=Blanes")!;
    expect(blanes.sampleSufficient).toBe(true);
    expect(blanes.predictive).toBe(true);
    expect(blanes.liftPoints).toBeGreaterThan(MIN_LIFT_POINTS);
    // La afirmación siempre lleva la muestra a la vista.
    expect(blanes.statement).toContain("16 de 20");
    expect(blanes.statement).toContain("frente al");
  });

  it("NO declara predictiva una señal que solo iguala la tasa base", () => {
    // Todo cierra al 50%: ningún municipio aporta información.
    leadsIn("Blanes", 20, 10);
    leadsIn("Roses", 20, 10);

    for (const signal of predictiveSignals()) {
      expect(signal.predictive).toBe(false);
      expect(Math.abs(signal.liftPoints)).toBeLessThan(MIN_LIFT_POINTS);
    }
  });

  it("compara siempre contra la tasa base, no en abstracto", () => {
    // Todo cierra mucho: 70% no es una señal, es lo normal aquí.
    leadsIn("Blanes", 20, 14);
    leadsIn("Roses", 20, 14);

    const blanes = predictiveSignals().find((s) => s.signal === "municipio=Blanes")!;
    expect(Math.round(blanes.winRate * 100)).toBe(70);
    expect(Math.round(blanes.baseRate * 100)).toBe(70);
    expect(blanes.predictive).toBe(false);
  });

  it("el umbral de muestra es exactamente el declarado", () => {
    leadsIn("Blanes", MIN_SAMPLE_FOR_ACTION - 1, MIN_SAMPLE_FOR_ACTION - 1);
    expect(predictiveSignals().find((s) => s.signal === "municipio=Blanes")!.sampleSufficient).toBe(
      false
    );

    resetMemory();
    leadsIn("Blanes", MIN_SAMPLE_FOR_ACTION, MIN_SAMPLE_FOR_ACTION);
    expect(predictiveSignals().find((s) => s.signal === "municipio=Blanes")!.sampleSufficient).toBe(
      true
    );
  });
});

describe("ajustes de prioridad", () => {
  it("con muestra insuficiente no genera ningún ajuste", () => {
    leadsIn("Blanes", 5, 5);
    expect(priorityAdjustments()).toEqual([]);
    expect(learnedMunicipalityOrder()).toBeNull();
  });

  it("con muestra suficiente reordena los municipios", () => {
    leadsIn("Blanes", 20, 18);
    leadsIn("Roses", 20, 1);

    const learned = learnedMunicipalityOrder();
    expect(learned).not.toBeNull();
    expect(learned!.order[0]).toBe("Blanes");
    expect(learned!.sampleSize).toBeGreaterThanOrEqual(20);
  });

  it("una señal sobre la puntuación NUNCA produce un ajuste automático", () => {
    // 30 ventas, todas con puntuación alta: evidencia abrumadora de que la
    // banda alta funciona. Aun así no puede tocar el modelo.
    for (let i = 0; i < 30; i++) outcome({ outcome: "WON", scoreAtTime: 90 });
    for (let i = 0; i < 30; i++) outcome({ outcome: "LOST", scoreAtTime: 30 });

    const band = predictiveSignals().find((s) => s.signal === "puntuación>=80")!;
    expect(band.predictive).toBe(true); // se ve...

    // ...pero no se convierte en ningún ajuste aplicable.
    const adjustments = priorityAdjustments();
    expect(adjustments.every((a) => a.area !== "scoring_weights")).toBe(true);
    expect(adjustments.filter((a) => a.area === "municipality_order")).toEqual([]);
  });

  it("un ajuste sobre un área prohibida llega marcado como no aplicable", () => {
    leadsIn("Blanes", 20, 18);
    for (const adjustment of priorityAdjustments()) {
      if (!adjustment.constraint.allowed) expect(adjustment.applicable).toBe(false);
    }
  });
});

describe("las reglas duras siguen intactas después de aprender", () => {
  it("los pesos del scoring no cambian por mucha evidencia que haya", () => {
    // Los máximos se comprueban a través de la salida real del modelo, que es
    // lo que de verdad importa: si el aprendizaje reponderase algo, aquí se
    // vería aunque la constante interna siguiera intacta.
    const maxesOf = () =>
      Object.fromEntries(
        computeCommercialScore({
          business: MOCK_BUSINESSES[0],
          scan: null,
          settings: MOCK_SETTINGS,
          peers: [],
          now: new Date("2026-02-10"),
        }).factors.map((f) => [f.key, f.max])
      );

    const before = maxesOf();

    for (let i = 0; i < 50; i++) {
      outcome({
        outcome: "WON",
        scoreAtTime: 95,
        municipality: "Blanes",
        sector: "Hostelería",
        businessSource: "openstreetmap",
        factorsAtTime: { necesidad: 25, impacto_economico: 20 },
      });
    }

    predictiveSignals();
    priorityAdjustments();
    learnedMunicipalityOrder();

    const after = maxesOf();
    expect(after).toEqual(before);
    expect(Object.values(after).reduce((sum, value) => sum + value, 0)).toBe(100);
    expect(after).toEqual({
      necesidad: 25,
      impacto_economico: 20,
      capacidad_pago: 15,
      facilidad_contacto: 10,
      competencia: 10,
      urgencia: 10,
      ajuste_servicios: 10,
    });
  });

  it("aprender no reescribe el log: los desenlaces siguen siendo los registrados", () => {
    leadsIn("Blanes", 12, 9);
    const snapshot = baseWinRate();

    predictiveSignals();
    priorityAdjustments();

    expect(baseWinRate()).toEqual(snapshot);
  });

  it("un evento de decisión no se confunde con un desenlace", () => {
    recordEvent({
      type: "DECISION_MADE",
      runId: null,
      businessId: "b1",
      businessName: "Can Prova",
      municipality: "Blanes",
      sector: null,
      source: null,
      summary: "Triaje A.",
      data: { triage: "A" },
    });

    expect(baseWinRate().total).toBe(0);
    expect(predictiveSignals()).toEqual([]);
  });
});

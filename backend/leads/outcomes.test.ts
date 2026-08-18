import { beforeEach, describe, expect, it } from "vitest";
import { isTerminalStage, outcomeForStage, recordLeadOutcome } from "./outcomes";
import { MockAgencyRepository } from "@/lib/database/mock-repository";
import { mockStore } from "@/lib/database/mock-store";
import { recordEvent, resetMemory } from "@/lib/memory/research-memory";
import { baseWinRate, predictiveSignals } from "@/lib/memory/predictive";
import type { LeadStage } from "@/lib/database/types";

/**
 * FASE 5.3 — ground truth.
 *
 * The property that matters: what gets recorded is what the system predicted
 * *before* it knew the answer. If the outcome recorder ever reached for a
 * fresh score, the whole learning loop would be measuring itself against
 * itself.
 */

function conclusion(businessId: string, score: number, at: string, extra: Record<string, unknown> = {}) {
  recordEvent({
    type: "CONCLUSION_REACHED",
    runId: "run-1",
    businessId,
    businessName: "Can Prova",
    municipality: "Blanes",
    sector: "Hostelería",
    source: "openstreetmap",
    summary: `Puntuado ${score}/100.`,
    data: {
      score,
      confidence: 0.8,
      tier: "ALTA",
      recommendedService: "SEO local",
      factors: [{ key: "necesidad", points: 20 }],
      ...extra,
    },
    at,
  });
}

let repository: MockAgencyRepository;

beforeEach(() => {
  mockStore.businesses = [];
  mockStore.scores = [];
  mockStore.websiteScans = [];
  resetMemory();
  repository = new MockAgencyRepository();
});

describe("estados terminales", () => {
  it("solo WON, LOST y NOT_INTERESTED cierran un lead", () => {
    expect(isTerminalStage("WON")).toBe(true);
    expect(isTerminalStage("LOST")).toBe(true);
    expect(isTerminalStage("NOT_INTERESTED")).toBe(true);

    for (const stage of ["NEW", "CONTACTED", "REPLIED", "MEETING", "PROPOSAL"] as LeadStage[]) {
      expect(isTerminalStage(stage)).toBe(false);
    }
  });

  it("distingue 'no interesado' de 'perdido'", () => {
    expect(outcomeForStage("LOST")).toBe("LOST");
    expect(outcomeForStage("NOT_INTERESTED")).toBe("NOT_A_FIT");
  });
});

describe("registro del desenlace", () => {
  it("un estado intermedio no registra nada", async () => {
    const result = await recordLeadOutcome({ businessId: "b1", stage: "CONTACTED", repository });

    expect(result.recorded).toBe(false);
    expect(baseWinRate().total).toBe(0);
    expect(result.reason).toContain("no es un estado final");
  });

  it("guarda la puntuación que el sistema dio EN SU MOMENTO", async () => {
    conclusion("b1", 72, "2026-01-10T09:00:00Z");
    // Una reinvestigación posterior la corrigió al alza.
    conclusion("b1", 91, "2026-02-10T09:00:00Z");

    const result = await recordLeadOutcome({ businessId: "b1", stage: "WON", repository });

    expect(result.recorded).toBe(true);
    expect(result.hadPrediction).toBe(true);
    // La última conclusión antes del desenlace, no una recalculada ahora.
    expect(result.reason).toContain("91/100");

    const band = predictiveSignals().find((s) => s.dimension === "score")!;
    expect(band.signal).toBe("puntuación>=80");
  });

  it("un lead que nunca se puntuó se registra SIN inventar una puntuación", async () => {
    const result = await recordLeadOutcome({ businessId: "sin-historial", stage: "WON", repository });

    expect(result.recorded).toBe(true);
    expect(result.hadPrediction).toBe(false);
    expect(result.reason).toContain("nunca fue puntuado");

    // Cuenta para la tasa base...
    expect(baseWinRate().total).toBe(1);
    // ...pero no genera ninguna banda de puntuación inventada.
    expect(predictiveSignals().filter((s) => s.dimension === "score")).toEqual([]);
  });

  it("arrastra municipio, sector y fuente para poder segmentar después", async () => {
    conclusion("b1", 85, "2026-01-10T09:00:00Z");
    await recordLeadOutcome({ businessId: "b1", stage: "WON", repository });

    const signals = predictiveSignals().map((s) => s.signal);
    expect(signals).toContain("municipio=Blanes");
    expect(signals).toContain("sector=Hostelería");
    expect(signals).toContain("fuente=openstreetmap");
    expect(signals).toContain("servicio=SEO local");
  });

  it("un desenlace negativo cuenta igual que uno positivo", async () => {
    conclusion("b1", 85, "2026-01-10T09:00:00Z");
    conclusion("b2", 85, "2026-01-10T09:00:00Z");

    await recordLeadOutcome({ businessId: "b1", stage: "WON", repository });
    await recordLeadOutcome({ businessId: "b2", stage: "NOT_INTERESTED", repository });

    const base = baseWinRate();
    expect(base.total).toBe(2);
    expect(base.won).toBe(1);
    expect(base.rate).toBe(0.5);
  });

  it("permite registrar un desenlace explícito distinto del estado", async () => {
    conclusion("b1", 60, "2026-01-10T09:00:00Z");

    const result = await recordLeadOutcome({
      businessId: "b1",
      stage: "CONTACTED",
      repository,
      outcome: "NO_REPLY",
    });

    expect(result.recorded).toBe(true);
    expect(result.outcome).toBe("NO_REPLY");
    expect(baseWinRate().total).toBe(1);
    expect(baseWinRate().won).toBe(0);
  });
});

describe("el bucle completo: predecir, vender, aprender", () => {
  it("veinte desenlaces reales convierten una corazonada en una conclusión con muestra", async () => {
    // Antes: ninguna señal.
    expect(predictiveSignals()).toEqual([]);

    for (let i = 0; i < 20; i++) {
      const id = `b${i}`;
      const won = i < 16;
      recordEvent({
        type: "CONCLUSION_REACHED",
        runId: "run-1",
        businessId: id,
        businessName: `Negocio ${i}`,
        municipality: "Blanes",
        sector: "Hostelería",
        source: "openstreetmap",
        summary: "Puntuado.",
        data: { score: 85, confidence: 0.9, recommendedService: "SEO local", factors: [] },
        at: "2026-01-10T09:00:00Z",
      });
      await recordLeadOutcome({
        businessId: id,
        stage: won ? "WON" : "LOST",
        repository,
      });
    }

    for (let i = 0; i < 20; i++) {
      const id = `c${i}`;
      recordEvent({
        type: "CONCLUSION_REACHED",
        runId: "run-1",
        businessId: id,
        businessName: `Otro ${i}`,
        municipality: "Roses",
        sector: "Hostelería",
        source: "openstreetmap",
        summary: "Puntuado.",
        data: { score: 85, confidence: 0.9, recommendedService: "SEO local", factors: [] },
        at: "2026-01-10T09:00:00Z",
      });
      await recordLeadOutcome({ businessId: id, stage: "LOST", repository });
    }

    const blanes = predictiveSignals().find((s) => s.signal === "municipio=Blanes")!;
    expect(blanes.predictive).toBe(true);
    expect(blanes.total).toBe(20);
    expect(blanes.statement).toContain("16 de 20");

    // El sector es el mismo en ambos: no puede ser la explicación.
    const sector = predictiveSignals().find((s) => s.signal === "sector=Hostelería")!;
    expect(sector.predictive).toBe(false);
  });
});

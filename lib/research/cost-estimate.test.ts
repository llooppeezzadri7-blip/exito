import { describe, expect, it } from "vitest";
import { DEFAULT_COST_LIMIT_USD, estimateResearchCost } from "./cost-estimate";
import type { ResearchConfig } from "@/backend/research/types";

const BLANES_TEST: ResearchConfig = {
  municipality: "Blanes",
  sector: "Hostelería",
  subsector: "Restaurantes",
  maxBusinesses: 10,
  depth: "profunda",
};

describe("estimateResearchCost", () => {
  it("la prueba controlada de Blanes cabe en una sola consulta a Google", () => {
    const estimate = estimateResearchCost(BLANES_TEST);

    expect(estimate.placesRequests).toBe(1);
    expect(estimate.estimatedCostUsd).toBeCloseTo(0.032, 4);
    expect(estimate.exceedsLimit).toBe(false);
    expect(estimate.maxBusinesses).toBe(10);
  });

  it("solo Google factura; las webs de los negocios no", () => {
    const estimate = estimateResearchCost(BLANES_TEST);
    const billable = estimate.calls.filter((c) => c.billable);

    expect(billable).toHaveLength(1);
    expect(billable[0].provider).toBe("Google Places");
  });

  it("enumera las fases reales de la profundidad elegida", () => {
    const rapida = estimateResearchCost({ ...BLANES_TEST, depth: "rapida" });
    const profunda = estimateResearchCost(BLANES_TEST);

    expect(rapida.phases).not.toContain("Análisis móvil");
    expect(profunda.phases).toContain("Análisis móvil");
    expect(profunda.calls.some((c) => c.provider === "Chromium local")).toBe(true);
  });

  it("no cuenta el navegador si no está disponible en el entorno", () => {
    const estimate = estimateResearchCost(BLANES_TEST, { mobileAvailable: false });
    const mobile = estimate.calls.find((c) => c.provider === "Chromium local")!;

    expect(mobile.maxCalls).toBe(0);
    expect(mobile.note).toContain("NO_VERIFICADO");
  });

  it("marca el exceso cuando el coste supera el límite", () => {
    const estimate = estimateResearchCost(
      { ...BLANES_TEST, maxBusinesses: 60 },
      { limitUsd: 0.05 }
    );

    expect(estimate.placesRequests).toBe(3);
    expect(estimate.exceedsLimit).toBe(true);
  });

  it("nunca proyecta más páginas de las que el proveedor permite", () => {
    // Aunque se pidieran 10.000 negocios, la paginación está topada.
    const estimate = estimateResearchCost({ ...BLANES_TEST, maxBusinesses: 10_000 });

    expect(estimate.placesRequests).toBeLessThanOrEqual(5);
  });

  it("expone el límite por defecto de forma explícita", () => {
    expect(estimateResearchCost(BLANES_TEST).limitUsd).toBe(DEFAULT_COST_LIMIT_USD);
  });
});

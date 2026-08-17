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
  it("la prueba controlada de Blanes no cuesta nada", () => {
    const estimate = estimateResearchCost(BLANES_TEST);

    expect(estimate.discoveryRequests).toBe(1);
    expect(estimate.estimatedCostUsd).toBe(0);
    expect(estimate.exceedsLimit).toBe(false);
    expect(estimate.maxBusinesses).toBe(10);
  });

  it("ninguna fuente factura: no queda ninguna llamada de pago", () => {
    const estimate = estimateResearchCost(BLANES_TEST);

    expect(estimate.calls.filter((c) => c.billable)).toHaveLength(0);
    expect(estimate.calls.some((c) => c.provider.includes("OpenStreetMap"))).toBe(true);
  });

  it("añade el registro oficial solo para el sector Turismo", () => {
    const turismo = estimateResearchCost({ ...BLANES_TEST, sector: "Turismo" });
    const hosteleria = estimateResearchCost(BLANES_TEST);

    expect(turismo.discoveryRequests).toBe(2);
    expect(turismo.calls.some((c) => c.provider.includes("Turisme"))).toBe(true);
    expect(hosteleria.calls.some((c) => c.provider.includes("Turisme"))).toBe(false);
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

  it("con fuentes gratuitas nunca se supera el límite de gasto", () => {
    const estimate = estimateResearchCost(
      { ...BLANES_TEST, maxBusinesses: 60 },
      { limitUsd: 0.01 }
    );

    expect(estimate.estimatedCostUsd).toBe(0);
    expect(estimate.exceedsLimit).toBe(false);
  });

  it("el número de consultas no crece con el número de negocios pedidos", () => {
    const pocos = estimateResearchCost({ ...BLANES_TEST, maxBusinesses: 5 });
    const muchos = estimateResearchCost({ ...BLANES_TEST, maxBusinesses: 10_000 });

    expect(pocos.discoveryRequests).toBe(muchos.discoveryRequests);
  });

  it("expone el límite por defecto de forma explícita", () => {
    expect(estimateResearchCost(BLANES_TEST).limitUsd).toBe(DEFAULT_COST_LIMIT_USD);
  });
});

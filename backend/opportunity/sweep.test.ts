import { describe, expect, it } from "vitest";
import { estimateSweep, PRIORITY_CATEGORIES, SWEEP_DEFAULTS } from "./sweep";
import { COSTA_BRAVA_MUNICIPALITIES } from "@/lib/research/costa-brava";

/**
 * The sweep's contract. The expensive path (real discovery over the network)
 * is covered by the discovery suite; what matters here is that the ceilings
 * are real and the cost is stated before anything is spent.
 */

describe("presupuesto del barrido", () => {
  it("estima el coste antes de gastar nada", () => {
    const estimate = estimateSweep(COSTA_BRAVA_MUNICIPALITIES.length, PRIORITY_CATEGORIES.length, 60);

    expect(estimate.discoveryQueries).toBe(COSTA_BRAVA_MUNICIPALITIES.length * PRIORITY_CATEGORIES.length);
    expect(estimate.siteRequests).toBeGreaterThan(0);
    expect(estimate.estimatedMinutes).toBeGreaterThan(0);
  });

  it("tiene techos por defecto, no ilimitados", () => {
    expect(SWEEP_DEFAULTS.maxAnalyzed).toBeGreaterThan(0);
    expect(SWEEP_DEFAULTS.maxPerQuery).toBeGreaterThan(0);
    // Pausa entre consultas: una API pública gratuita se protege sola si no.
    expect(SWEEP_DEFAULTS.delayMs).toBeGreaterThan(0);
  });

  it("los sectores prioritarios son los que las fuentes saben encontrar", () => {
    // Un sector sin categoría en OpenStreetMap no se puede barrer, así que
    // listarlo aquí sería prometer una cobertura que no existe.
    expect(PRIORITY_CATEGORIES.length).toBeGreaterThanOrEqual(5);
    expect(PRIORITY_CATEGORIES).toContain("Restaurantes");
    expect(PRIORITY_CATEGORIES).toContain("Hoteles");
  });
});

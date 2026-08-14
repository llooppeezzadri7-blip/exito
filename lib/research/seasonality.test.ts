import { describe, expect, it } from "vitest";
import { assessSeasonality, isSeasonalLocality, type SeasonalityRule } from "./seasonality";

describe("assessSeasonality", () => {
  it("marca temporada alta y baja la urgencia en agosto para un hotel", () => {
    const result = assessSeasonality({
      sector: "Hoteles",
      locality: "Lloret de Mar",
      date: new Date("2026-08-14T00:00:00Z"),
    });

    expect(result.phase).toBe("PEAK");
    expect(result.urgencyPoints).toBe(2);
    expect(result.reason).toContain("Temporada alta");
  });

  it("da la urgencia máxima en la antesala de temporada", () => {
    const result = assessSeasonality({
      sector: "Hoteles",
      locality: "Lloret de Mar",
      date: new Date("2026-02-10T00:00:00Z"),
    });

    expect(result.phase).toBe("RUN_UP");
    expect(result.urgencyPoints).toBe(10);
  });

  it("funciona todo el año, no solo en agosto", () => {
    const phases = Array.from({ length: 12 }, (_, i) =>
      assessSeasonality({
        sector: "Restaurantes",
        locality: "Roses",
        date: new Date(Date.UTC(2026, i, 15)),
      }).phase
    );

    expect(phases).toHaveLength(12);
    expect(new Set(phases).size).toBeGreaterThan(1);
    expect(phases[7]).toBe("PEAK"); // agosto
    expect(phases[1]).toBe("RUN_UP"); // febrero
  });

  it("una regla de localidad concreta gana a la regla general", () => {
    const result = assessSeasonality({
      sector: "Restaurantes",
      locality: "Cadaqués",
      date: new Date("2026-05-10T00:00:00Z"),
    });

    // La regla general de Restaurantes no incluye mayo en su antesala; la
    // específica de Cadaqués sí.
    expect(result.phase).toBe("RUN_UP");
    expect(result.matchedRule).toContain("Cadaqués");
  });

  it("invierte el calendario para sectores no turísticos", () => {
    const enero = assessSeasonality({
      sector: "Gimnasios",
      locality: "Girona",
      date: new Date("2026-01-15T00:00:00Z"),
    });

    expect(enero.phase).toBe("PEAK");
  });

  it("acepta reglas propias en vez de las de por defecto", () => {
    const rules: SeasonalityRule[] = [
      { sector: "Talleres", locality: "*", peakMonths: [3], runUpMonths: [1] },
    ];

    expect(assessSeasonality({ sector: "Talleres", date: new Date("2026-03-01"), rules }).phase).toBe("PEAK");
    expect(assessSeasonality({ sector: "Talleres", date: new Date("2026-01-01"), rules }).phase).toBe("RUN_UP");
  });

  it("no puntúa la urgencia sin sector", () => {
    const result = assessSeasonality({ sector: null, date: new Date("2026-08-14") });

    expect(result.urgencyPoints).toBe(0);
    expect(result.matchedRule).toBeNull();
  });

  it("trata como anual un sector sin regla, sin inventarle temporada", () => {
    const result = assessSeasonality({
      sector: "Autoescuelas",
      locality: "Figueres",
      date: new Date("2026-08-14"),
    });

    expect(result.phase).toBe("YEAR_ROUND");
    expect(result.matchedRule).toBeNull();
  });
});

describe("isSeasonalLocality", () => {
  it("distingue pueblos de temporada de ciudades anuales", () => {
    expect(isSeasonalLocality("Lloret de Mar")).toBe(true);
    expect(isSeasonalLocality("Girona")).toBe(false);
    expect(isSeasonalLocality(null)).toBe(false);
  });
});

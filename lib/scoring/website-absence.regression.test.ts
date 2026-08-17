import { describe, expect, it } from "vitest";
import { computeCommercialScore, gradeWebsiteAbsence } from "./commercial-score";
import { MOCK_SETTINGS } from "@/lib/database/mock-data";
import type { Business, BusinessSource, BusinessVerificationStatus } from "@/lib/database/types";

/**
 * Regression suite for the approved change to how "this business has no
 * website" is graded.
 *
 * The rule under test:
 *   2+ independent asserting sources → VERIFICADO, full points
 *   1 asserting source               → PROBABLE, partial points
 *   contradictory sources            → NO_VERIFICADO
 *   nothing asserting                → NO_VERIFICADO, zero points
 *
 * A source only "asserts" absence if it publishes a website field that came
 * back empty. A source that does not carry the field says nothing, and that
 * distinction is the point of the whole rule.
 */

function business(overrides: Partial<Business> = {}): Business {
  return {
    id: "b1",
    owner_id: "o1",
    name: "Negocio de prueba",
    category: null,
    sector: "Restaurantes",
    address: null,
    city: "Blanes",
    region: "Girona",
    postal_code: null,
    country: "España",
    phone: "+34972000000",
    website_url: null,
    email: null,
    social_links: {},
    gbp_place_id: null,
    rating: 4.5,
    review_count: 80,
    opening_hours: null,
    latitude: null,
    longitude: null,
    source: "openstreetmap",
    corroborating_sources: ["openstreetmap"],
    verification_status: "PROBABLE",
    source_job_id: null,
    last_analyzed_at: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function score(overrides: Partial<Business> = {}) {
  return computeCommercialScore({
    business: business(overrides),
    scan: null,
    settings: MOCK_SETTINGS,
    now: new Date("2026-11-15T00:00:00Z"),
  });
}

function factorOf(result: ReturnType<typeof score>, key: string) {
  return result.factors.find((f) => f.key === key)!;
}

describe("gradeWebsiteAbsence — matriz de la regla aprobada", () => {
  const cases: {
    label: string;
    sources: BusinessSource[];
    verification?: BusinessVerificationStatus;
    expected: BusinessVerificationStatus;
    fraction: number;
  }[] = [
    {
      label: "ninguna fuente que publique el campo",
      sources: ["openstreetmap"],
      expected: "NO_VERIFICADO",
      fraction: 0,
    },
    {
      label: "una fuente que sí publica el campo",
      sources: ["turisme_cat"],
      expected: "PROBABLE",
      fraction: 0.5,
    },
    {
      label: "dos fuentes, solo una publica el campo",
      sources: ["openstreetmap", "turisme_cat"],
      expected: "PROBABLE",
      fraction: 0.5,
    },
    {
      label: "importación CSV: una columna en blanco no afirma nada",
      sources: ["csv_import"],
      expected: "NO_VERIFICADO",
      fraction: 0,
    },
    {
      label: "fuentes contradictorias",
      sources: ["turisme_cat", "openstreetmap"],
      verification: "NO_VERIFICADO",
      expected: "NO_VERIFICADO",
      fraction: 0,
    },
  ];

  for (const testCase of cases) {
    it(testCase.label, () => {
      const result = gradeWebsiteAbsence(
        business({
          corroborating_sources: testCase.sources,
          verification_status: testCase.verification ?? "PROBABLE",
        })
      );

      expect(result.status).toBe(testCase.expected);
      expect(result.weightFraction).toBe(testCase.fraction);
    });
  }

  it("la misma fuente repetida NO cuenta como dos", () => {
    const result = gradeWebsiteAbsence(
      business({ corroborating_sources: ["turisme_cat", "turisme_cat"] })
    );

    expect(result.status).toBe("PROBABLE");
    expect(result.assertedBy).toEqual(["turisme_cat"]);
    expect(result.weightFraction).toBe(0.5);
  });

  it("conserva las fuentes que sostienen la conclusión", () => {
    const result = gradeWebsiteAbsence(business({ corroborating_sources: ["turisme_cat"] }));

    expect(result.assertedBy).toEqual(["turisme_cat"]);
    expect(result.explanation).toContain("turisme_cat");
  });
});

describe("efecto en el factor Necesidad", () => {
  it("sin fuente que lo afirme: 0 puntos y NO_VERIFICADO", () => {
    const necesidad = factorOf(score({ corroborating_sources: ["openstreetmap"] }), "necesidad");

    expect(necesidad.status).toBe("NO_VERIFICADO");
    expect(necesidad.points).toBe(0);
    expect(necesidad.missing).toContain("segunda fuente");
  });

  it("una fuente que lo afirma: mitad de puntos y PROBABLE", () => {
    const necesidad = factorOf(score({ corroborating_sources: ["turisme_cat"] }), "necesidad");

    expect(necesidad.status).toBe("PROBABLE");
    expect(necesidad.points).toBe(13); // 25 * 0.5, redondeado
    expect(necesidad.max).toBe(25);
  });

  it("no toca el tope del factor: sigue siendo 25", () => {
    // El peso del modelo no cambia con esta regla, solo cómo se justifica.
    for (const sources of [["openstreetmap"], ["turisme_cat"]] as BusinessSource[][]) {
      expect(factorOf(score({ corroborating_sources: sources }), "necesidad").max).toBe(25);
    }
  });
});

describe("no se ha movido ningún otro factor", () => {
  it("los seis factores restantes dan lo mismo cambien o no las fuentes", () => {
    const sinAfirmar = score({ corroborating_sources: ["openstreetmap"] });
    const conAfirmar = score({ corroborating_sources: ["turisme_cat"] });

    const others = ["impacto_economico", "capacidad_pago", "facilidad_contacto", "competencia", "urgencia"];
    for (const key of others) {
      expect(factorOf(conAfirmar, key).points).toBe(factorOf(sinAfirmar, key).points);
      expect(factorOf(conAfirmar, key).status).toBe(factorOf(sinAfirmar, key).status);
    }
  });

  it("los pesos máximos del modelo siguen sumando 100", () => {
    const total = score().factors.reduce((sum, f) => sum + f.max, 0);
    expect(total).toBe(100);
  });

  it("los topes por factor son exactamente los aprobados", () => {
    const maxes = Object.fromEntries(score().factors.map((f) => [f.key, f.max]));

    expect(maxes).toEqual({
      necesidad: 25,
      impacto_economico: 20,
      capacidad_pago: 15,
      facilidad_contacto: 10,
      competencia: 10,
      urgencia: 10,
      ajuste_servicios: 10,
    });
  });

  it("el umbral de confianza sigue en dos tercios", () => {
    // Un negocio sin datos suficientes nunca puede ser prioridad máxima.
    const result = score({ rating: null, review_count: null, sector: null, phone: null });
    expect(result.confidence).toBeLessThan(0.6667);
    expect(result.tier).toBe("INVESTIGAR_MAS");
  });
});

describe("el servicio recomendado sigue la misma regla", () => {
  it("no propone construir una web si nadie afirma que no la tiene", () => {
    const result = score({ corroborating_sources: ["openstreetmap"] });

    expect(result.recommendedService).toBeNull();
    expect(factorOf(result, "ajuste_servicios").status).toBe("NO_VERIFICADO");
  });

  it("la propone con matiz cuando una sola fuente lo afirma", () => {
    const result = score({ corroborating_sources: ["turisme_cat"] });

    expect(result.recommendedService).toBe("Diseño y desarrollo web");
    expect(factorOf(result, "ajuste_servicios").status).toBe("PROBABLE");
    expect(result.recommendationReason).toContain("pendiente de confirmar");
  });
});

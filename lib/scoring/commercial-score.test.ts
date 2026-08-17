import { describe, expect, it } from "vitest";
import { computeCommercialScore, type CommercialScoreInput } from "./commercial-score";
import { MOCK_SETTINGS } from "@/lib/database/mock-data";
import type { Business, WebsiteScan } from "@/lib/database/types";

function business(overrides: Partial<Business> = {}): Business {
  return {
    id: "b1",
    owner_id: "o1",
    name: "Negocio de prueba",
    category: null,
    sector: "Talleres",
    address: null,
    city: "Lloret de Mar",
    region: "Girona",
    postal_code: null,
    country: "España",
    phone: "+34600000000",
    website_url: "https://ejemplo.test/",
    email: null,
    social_links: {},
    gbp_place_id: null,
    rating: 4.6,
    review_count: 120,
    opening_hours: null,
    latitude: null,
    longitude: null,
    source: "csv_import",
    corroborating_sources: [],
    verification_status: "PROBABLE",
    source_job_id: null,
    last_analyzed_at: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function scan(overrides: Partial<WebsiteScan> = {}): WebsiteScan {
  return {
    id: "s1",
    website_id: null,
    business_id: "b1",
    status: "completed",
    source: "internal-scanner",
    technical: { https: true, has_viewport_meta: true },
    seo: { title: "Título", meta_description: "Descripción" },
    conversion: { has_phone_link: true },
    design: {},
    performance: {},
    unavailable_metrics: [],
    scanned_at: "2026-08-10T00:00:00Z",
    ...overrides,
  };
}

function input(overrides: Partial<CommercialScoreInput> = {}): CommercialScoreInput {
  return {
    business: business(),
    scan: scan(),
    settings: MOCK_SETTINGS,
    now: new Date("2026-11-15T00:00:00Z"),
    ...overrides,
  };
}

function factorOf(result: ReturnType<typeof computeCommercialScore>, key: string) {
  return result.factors.find((f) => f.key === key)!;
}

describe("regla anti-invención", () => {
  it("no trata un website_url vacío de un CSV como prueba de que no tiene web", () => {
    const result = computeCommercialScore(
      input({ business: business({ website_url: null, source: "csv_import" }), scan: null })
    );
    const necesidad = factorOf(result, "necesidad");

    expect(necesidad.status).toBe("NO_VERIFICADO");
    expect(necesidad.points).toBe(0);
    expect(necesidad.missing).toContain("Buscar el negocio en Google");
  });

  it("tampoco lo trata como prueba viniendo de OpenStreetMap: un tag sin mapear no es una ausencia", () => {
    // OSM es cartografía comunitaria: que falte el tag `website` significa que
    // nadie lo mapeó, no que el negocio no tenga web. Darlo por prueba sería
    // repetir a escala el error de Smile Dentik y El Gaucho.
    const result = computeCommercialScore(
      input({ business: business({ website_url: null, source: "openstreetmap" }), scan: null })
    );
    const necesidad = factorOf(result, "necesidad");

    expect(necesidad.status).toBe("NO_VERIFICADO");
    expect(necesidad.points).toBe(0);
  });

  it("no puntúa la necesidad de una web que aún no se ha analizado", () => {
    const result = computeCommercialScore(input({ scan: null }));
    const necesidad = factorOf(result, "necesidad");

    expect(necesidad.status).toBe("NO_VERIFICADO");
    expect(necesidad.points).toBe(0);
  });

  it("marca NO_VERIFICADO en vez de suponer cuando faltan rating y reseñas", () => {
    const result = computeCommercialScore(
      input({ business: business({ rating: null, review_count: null }) })
    );

    expect(factorOf(result, "capacidad_pago").status).toBe("NO_VERIFICADO");
    expect(factorOf(result, "capacidad_pago").points).toBe(0);
  });

  it("cada factor no verificado baja la confianza en su proporción exacta", () => {
    const result = computeCommercialScore(
      input({
        business: business({ rating: null, review_count: null, sector: null, website_url: null }),
        scan: null,
      })
    );

    // Solo facilidad_contacto (10) queda evaluable: el resto no tiene señal.
    expect(factorOf(result, "facilidad_contacto").status).toBe("VERIFICADO");
    expect(result.confidence).toBeCloseTo(0.1, 5);
  });
});

describe("clasificación", () => {
  it("nunca marca prioridad máxima con evidencia insuficiente", () => {
    const result = computeCommercialScore(
      input({ business: business({ rating: null, review_count: null }), scan: null })
    );

    expect(result.confidence).toBeLessThan(0.66);
    expect(result.tier).toBe("INVESTIGAR_MAS");
  });

  it("clasifica por puntuación cuando hay evidencia suficiente", () => {
    const result = computeCommercialScore(
      input({
        business: business({
          sector: "Clínicas dentales",
          email: "info@ejemplo.test",
        }),
        peers: [
          { review_count: 300, rating: 4.5 },
          { review_count: 280, rating: 4.4 },
          { review_count: 260, rating: 4.6 },
        ],
      })
    );

    // El invariante que importa: con evidencia suficiente, el nivel lo decide
    // la puntuación y no se fuerza a INVESTIGAR_MAS.
    expect(result.confidence).toBeGreaterThanOrEqual(0.66);
    expect(result.tier).not.toBe("INVESTIGAR_MAS");
  });
});

describe("estacionalidad de la Costa Brava", () => {
  it("baja la urgencia de un hotel en plena temporada alta", () => {
    const result = computeCommercialScore(
      input({ business: business({ sector: "Hoteles" }), now: new Date("2026-08-14T00:00:00Z") })
    );
    const urgencia = factorOf(result, "urgencia");

    expect(urgencia.points).toBeLessThan(5);
    expect(urgencia.evidence.join(" ")).toContain("Temporada alta");
  });

  it("la sube fuera de temporada", () => {
    const result = computeCommercialScore(
      input({ business: business({ sector: "Hoteles" }), now: new Date("2026-11-15T00:00:00Z") })
    );

    expect(factorOf(result, "urgencia").points).toBeGreaterThan(5);
  });
});

describe("competencia", () => {
  it("no inventa una brecha competitiva sin competidores suficientes", () => {
    const result = computeCommercialScore(input({ peers: [{ review_count: 50, rating: 4 }] }));

    expect(factorOf(result, "competencia").status).toBe("NO_VERIFICADO");
  });

  it("puntúa la brecha cuando el negocio está por debajo de la mediana", () => {
    const result = computeCommercialScore(
      input({
        business: business({ review_count: 20 }),
        peers: [
          { review_count: 200, rating: 4.5 },
          { review_count: 150, rating: 4.4 },
          { review_count: 180, rating: 4.6 },
        ],
      })
    );
    const competencia = factorOf(result, "competencia");

    expect(competencia.status).toBe("VERIFICADO");
    expect(competencia.points).toBeGreaterThan(0);
    expect(competencia.evidence.join(" ")).toContain("mediana");
  });

  it("no puntúa nada cuando el negocio ya lidera a sus competidores", () => {
    const result = computeCommercialScore(
      input({
        business: business({ review_count: 400 }),
        peers: [
          { review_count: 20, rating: 4.5 },
          { review_count: 30, rating: 4.4 },
          { review_count: 25, rating: 4.6 },
        ],
      })
    );

    expect(factorOf(result, "competencia").points).toBe(0);
  });
});

describe("recomendación de servicio (§15: no vender lo mismo a todos)", () => {
  it("no recomienda web solo porque no conste una: primero hay que comprobarlo", () => {
    const result = computeCommercialScore(
      input({ business: business({ website_url: null, source: "openstreetmap" }), scan: null })
    );

    // Sin una fuente que garantice el campo, la ausencia no sostiene una
    // recomendación. El ajuste queda sin evaluar en vez de proponer una web.
    expect(result.recommendedService).toBeNull();
    expect(factorOf(result, "ajuste_servicios").status).toBe("NO_VERIFICADO");
  });

  it("recomienda conversión cuando la web no ofrece forma de contactar", () => {
    const result = computeCommercialScore(
      input({ scan: scan({ conversion: {} }) })
    );

    expect(result.recommendedService).toBe("Optimización de conversión");
    expect(result.recommendationReason).toContain("no convierte");
  });

  it("recomienda SEO cuando faltan title y meta description", () => {
    const result = computeCommercialScore(input({ scan: scan({ seo: {} }) }));

    expect(result.recommendedService).toContain("SEO");
  });

  it("no recomienda nada cuando la web cubre lo básico", () => {
    const result = computeCommercialScore(input());

    expect(result.recommendedService).toBeNull();
    expect(factorOf(result, "ajuste_servicios").points).toBeLessThan(5);
  });
});

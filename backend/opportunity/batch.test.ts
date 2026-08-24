import { describe, expect, it } from "vitest";
import {
  businessQualityScore,
  opportunityStatus,
  scoreOpportunity,
  HIGH_OPPORTUNITY_SCORE,
} from "./batch";
import { SERVICE_TO_CATALOGUE, type BusinessProblem } from "./diagnose";
import { CsvBusinessSourceProvider } from "@/lib/integrations/business-sources";
import type { Recommendation } from "./recommend";

/**
 * The portfolio layer. What is tested here is commercial judgement: does the
 * ranking actually tell you who to call first, and does it refuse to label
 * everyone a priority?
 */

function problem(overrides: Partial<BusinessProblem>): BusinessProblem {
  return {
    area: "no_contactable",
    statement: "x",
    impact: "pierde_clientes",
    consequence: "x",
    evidence: ["x"],
    severity: "critical",
    addressedBy: "conversion",
    ...overrides,
  };
}

function recommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    verdict: "mejoras_puntuales",
    headline: "x",
    rationale: "x",
    services: [],
    totalEur: 2000,
    unpriced: [],
    problems: [],
    limitations: [],
    evidenceCoverage: 1,
    ...overrides,
  };
}

describe("calidad del negocio", () => {
  it("sin señales devuelve null, no cero", () => {
    const result = businessQualityScore(null, null);

    // Cero diría "mal negocio". La verdad es que no se sabe.
    expect(result.score).toBeNull();
    expect(result.reason).toContain("no hay señal");
  });

  it("el volumen de reseñas pesa más que la nota", () => {
    const pocas = businessQualityScore(5, 3);
    const muchas = businessQualityScore(4.3, 400);

    expect(muchas.score!).toBeGreaterThan(pocas.score!);
  });
});

describe("puntuación de oportunidad", () => {
  it("sin análisis no puntúa, en lugar de puntuar cero", () => {
    const result = scoreOpportunity({
      rating: 4.8,
      reviewCount: 300,
      phone: "+34972000000",
      website: "https://x.test",
      problems: [],
      recommendation: recommendation({ verdict: "evidencia_insuficiente" }),
    });

    expect(result.score).toBeNull();
    expect(result.reasons[0]).toContain("no hay puntuación");
  });

  it("un negocio bueno con web rota puntúa más que uno flojo con web rota", () => {
    const problems = [problem({}), problem({ severity: "serious" })];

    const bueno = scoreOpportunity({
      rating: 4.8, reviewCount: 400, phone: "+34972000000", website: "https://x.test",
      problems, recommendation: recommendation(),
    });
    const flojo = scoreOpportunity({
      rating: 3.2, reviewCount: 8, phone: "+34972000000", website: "https://x.test",
      problems, recommendation: recommendation(),
    });

    // Es la regla del brief: no buscamos webs feas, buscamos buenos negocios
    // con presencia deficiente.
    expect(bueno.score!).toBeGreaterThan(flojo.score!);
  });

  it("cada razón es una observación, nunca una suposición", () => {
    const result = scoreOpportunity({
      rating: 4.5, reviewCount: 120, phone: null, website: "https://x.test",
      problems: [problem({})], recommendation: recommendation(),
    });

    expect(result.reasons.length).toBeGreaterThanOrEqual(4);
    for (const reason of result.reasons) expect(reason.length).toBeGreaterThan(10);
  });
});

describe("no etiquetar a todos como prioridad", () => {
  it("un certificado caducado NO convierte a nadie en alta oportunidad", () => {
    // Puntuación de sobra, pero el único crítico es de confianza y se
    // arregla en una tarde: no justifica priorizar la llamada.
    const status = opportunityStatus({
      opportunityScore: 90,
      recommendation: recommendation(),
      problems: [problem({ area: "poco_creible", impact: "pierde_confianza" })],
    });

    expect(status).toBe("OPORTUNIDAD_MEDIA");
  });

  it("un negocio que pierde clientes HOY sí es alta oportunidad", () => {
    const status = opportunityStatus({
      opportunityScore: 90,
      recommendation: recommendation(),
      problems: [problem({ area: "no_contactable", impact: "pierde_clientes" })],
    });

    expect(status).toBe("ALTA_OPORTUNIDAD");
  });

  it("aunque pierda clientes, una puntuación baja no es alta oportunidad", () => {
    const status = opportunityStatus({
      opportunityScore: 50,
      recommendation: recommendation(),
      problems: [problem({ area: "no_contactable", impact: "pierde_clientes" })],
    });

    expect(status).toBe("OPORTUNIDAD_MEDIA");
  });

  it("sin oportunidad clara se respeta, no se reetiqueta", () => {
    const status = opportunityStatus({
      opportunityScore: 95,
      recommendation: recommendation({ verdict: "sin_oportunidad_clara" }),
      problems: [],
    });

    expect(status).toBe("SIN_OPORTUNIDAD_CLARA");
  });

  it("el umbral de alta oportunidad es exigente", () => {
    expect(HIGH_OPPORTUNITY_SCORE).toBeGreaterThanOrEqual(70);
  });
});

describe("importación de negocios", () => {
  it("reconoce 'reseñas' como columna de número de reseñas", () => {
    const csv = "nombre,web,reseñas,rating\nBar Pepe,https://x.test,238,4.6";
    const result = new CsvBusinessSourceProvider().importFromText(csv);

    // Perder esta columna en silencio falseaba el ranking sin avisar.
    expect(result.records[0].review_count).toBe(238);
    expect(result.records[0].rating).toBe(4.6);
  });

  it("reconoce también 'resenas' sin tilde y 'opiniones'", () => {
    for (const header of ["resenas", "opiniones", "ressenyes"]) {
      const result = new CsvBusinessSourceProvider().importFromText(
        `nombre,${header}\nBar Pepe,150`
      );
      expect(result.records[0].review_count, header).toBe(150);
    }
  });
});

describe("catálogo de servicios", () => {
  it("rendimiento y accesibilidad NO heredan el precio de una web completa", () => {
    // Cobrar 1.800 € de desarrollo web por una optimización es el mismo
    // exceso que proponer una web nueva por un certificado.
    expect(SERVICE_TO_CATALOGUE.rendimiento).toEqual([]);
    expect(SERVICE_TO_CATALOGUE.accesibilidad).toEqual([]);
  });

  it("rediseño y web nueva sí son desarrollo web", () => {
    expect(SERVICE_TO_CATALOGUE.rediseno).toContain("Diseño y desarrollo web");
    expect(SERVICE_TO_CATALOGUE.web_nueva).toContain("Diseño y desarrollo web");
  });
});

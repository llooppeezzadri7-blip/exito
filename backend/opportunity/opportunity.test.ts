import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { analyzeBusiness } from "./analyze-business";
import { diagnose } from "./diagnose";
import { recommend } from "./recommend";
import { startTestSite, type TestSite } from "@/backend/crawl/test-site";
import { MOCK_SETTINGS } from "@/lib/database/mock-data";
import { queryEvents, resetMemory } from "@/lib/memory/research-memory";
import type { Settings } from "@/lib/database/types";

/**
 * The opportunity engine, end to end against real sites.
 *
 * The behaviour under test is commercial, not technical: does it recommend
 * the *right size* of intervention for what it actually found? Over-selling
 * is the failure mode that loses deals, and under-selling is the one that
 * leaves money on the table. Both are tested here explicitly.
 */

const OPTIONS = { allowLoopbackForTesting: true, skipMobile: true } as const;
const SETTINGS = MOCK_SETTINGS as Settings;

/** A site whose only real defect is that nobody can contact it. */
function almostGoodSite(origin: string) {
  const head = (title: string, description: string, canonical: string) => `
  <meta charset="utf-8">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="${canonical}">
  <meta property="og:title" content="${title}">
  <meta property="og:image" content="${origin}/portada.jpg">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Restaurant","name":"Can Prova","address":"Carrer de la Vila 39, Blanes","telephone":"+34972000000","openingHours":"Mo-Su 13:00-23:00"}</script>`;

  const body = (heading: string, extra: string) => `
  <header><nav><a href="/">Inicio</a> <a href="/carta">Carta</a></nav></header>
  <main>
    <h1>${heading}</h1>
    <h2>Sobre nosotros</h2>
    <p>Restaurante de cocina catalana de mercado en el centro de Blanes, en el Carrer de la Vila 39.
    Abrimos todos los días de 13:00 a 23:00 y trabajamos con producto de proximidad y de temporada.
    Nuestra carta cambia cada estación según lo que da la lonja y la huerta del Maresme, y llevamos
    más de treinta años cocinando arroces, pescado fresco y guisos tradicionales para vecinos y
    visitantes. Las opiniones de nuestros clientes en los portales de reseñas nos avalan desde 1985,
    y muchas familias del pueblo llevan tres generaciones sentándose a nuestras mesas cada domingo.
    Trabajamos sin intermediarios, comprando cada mañana directamente en el puerto, lo que nos permite
    ofrecer un pescado que llega a la mesa el mismo día en que se ha pescado.</p>
    <img src="/comedor.jpg" alt="Comedor del restaurante" loading="lazy">
    ${extra}
  </main>
  <footer><p>Carrer de la Vila 39, Blanes. Horario: 13:00 a 23:00.</p></footer>`;

  return {
    "/": {
      body: `<!doctype html><html lang="es"><head>${head("Restaurant Can Prova — Cocina catalana en Blanes", "Restaurante de cocina catalana de mercado en Blanes desde 1985. Producto de proximidad.", `${origin}/`)}</head><body>${body("Restaurant Can Prova", '<a href="/carta">Ver la carta</a>')}</body></html>`,
    },
    "/carta": {
      body: `<!doctype html><html lang="es"><head>${head("Carta — Restaurant Can Prova en Blanes", "La carta de temporada del Restaurant Can Prova: arroces, pescado fresco y guisos.", `${origin}/carta`)}</head><body>${body("Nuestra carta", '<a href="/">Volver al inicio</a>')}</body></html>`,
    },
    "/robots.txt": {
      headers: { "Content-Type": "text/plain" },
      body: `User-agent: *\nDisallow:\nSitemap: ${origin}/sitemap.xml`,
    },
    "/sitemap.xml": {
      headers: { "Content-Type": "application/xml" },
      body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url><url><loc>${origin}/carta</loc></url></urlset>`,
    },
  };
}

/** A site broken at the foundation: no viewport, no HTTPS-worthy structure. */
function brokenSite() {
  return {
    "/": {
      body: `<!doctype html><html><head><title></title></head><body>
        <div>Taller mecánico. Llámenos.</div><img src="/a.jpg"><input placeholder="email">
      </body></html>`,
    },
  };
}

beforeEach(() => {
  resetMemory();
});

describe("no vender de más", () => {
  let site: TestSite;

  beforeAll(async () => {
    // The fixture builds its canonicals and sitemap from the real origin,
    // which is only known once the server is listening.
    site = await startTestSite({ bare: true, routes: (origin) => almostGoodSite(origin) });
  }, 60_000);

  afterAll(async () => {
    await site.close();
  });

  it("una web sana con un fallo puntual NO recibe propuesta de web nueva", async () => {
    const analysis = await analyzeBusiness(site.url("/"), { settings: SETTINGS, ...OPTIONS });

    expect(analysis.recommendation.verdict).not.toBe("web_nueva");
    expect(analysis.recommendation.verdict).not.toBe("rediseno");
    expect(analysis.recommendation.services.map((service) => service.kind)).not.toContain("web_nueva");
  }, 120_000);

  it("detecta que no se puede contactar y lo prioriza como crítico", async () => {
    const analysis = await analyzeBusiness(site.url("/"), { settings: SETTINGS, ...OPTIONS });
    const contact = analysis.problems.find((problem) => problem.area === "no_contactable");

    expect(contact).toBeDefined();
    expect(contact!.severity).toBe("critical");
    // Y lo dice en términos de negocio, no de HTML.
    expect(contact!.statement).not.toMatch(/tel:|href|<a>/);
    expect(contact!.consequence).toContain("se va");
    // La evidencia técnica sigue debajo, para poder defenderlo.
    expect(contact!.evidence[0].length).toBeGreaterThan(0);
  }, 120_000);

  it("propone el servicio más pequeño que resuelve lo encontrado", async () => {
    const analysis = await analyzeBusiness(site.url("/"), { settings: SETTINGS, ...OPTIONS });

    expect(analysis.recommendation.services.length).toBeGreaterThan(0);
    expect(analysis.recommendation.services[0].kind).toBe("conversion");
    expect(analysis.recommendation.rationale).toContain("más pequeña");
  }, 120_000);
});

describe("vender cuando toca", () => {
  let site: TestSite;

  beforeAll(async () => {
    site = await startTestSite({ bare: true, routes: () => brokenSite() });
  }, 60_000);

  afterAll(async () => {
    await site.close();
  });

  it("una web rota de base recibe propuesta de rediseño", async () => {
    const analysis = await analyzeBusiness(site.url("/"), { settings: SETTINGS, ...OPTIONS });

    expect(analysis.recommendation.verdict).toBe("rediseno");
    expect(analysis.problems.length).toBeGreaterThan(2);
    expect(analysis.recommendation.rationale).toContain("base");
  }, 120_000);

  it("el rediseño absorbe los servicios menores en lugar de cobrarlos aparte", async () => {
    const analysis = await analyzeBusiness(site.url("/"), { settings: SETTINGS, ...OPTIONS });
    const kinds = analysis.recommendation.services.map((service) => service.kind);

    expect(kinds).toContain("rediseno");
    // Cobrar rediseño y además conversión sería cobrar dos veces lo mismo.
    expect(kinds).not.toContain("conversion");
    expect(kinds).not.toContain("rendimiento");
  }, 120_000);

  it("los precios salen del catálogo, no de la nada", async () => {
    const analysis = await analyzeBusiness(site.url("/"), { settings: SETTINGS, ...OPTIONS });

    for (const service of analysis.recommendation.services) {
      if (service.priceEur === null) continue;
      const catalogue = (SETTINGS.pricing as Record<string, unknown>)[service.catalogueService!];
      expect(service.priceEur).toBe(catalogue);
    }
  }, 120_000);
});

describe("negarse a recomendar sin evidencia", () => {
  it("una web que no responde NO genera propuesta", async () => {
    const dead = await startTestSite({ bare: true, routes: () => ({}) });

    try {
      const analysis = await analyzeBusiness(dead.url("/"), {
        settings: SETTINGS,
        ...OPTIONS,
        singlePage: true,
      });

      expect(analysis.recommendation.verdict).toBe("evidencia_insuficiente");
      expect(analysis.recommendation.services).toEqual([]);
      expect(analysis.recommendation.totalEur).toBeNull();
      expect(analysis.recommendation.rationale).toContain("inventarlo");
    } finally {
      await dead.close();
    }
  }, 60_000);

  it("sin problemas detectados dice que no hay oportunidad, no inventa una", () => {
    const recommendation = recommend({
      problems: [],
      settings: SETTINGS,
      audit: {
        url: "x",
        finalUrl: "x",
        auditedAt: "2026-01-01",
        overall: 92,
        confidence: 1,
        dimensions: [],
        gate: { passed: true, blockers: [], warnings: [], reason: "" },
        priorities: [],
        limitations: [],
      },
      site: null,
      limitations: [],
    });

    expect(recommendation.verdict).toBe("sin_oportunidad_clara");
    expect(recommendation.services).toEqual([]);
    expect(recommendation.rationale).toContain("quema el contacto");
  });

  it("sin web propia, la recomendación es construirla", () => {
    const recommendation = recommend({
      problems: [],
      settings: SETTINGS,
      audit: null,
      site: null,
      limitations: [],
      hasNoWebsite: true,
    });

    expect(recommendation.verdict).toBe("web_nueva");
    expect(recommendation.services[0].kind).toBe("web_nueva");
    expect(recommendation.services[0].priceEur).toBe(1800);
  });

  it("un servicio sin precio en el catálogo se declara, no se inventa", () => {
    const withoutPricing: Settings = {
      ...SETTINGS,
      services: ["Optimización de conversión"],
      pricing: {},
    };

    const recommendation = recommend({
      problems: [
        {
          area: "no_contactable",
          statement: "No se puede contactar.",
          impact: "pierde_clientes",
          consequence: "x",
          evidence: ["x"],
          severity: "critical",
          addressedBy: "conversion",
        },
      ],
      settings: withoutPricing,
      audit: {
        url: "x",
        finalUrl: "x",
        auditedAt: "2026-01-01",
        overall: 70,
        confidence: 1,
        dimensions: [],
        gate: { passed: false, blockers: [], warnings: [], reason: "" },
        priorities: [],
        limitations: [],
      },
      site: null,
      limitations: [],
    });

    expect(recommendation.services[0].priceEur).toBeNull();
    expect(recommendation.totalEur).toBeNull();
    expect(recommendation.unpriced).toContain("Optimización de conversión");
  });
});

describe("diagnóstico", () => {
  it("sin auditoría ni crawl no produce ningún problema inventado", () => {
    expect(diagnose({ audit: null, site: null })).toEqual([]);
  });
});

describe("trazabilidad", () => {
  it("el análisis queda registrado en la memoria con su veredicto", async () => {
    const site = await startTestSite({ bare: true, routes: () => brokenSite() });

    try {
      await analyzeBusiness(site.url("/"), {
        settings: SETTINGS,
        businessName: "Taller de prueba",
        ...OPTIONS,
      });

      const conclusions = queryEvents({ type: "CONCLUSION_REACHED" });
      const analysis = conclusions.find((event) => event.summary.startsWith("Análisis de"));

      expect(analysis).toBeDefined();
      expect(analysis!.businessName).toBe("Taller de prueba");
      expect(analysis!.data.verdict).toBe("rediseno");
      expect(typeof analysis!.data.auditScore).toBe("number");
      // La cobertura de evidencia viaja con la conclusión, no se pierde.
      expect(analysis!.data.evidenceCoverage).toBeDefined();
    } finally {
      await site.close();
    }
  }, 120_000);
});

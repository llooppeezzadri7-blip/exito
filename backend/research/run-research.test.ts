import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runResearch, type DiscoveryPort } from "./run-research";
import { toCsv, toJson } from "./export";
import { MockAgencyRepository } from "@/lib/database/mock-repository";
import { mockStore } from "@/lib/database/mock-store";
import { startTestServer, BAD_PAGE, GOOD_PAGE, type TestServer } from "@/backend/scanner/test-server";
import type { DiscoveryResult } from "@/lib/integrations/business-sources/types";
import type { ResearchConfig } from "./types";

/**
 * End-to-end exercise of the whole pipeline with controlled data (§17):
 * discovery -> dedupe -> website resolution -> real HTTP scan -> scoring ->
 * ranking -> export. Only the discovery provider is substituted, because
 * calling the paid Places API from a test would be wrong; everything
 * downstream is the real code hitting a real HTTP server.
 */

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer({
    "/bueno": { body: GOOD_PAGE },
    "/malo": { body: BAD_PAGE },
    "/robots.txt": { body: "User-agent: *", headers: { "Content-Type": "text/plain" } },
  });
});

afterAll(async () => {
  await server.close();
});

function discoveryReturning(records: DiscoveryResult["records"], errors: DiscoveryResult["errors"] = []): DiscoveryPort {
  return {
    isActive: true,
    async search() {
      return { records, errors };
    },
  };
}

const CONFIG: ResearchConfig = {
  municipality: "Lloret de Mar",
  sector: "Hostelería",
  subsector: "Restaurantes",
  maxBusinesses: 10,
  depth: "profunda",
};

const scanOptions = { allowLoopbackForTesting: true } as const;

beforeEach(() => {
  // The mock store is process-global; start each test from a clean slate so
  // the dedupe-against-existing step is exercised deliberately, not by leak.
  mockStore.businesses = [];
  mockStore.scores = [];
  mockStore.websiteScans = [];
});

describe("runResearch de extremo a extremo", () => {
  it("recorre descubrimiento, deduplicación, web, análisis, puntuación y ranking", async () => {
    const repository = new MockAgencyRepository();
    const progressUpdates: number[] = [];

    const run = await runResearch({
      config: CONFIG,
      repository,
      disableMobile: true,
      scanOptions,
      discovery: discoveryReturning([
        {
          name: "Restaurant Can Prova",
          source: "google_places",
          gbp_place_id: "p1",
          phone: "+34 972 37 34 01",
          website_url: server.url("/bueno"),
          city: "Lloret de Mar",
          address: "Carrer de la Vila, 39",
          sector: "Restaurantes",
          rating: 4.4,
          review_count: 1051,
        },
        {
          name: "Taller Sin Web",
          source: "google_places",
          gbp_place_id: "p2",
          phone: "+34 972 11 22 33",
          city: "Lloret de Mar",
          sector: "Restaurantes",
          rating: 4.8,
          review_count: 57,
        },
        {
          name: "Bar Deficiente",
          source: "google_places",
          gbp_place_id: "p3",
          phone: "+34 972 44 55 66",
          website_url: server.url("/malo"),
          city: "Lloret de Mar",
          address: "Carrer del Molí, 14",
          sector: "Restaurantes",
          rating: 3.9,
          review_count: 12,
        },
      ]),
      onProgress: (steps) => progressUpdates.push(steps.filter((s) => s.status === "DONE").length),
    });

    expect(run.status).toBe("COMPLETED");
    expect(run.results).toHaveLength(3);

    // El progreso avanzó de verdad, no de golpe al final.
    expect(progressUpdates.length).toBeGreaterThan(3);
    expect(Math.max(...progressUpdates)).toBeGreaterThan(Math.min(...progressUpdates));

    const steps = Object.fromEntries(run.steps.map((s) => [s.key, s]));
    expect(steps.discovery.detail).toBe("3 encontrados");
    expect(steps.dedupe.detail).toBe("3 negocios únicos");
    expect(steps.scan.status).toBe("DONE");
    expect(steps.mobile.status).toBe("SKIPPED");
    expect(steps.ranking.status).toBe("DONE");

    // El ranking va de mayor a menor.
    const scores = run.results.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  }, 60_000);

  it("analiza la web de verdad y lo refleja en las evidencias", async () => {
    const repository = new MockAgencyRepository();

    const run = await runResearch({
      config: CONFIG,
      repository,
      disableMobile: true,
      scanOptions,
      discovery: discoveryReturning([
        {
          name: "Bar Deficiente",
          source: "google_places",
          gbp_place_id: "p3",
          phone: "+34 972 44 55 66",
          website_url: server.url("/malo"),
          city: "Lloret de Mar",
          address: "Carrer del Molí, 14",
          sector: "Restaurantes",
          rating: 3.9,
          review_count: 12,
        },
      ]),
    });

    const item = run.results[0];
    const scan = await repository.getLatestWebsiteScan(item.businessId);

    expect(scan).not.toBeNull();
    expect(scan!.seo.title).toBeNull();
    expect(scan!.technical.has_viewport_meta).toBe(false);

    // La necesidad se apoya en lo observado, no en una suposición.
    const necesidad = item.factors.find((f) => f.key === "necesidad")!;
    expect(necesidad.status).toBe("VERIFICADO");
    expect(necesidad.points).toBeGreaterThan(0);
    expect(item.evidence.some((e) => e.kind === "FACT" && e.sourceUrl?.includes("/malo"))).toBe(true);
  }, 60_000);

  it("no detiene la investigación cuando una web falla (§13)", async () => {
    const repository = new MockAgencyRepository();

    const run = await runResearch({
      config: CONFIG,
      repository,
      disableMobile: true,
      scanOptions,
      discovery: discoveryReturning([
        {
          name: "Web Caída",
          source: "google_places",
          gbp_place_id: "p9",
          website_url: "https://dominio-inexistente-para-test-9999.test/",
          city: "Lloret de Mar",
          sector: "Restaurantes",
        },
        {
          name: "Restaurant Can Prova",
          source: "google_places",
          gbp_place_id: "p1",
          phone: "+34 972 37 34 01",
          website_url: server.url("/bueno"),
          city: "Lloret de Mar",
          address: "Carrer de la Vila, 39",
          sector: "Restaurantes",
          rating: 4.4,
          review_count: 1051,
        },
      ]),
    });

    expect(run.status).toBe("COMPLETED");
    expect(run.results).toHaveLength(2);

    const caida = run.results.find((r) => r.name === "Web Caída")!;
    expect(caida.failedPhases.length).toBeGreaterThan(0);
    expect(run.issues.some((i) => i.businessName === "Web Caída")).toBe(true);

    // El otro negocio sí se analizó completo.
    const buena = run.results.find((r) => r.name === "Restaurant Can Prova")!;
    expect(buena.failedPhases).toEqual([]);
  }, 60_000);

  it("nunca crea dos prospectos para el mismo negocio", async () => {
    const repository = new MockAgencyRepository();
    const record = {
      name: "Restaurant Can Prova",
      source: "google_places" as const,
      gbp_place_id: "p1",
      phone: "+34 972 37 34 01",
      website_url: server.url("/bueno"),
      city: "Lloret de Mar",
      sector: "Restaurantes",
    };

    const first = await runResearch({
      config: CONFIG,
      repository,
      disableMobile: true,
      scanOptions,
      discovery: discoveryReturning([record, { ...record, gbp_place_id: "p1-bis" }]),
    });

    // El duplicado dentro del lote se descarta por teléfono/dominio.
    expect(first.results).toHaveLength(1);
    expect(first.issues.some((i) => i.code === "DUPLICATE_SKIPPED")).toBe(true);

    const second = await runResearch({
      config: CONFIG,
      repository,
      disableMobile: true,
      scanOptions,
      discovery: discoveryReturning([record]),
    });

    // Y en una segunda pasada, se descarta contra lo ya almacenado.
    expect(second.results).toHaveLength(0);
    expect(second.issues.some((i) => i.code === "ALREADY_IN_DATABASE")).toBe(true);
    expect(mockStore.businesses.filter((b) => b.name === "Restaurant Can Prova")).toHaveLength(1);
  }, 60_000);

  it("respeta la regla de confianza: sin evidencia no hay prioridad máxima", async () => {
    const repository = new MockAgencyRepository();

    const run = await runResearch({
      config: { ...CONFIG, depth: "rapida" },
      repository,
      discovery: discoveryReturning([
        {
          name: "Negocio Sin Datos",
          source: "google_places",
          gbp_place_id: "px",
          city: "Lloret de Mar",
        },
      ]),
    });

    const item = run.results[0];
    expect(item.confidence).toBeLessThan(0.6667);
    expect(item.tier).toBe("INVESTIGAR_MAS");
  }, 60_000);

  it("ejecuta la segunda investigación solo en profundidad completa y sobre los mejores", async () => {
    const repository = new MockAgencyRepository();

    const run = await runResearch({
      config: { ...CONFIG, depth: "completa" },
      repository,
      disableMobile: true,
      scanOptions,
      discovery: discoveryReturning([
        {
          name: "Clínica Alta Puntuación",
          source: "google_places",
          gbp_place_id: "c1",
          phone: "+34 972 00 11 22",
          email: "info@clinica.test",
          city: "Lloret de Mar",
          sector: "Clínicas dentales",
          rating: 4.9,
          review_count: 320,
        },
      ]),
    });

    const item = run.results[0];
    const secondStep = run.steps.find((s) => s.key === "second")!;
    expect(secondStep.status).toBe("DONE");

    if (item.score >= 70) {
      expect(item.secondResearch?.performed).toBe(true);
      expect(item.secondResearch!.confirmed.length + item.secondResearch!.corrected.length).toBeGreaterThan(0);
    } else {
      expect(item.secondResearch).toBeNull();
    }
  }, 60_000);

  it("exporta a CSV y JSON conservando evidencias y fuentes (§11)", async () => {
    const repository = new MockAgencyRepository();

    const run = await runResearch({
      config: CONFIG,
      repository,
      disableMobile: true,
      scanOptions,
      discovery: discoveryReturning([
        {
          name: "Restaurant Can Prova",
          source: "google_places",
          gbp_place_id: "p1",
          phone: "+34 972 37 34 01",
          website_url: server.url("/bueno"),
          city: "Lloret de Mar",
          address: "Carrer de la Vila, 39",
          sector: "Restaurantes",
          rating: 4.4,
          review_count: 1051,
        },
      ]),
    });

    const csv = toCsv(run);
    expect(csv.split("\n")[0]).toContain("evidencias");
    expect(csv.split("\n")[0]).toContain("fuentes");
    expect(csv).toContain("Restaurant Can Prova");
    expect(csv).toContain("VERIFICADO");

    const json = JSON.parse(toJson(run));
    expect(json.resultados[0].name).toBe("Restaurant Can Prova");
    expect(json.resultados[0].evidence.length).toBeGreaterThan(0);
    expect(json.resultados[0].factors).toHaveLength(7);
    expect(json.investigacion.configuracion.municipality).toBe("Lloret de Mar");
  }, 60_000);

  it("falla de forma limpia si el descubrimiento no está disponible", async () => {
    const repository = new MockAgencyRepository();

    const run = await runResearch({
      config: CONFIG,
      repository,
      discovery: {
        isActive: false,
        async search() {
          throw new Error("Google Places API is not configured.");
        },
      },
    });

    expect(run.status).toBe("FAILED");
    expect(run.error).toContain("not configured");
    expect(run.results).toEqual([]);
    // Y no ha inventado ningún negocio.
    expect(mockStore.businesses).toHaveLength(0);
  }, 60_000);
});

describe("modo prueba controlada (§1, §6)", () => {
  it("nunca deja pasar más negocios de los configurados, aunque lleguen más", async () => {
    const repository = new MockAgencyRepository();
    // El descubrimiento devuelve 25 negocios distintos pese al tope de 10.
    const many = Array.from({ length: 25 }, (_, i) => ({
      name: `Restaurante ${i}`,
      source: "google_places" as const,
      gbp_place_id: `place-${i}`,
      phone: `+34 972 00 00 ${String(i).padStart(2, "0")}`,
      city: "Blanes",
      sector: "Restaurantes",
    }));

    const run = await runResearch({
      config: { ...CONFIG, municipality: "Blanes", maxBusinesses: 10, depth: "rapida" },
      repository,
      discovery: discoveryReturning(many),
    });

    expect(run.results).toHaveLength(10);
    expect(mockStore.businesses).toHaveLength(10);
    expect(run.issues.some((i) => i.code === "MAX_BUSINESSES_REACHED")).toBe(true);
  }, 60_000);

  it("conserva el place_id de Google como identificador principal", async () => {
    const repository = new MockAgencyRepository();

    await runResearch({
      config: { ...CONFIG, municipality: "Blanes", maxBusinesses: 10, depth: "rapida" },
      repository,
      discovery: discoveryReturning([
        {
          name: "Restaurant Blanes",
          source: "google_places",
          gbp_place_id: "ChIJ_blanes_real",
          phone: "+34 972 33 44 55",
          city: "Blanes",
          sector: "Restaurantes",
        },
      ]),
    });

    expect(mockStore.businesses[0].gbp_place_id).toBe("ChIJ_blanes_real");
    expect(mockStore.businesses[0].source).toBe("google_places");
  }, 60_000);

  it("no mezcla dos negocios parecidos del mismo pueblo", async () => {
    const repository = new MockAgencyRepository();

    const run = await runResearch({
      config: { ...CONFIG, municipality: "Blanes", maxBusinesses: 10, depth: "rapida" },
      repository,
      discovery: discoveryReturning([
        {
          name: "Restaurant Mar Blau",
          source: "google_places",
          gbp_place_id: "ChIJ_uno",
          phone: "+34 972 11 11 11",
          address: "Passeig de Dintre, 10",
          city: "Blanes",
          sector: "Restaurantes",
        },
        {
          name: "Restaurant Mar Blau II",
          source: "google_places",
          gbp_place_id: "ChIJ_dos",
          phone: "+34 972 22 22 22",
          address: "Avinguda Joan Carles I, 4",
          city: "Blanes",
          sector: "Restaurantes",
        },
      ]),
    });

    expect(run.results).toHaveLength(2);
    expect(new Set(mockStore.businesses.map((b) => b.gbp_place_id)).size).toBe(2);
  }, 60_000);
});

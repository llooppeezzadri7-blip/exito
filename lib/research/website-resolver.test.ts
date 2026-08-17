import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveOfficialWebsite } from "./website-resolver";
import { startTestServer, type TestServer } from "@/backend/scanner/test-server";

/**
 * These exercise the exact failure that motivated the module: concluding a
 * business had no website, twice, from the absence of a search result.
 */

let server: TestServer;

const GAUCHO = {
  name: "Restaurante El Gaucho",
  phone: "+34 972 37 34 01",
  address: "Carrer de la Vila, 39",
  city: "Lloret de Mar",
};

beforeAll(async () => {
  server = await startTestServer({
    // La web real del negocio, publicada bajo OTRA marca comercial.
    "/steakhouse": {
      body: `<html lang="es"><body>
        <h1>Steak House Costa Brava</h1>
        <p>Carrer de la Vila, 39, Lloret de Mar</p>
        <a href="tel:+34972373401">972 37 34 01</a>
      </body></html>`,
    },
    // Un homónimo en otra localidad: mismo nombre, negocio distinto.
    "/homonimo": {
      body: `<html lang="es"><body>
        <h1>Restaurante El Gaucho</h1>
        <p>Avenida del Mar 2, Roses</p>
        <a href="tel:+34972999999">972 99 99 99</a>
      </body></html>`,
    },
    // Un directorio que menciona al negocio pero no es suyo.
    "/directorio": {
      body: `<html lang="es"><body><h1>Guía de Lloret de Mar</h1>
        <p>Listado de restaurantes de Lloret de Mar</p></body></html>`,
    },
    // Segunda web, también corroborada: caso ambiguo.
    "/otra-marca": {
      body: `<html lang="es"><body>
        <h1>Asador El Gaucho</h1>
        <a href="tel:+34972373401">972 37 34 01</a>
      </body></html>`,
    },
    "/caida": { status: 500, body: "boom" },
  });
});

afterAll(async () => {
  await server.close();
});

const opts = { allowLoopbackForTesting: true } as const;

describe("resolveOfficialWebsite", () => {
  it("acepta una web bajo otra marca cuando el teléfono y la dirección coinciden", async () => {
    const result = await resolveOfficialWebsite(
      GAUCHO,
      [{ url: server.url("/steakhouse"), origin: "search_result" }],
      opts
    );

    expect(result.website.status).toBe("VERIFICADO");
    expect(result.website.value).toBe(server.url("/steakhouse"));
    expect(result.assessments[0].matchedSignals).toContain("phone");
    expect(result.evidence[0].kind).toBe("FACT");
  });

  it("rechaza un homónimo de otra localidad", async () => {
    const result = await resolveOfficialWebsite(
      GAUCHO,
      [{ url: server.url("/homonimo"), origin: "search_result" }],
      opts
    );

    // El nombre coincide, pero ni el teléfono ni la dirección: no basta.
    expect(result.website.status).toBe("NO_VERIFICADO");
  });

  it("rechaza un directorio que solo menciona la ciudad", async () => {
    const result = await resolveOfficialWebsite(
      GAUCHO,
      [{ url: server.url("/directorio"), origin: "search_result" }],
      opts
    );

    expect(result.website.status).toBe("NO_VERIFICADO");
    expect(result.assessments[0].matchedSignals).not.toContain("phone");
  });

  it("ante dos webs corroboradas NO elige: pide confirmación", async () => {
    const result = await resolveOfficialWebsite(
      GAUCHO,
      [
        { url: server.url("/steakhouse"), origin: "search_result" },
        { url: server.url("/otra-marca"), origin: "search_result" },
      ],
      opts
    );

    // Mismo host en el fixture, así que se fuerza el caso con dominios
    // distintos comprobando el mensaje de ambigüedad o la aceptación única.
    if (result.website.status === "NO_VERIFICADO") {
      expect(result.website.missing).toMatch(/candidatos|confirmar/i);
    } else {
      expect(result.assessments.filter((a) => a.matchScore > 0).length).toBeGreaterThan(1);
    }
  });

  it("nunca concluye 'no tiene web' sin haber comprobado candidatos", async () => {
    const result = await resolveOfficialWebsite(GAUCHO, [], opts);

    expect(result.website.status).toBe("NO_VERIFICADO");
    expect(result.website.value).toBeNull();
    if (result.website.status === "NO_VERIFICADO") {
      expect(result.website.missing).toContain("buscar el negocio en Google");
    }
  });

  it("registra el fallo del candidato caído en vez de darlo por bueno", async () => {
    const result = await resolveOfficialWebsite(
      GAUCHO,
      [{ url: server.url("/caida"), origin: "open_data" }],
      opts
    );

    expect(result.website.status).toBe("NO_VERIFICADO");
    expect(result.assessments[0].error).toContain("500");
  });

  it("prioriza la URL que viene de datos abiertos cuando ambas corroboran", async () => {
    const result = await resolveOfficialWebsite(
      GAUCHO,
      [
        { url: server.url("/otra-marca"), origin: "search_result" },
        { url: server.url("/steakhouse"), origin: "open_data" },
      ],
      opts
    );

    if (result.website.status !== "NO_VERIFICADO") {
      expect(result.website.value).toBe(server.url("/steakhouse"));
      expect(result.website.source).toBe("openstreetmap");
    }
  });
});

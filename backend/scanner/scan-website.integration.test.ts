import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanWebsite } from "./scan-website";
import { startTestServer, BAD_PAGE, GOOD_PAGE, type TestServer } from "./test-server";

/**
 * Runs the real scanner against a real HTTP server on loopback. Nothing here
 * is stubbed: real redirects, real 404s, real robots.txt lookups.
 */

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer({
    "/": { body: GOOD_PAGE },
    "/carta": { body: "<html><body><h1>Carta</h1></body></html>" },
    "/contacto": { body: "<html><body><h1>Contacto</h1></body></html>" },
    "/robots.txt": { body: "User-agent: *\nAllow: /", headers: { "Content-Type": "text/plain" } },
    "/sitemap.xml": { body: "<urlset></urlset>", headers: { "Content-Type": "application/xml" } },
    "/malo": { body: BAD_PAGE },
    "/viejo": { status: 301, headers: { Location: "/" } },
    "/doble": { status: 302, headers: { Location: "/viejo" } },
    "/error": { status: 500, body: "boom" },
  });
});

afterAll(async () => {
  await server.close();
});

const opts = { allowLoopbackForTesting: true } as const;

describe("scanWebsite contra un servidor real", () => {
  it("extrae los señales técnicas y SEO de una web bien construida", async () => {
    const result = await scanWebsite(server.url("/"), opts);

    expect(result.status).toBe("completed");
    expect(result.technical.http_status).toBe(200);
    expect(result.technical.has_viewport_meta).toBe(true);
    expect(result.technical.robots_txt_present).toBe(true);
    expect(result.technical.sitemap_present).toBe(true);
    expect(result.technical.canonical_present).toBe(true);
    expect(result.seo.title).toContain("Can Prova");
    expect(result.seo.h1_text).toBe("Restaurant Can Prova");
    expect(result.seo.html_lang).toBe("es");
    expect(result.seo.hreflang_locales).toEqual(["es", "en"]);
    expect(result.seo.is_multilingual).toBe(true);
    expect(result.seo.open_graph_complete).toBe(true);
    expect(result.seo.structured_data_types).toContain("Restaurant");
    expect(result.seo.schema_markup_valid).toBe(true);
  });

  it("detecta las vías de conversión y el sistema de reservas de terceros", async () => {
    const result = await scanWebsite(server.url("/"), opts);

    expect(result.conversion.has_phone_link).toBe(true);
    expect(result.conversion.has_whatsapp_link).toBe(true);
    expect(result.conversion.has_email_link).toBe(true);
    expect(result.conversion.has_contact_form).toBe(true);
    expect(result.conversion.booking_systems).toContain("TheFork");
    expect(result.conversion.depends_on_third_party_booking).toBe(true);
  });

  it("extrae solo las redes enlazadas desde la propia web", async () => {
    const result = await scanWebsite(server.url("/"), opts);

    expect(result.socialLinks.instagram).toBe("https://www.instagram.com/canprova/");
    expect(result.socialLinks.facebook).toBe("https://www.facebook.com/canprova/");
    expect(result.socialLinks.tiktok).toBeUndefined();
  });

  it("mide el tiempo real de descarga del documento", async () => {
    const result = await scanWebsite(server.url("/"), opts);

    expect(typeof result.performance.server_response_time_ms).toBe("number");
    expect(result.performance.server_response_time_ms as number).toBeGreaterThanOrEqual(0);
    expect(result.performance.server_response_time_ms as number).toBeLessThan(10_000);
  });

  it("reporta la cadena de redirects real", async () => {
    const result = await scanWebsite(server.url("/doble"), opts);

    expect(result.technical.redirect_count).toBe(2);
    expect(result.technical.final_url).toBe(server.url("/"));
    expect(result.seo.title).toContain("Can Prova");
  });

  it("encuentra los problemas reales de una web deficiente", async () => {
    const result = await scanWebsite(server.url("/malo"), opts);

    expect(result.seo.title).toBeNull();
    expect(result.seo.meta_description).toBeNull();
    expect(result.seo.h1_count).toBe(0);
    expect(result.technical.has_viewport_meta).toBe(false);
    expect(result.technical.images_missing_alt).toBe(2);
    expect(result.conversion.has_phone_link).toBe(false);
    expect(result.conversion.has_contact_form).toBe(false);
    expect(result.conversion.has_booking_system).toBe(false);
  });

  it("comprueba enlaces internos de verdad y reporta cuántos ha mirado", async () => {
    const result = await scanWebsite(server.url("/malo"), opts);

    expect(result.technical.broken_links_checked).toBe(2);
    expect(result.technical.broken_links_found).toHaveLength(2);
    expect((result.technical.broken_links_found as string[])[0]).toContain("404");
  });

  it("no afirma haber revisado todo el sitio", async () => {
    const result = await scanWebsite(server.url("/"), opts);

    expect(result.unavailableMetrics).toContain("full_site_broken_link_crawl");
    expect(result.unavailableMetrics).toContain("field_core_web_vitals");
    // Sin GOOGLE_PAGESPEED_API_KEY, Lighthouse se declara no disponible en
    // lugar de estimarse.
    expect(result.unavailableMetrics).toContain("lighthouse_performance_score");
  });

  it("falla de forma segura ante un host inexistente, sin inventar datos", async () => {
    const result = await scanWebsite("https://dominio-que-no-existe-jamas-12345.test/", opts);

    expect(result.status).toBe("failed");
    expect(result.error).toBeTruthy();
    expect(result.technical).toEqual({});
    expect(result.seo).toEqual({});
    expect(result.socialLinks).toEqual({});
  });

  it("sigue bloqueando loopback cuando no se pide explícitamente la excepción", async () => {
    const result = await scanWebsite(server.url("/"));

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/no es|not a public|no public/i);
  });

  it("sigue bloqueando el endpoint de metadatos de la nube aunque se permita loopback", async () => {
    const result = await scanWebsite("http://169.254.169.254/latest/meta-data/", opts);

    expect(result.status).toBe("failed");
  });
});

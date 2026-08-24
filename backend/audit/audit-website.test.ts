import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditWebsite, prioritise, qualityGate, scoreDimensions } from "./audit-website";
import { accessibilityChecks } from "./accessibility";
import { analyzeStructuredData } from "./structured-data";
import { DIMENSION_WEIGHTS, type AuditCheck } from "./types";
import { startTestServer, GOOD_PAGE, BAD_PAGE, type TestServer } from "@/backend/scanner/test-server";
import * as cheerio from "cheerio";

/**
 * W1 — the audit engine, run against real pages over real HTTP.
 *
 * Only the network is local. The parsing, the checks, the scoring and the
 * gate are the production code, and the two fixtures are the same ones the
 * scanner suite already uses, so a change that breaks one breaks both.
 */

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer({
    "/bueno": { body: GOOD_PAGE },
    "/malo": { body: BAD_PAGE },
    "/robots.txt": { body: "User-agent: *", headers: { "Content-Type": "text/plain" } },
    "/sitemap.xml": {
      body: '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
      headers: { "Content-Type": "application/xml" },
    },
  });
});

afterAll(async () => {
  await server.close();
});

const OPTIONS = { allowLoopbackForTesting: true, skipMobile: true } as const;

describe("auditoría de una web real", () => {
  it("puntúa las nueve dimensiones y da una nota global", async () => {
    const audit = await auditWebsite(server.url("/bueno"), OPTIONS);

    expect(audit.dimensions).toHaveLength(9);
    expect(audit.overall).not.toBeNull();
    expect(audit.overall).toBeGreaterThan(0);
    expect(audit.overall).toBeLessThanOrEqual(100);

    for (const dimension of audit.dimensions) {
      if (dimension.score !== null) {
        expect(dimension.score).toBeGreaterThanOrEqual(0);
        expect(dimension.score).toBeLessThanOrEqual(100);
      }
    }
  });

  it("una página buena puntúa por encima de una mala en todas las dimensiones medibles", async () => {
    const good = await auditWebsite(server.url("/bueno"), OPTIONS);
    const bad = await auditWebsite(server.url("/malo"), OPTIONS);

    expect(good.overall!).toBeGreaterThan(bad.overall!);

    for (const dimension of good.dimensions) {
      const counterpart = bad.dimensions.find((d) => d.key === dimension.key)!;
      if (dimension.score === null || counterpart.score === null) continue;
      expect(dimension.score).toBeGreaterThanOrEqual(counterpart.score);
    }
  });

  it("detecta los defectos concretos de la página mala", async () => {
    const audit = await auditWebsite(server.url("/malo"), OPTIONS);
    const byId = new Map(audit.dimensions.flatMap((d) => d.checks).map((c) => [c.id, c]));

    expect(byId.get("onpage-title")!.status).toBe("FAIL");
    expect(byId.get("a11y-lang")!.status).toBe("FAIL");
    expect(byId.get("a11y-img-alt")!.status).toBe("FAIL");
    expect(byId.get("onpage-h1")!.status).toBe("FAIL");
    expect(byId.get("code-semantics")!.status).toBe("FAIL");
    expect(byId.get("schema-present")!.status).toBe("FAIL");
    // Sin ninguna vía de contacto directa: es el fallo comercial más caro.
    expect(byId.get("cro-contact-routes")!.status).toBe("FAIL");
  });

  it("reconoce lo que la página buena hace bien", async () => {
    const audit = await auditWebsite(server.url("/bueno"), OPTIONS);
    const byId = new Map(audit.dimensions.flatMap((d) => d.checks).map((c) => [c.id, c]));

    expect(byId.get("onpage-title")!.status).toBe("PASS");
    expect(byId.get("a11y-lang")!.status).toBe("PASS");
    expect(byId.get("tech-canonical")!.status).toBe("PASS");
    expect(byId.get("tech-robots")!.status).toBe("PASS");
    expect(byId.get("tech-sitemap")!.status).toBe("PASS");
    expect(byId.get("local-phone")!.status).toBe("PASS");
    expect(byId.get("cro-contact-routes")!.status).toBe("PASS");
    expect(byId.get("onpage-opengraph")!.status).toBe("PASS");
  });

  it("cada fallo lleva la evidencia observada y qué hacer", async () => {
    const audit = await auditWebsite(server.url("/malo"), OPTIONS);

    for (const check of audit.dimensions.flatMap((d) => d.checks)) {
      expect(check.evidence.length).toBeGreaterThan(0);
      if (check.status === "FAIL" || check.status === "WARN") {
        expect(check.fix, `${check.id} no dice qué hacer`).toBeTruthy();
      }
      if (check.status === "NO_EVALUABLE") {
        // Nunca se presenta como un cero: se explica por qué no se midió.
        expect(check.missing, `${check.id} no explica por qué no se pudo medir`).toBeTruthy();
        expect(check.weight).toBe(0);
      }
    }
  });

  it("prioriza los fallos críticos por delante de los menores", async () => {
    const audit = await auditWebsite(server.url("/malo"), OPTIONS);

    expect(audit.priorities.length).toBeGreaterThan(0);
    const severities = audit.priorities.map((c) => c.severity);
    const firstMinor = severities.indexOf("minor");
    const lastCritical = severities.lastIndexOf("critical");
    if (firstMinor >= 0 && lastCritical >= 0) {
      expect(lastCritical).toBeLessThan(firstMinor);
    }
  });

  it("una web que no responde NO se puntúa con ceros", async () => {
    const audit = await auditWebsite(server.url("/no-existe"), OPTIONS);

    // Cero diría "lo hacen fatal". La verdad es que no se pudo ver nada.
    expect(audit.overall).toBeNull();
    expect(audit.confidence).toBe(0);
    expect(audit.dimensions).toEqual([]);
    expect(audit.gate.passed).toBe(false);
    // Y dice qué pasó de verdad: una página de error no es el sitio.
    expect(audit.limitations[0]).toContain("404");
  });

  it("declara sus propias limitaciones en lugar de ocultarlas", async () => {
    const audit = await auditWebsite(server.url("/bueno"), OPTIONS);

    expect(audit.limitations.length).toBeGreaterThan(0);
    const text = audit.limitations.join(" ");
    expect(text).toContain("Core Web Vitals");
    expect(text).toContain("auditoría móvil");
  });

  it("sin auditoría móvil, la dimensión Móvil baja su confianza y lo dice", async () => {
    const audit = await auditWebsite(server.url("/bueno"), OPTIONS);
    const mobile = audit.dimensions.find((d) => d.key === "mobile")!;

    expect(mobile.notEvaluable).toBeGreaterThan(0);
    expect(mobile.confidence).toBeLessThan(1);
    // La confianza global refleja que no se midió todo el modelo.
    expect(audit.confidence).toBeLessThanOrEqual(1);
  });
});

describe("modelo de puntuación", () => {
  function check(overrides: Partial<AuditCheck>): AuditCheck {
    return {
      id: "x",
      dimension: "technical_seo",
      label: "x",
      status: "PASS",
      severity: "moderate",
      weight: 1,
      evidence: "x",
      ...overrides,
    };
  }

  it("un check no evaluable NO cuenta como suspenso", () => {
    const conNoEvaluable = scoreDimensions([
      check({ id: "a", status: "PASS", weight: 5 }),
      check({ id: "b", status: "NO_EVALUABLE", weight: 0 }),
    ]);
    const sinEl = scoreDimensions([check({ id: "a", status: "PASS", weight: 5 })]);

    const conNota = conNoEvaluable.find((d) => d.key === "technical_seo")!;
    const sinNota = sinEl.find((d) => d.key === "technical_seo")!;

    expect(conNota.score).toBe(100);
    expect(conNota.score).toBe(sinNota.score);
    // Pero sí baja la confianza: se sabe menos, aunque la nota no cambie.
    expect(conNota.confidence).toBeLessThan(sinNota.confidence);
  });

  it("una dimensión sin nada medible puntúa null, no cero", () => {
    const dimensions = scoreDimensions([
      check({ id: "a", dimension: "mobile", status: "NO_EVALUABLE", weight: 0 }),
    ]);

    expect(dimensions.find((d) => d.key === "mobile")!.score).toBeNull();
  });

  it("un WARN cuenta como medio acierto, no como suspenso", () => {
    const warn = scoreDimensions([check({ status: "WARN", weight: 10 })]);
    const fail = scoreDimensions([check({ status: "FAIL", weight: 10 })]);

    expect(warn.find((d) => d.key === "technical_seo")!.score).toBe(50);
    expect(fail.find((d) => d.key === "technical_seo")!.score).toBe(0);
  });

  it("los pesos de las dimensiones suman 100", () => {
    expect(Object.values(DIMENSION_WEIGHTS).reduce((sum, w) => sum + w, 0)).toBe(100);
  });
});

describe("quality gate (§32)", () => {
  function check(overrides: Partial<AuditCheck>): AuditCheck {
    return {
      id: "x",
      dimension: "technical_seo",
      label: "Comprobación",
      status: "PASS",
      severity: "moderate",
      weight: 1,
      evidence: "x",
      ...overrides,
    };
  }

  it("un fallo crítico bloquea la entrega", () => {
    const checks = [check({ status: "FAIL", severity: "critical", label: "HTTPS" })];
    const gate = qualityGate(checks, scoreDimensions(checks));

    expect(gate.passed).toBe(false);
    expect(gate.blockers).toHaveLength(1);
    expect(gate.reason).toContain("HTTPS");
  });

  it("una dimensión sin medir también bloquea", () => {
    // Sin fallos críticos, pero ocho dimensiones sin una sola comprobación.
    const checks = [check({ status: "PASS" })];
    const gate = qualityGate(checks, scoreDimensions(checks));

    expect(gate.passed).toBe(false);
    expect(gate.blockers).toEqual([]);
    expect(gate.reason).toContain("No se pudo evaluar");
  });

  it("un fallo serio no bloquea, pero se declara", () => {
    const dimensions = scoreDimensions([check({ status: "FAIL", severity: "serious" })]);
    // Se simula un modelo completo para aislar la regla bajo prueba.
    const complete = dimensions.map((d) => ({ ...d, score: d.score ?? 80 }));
    const gate = qualityGate([check({ status: "FAIL", severity: "serious" })], complete);

    expect(gate.passed).toBe(true);
    expect(gate.warnings).toHaveLength(1);
    expect(gate.reason).toContain("no bloquean");
  });

  it("ordena los arreglos por gravedad y después por peso", () => {
    const ordered = prioritise([
      check({ id: "menor", status: "FAIL", severity: "minor", weight: 9 }),
      check({ id: "critico", status: "FAIL", severity: "critical", weight: 1 }),
      check({ id: "serio-pesado", status: "FAIL", severity: "serious", weight: 8 }),
      check({ id: "serio-ligero", status: "FAIL", severity: "serious", weight: 2 }),
      check({ id: "aprobado", status: "PASS" }),
    ]);

    expect(ordered.map((c) => c.id)).toEqual(["critico", "serio-pesado", "serio-ligero", "menor"]);
  });
});

describe("accesibilidad", () => {
  const load = (html: string) => accessibilityChecks(cheerio.load(html));
  const statusOf = (html: string, id: string) => load(html).find((c) => c.id === id)!.status;

  it("un alt vacío en imagen decorativa es correcto, no un fallo", () => {
    expect(statusOf('<html lang="es"><body><img src="a.jpg" alt=""></body></html>', "a11y-img-alt")).toBe("PASS");
    expect(statusOf('<html lang="es"><body><img src="a.jpg"></body></html>', "a11y-img-alt")).toBe("FAIL");
  });

  it("un campo etiquetado por label envolvente cuenta como etiquetado", () => {
    expect(statusOf("<html><body><label>Email <input name='e'></label></body></html>", "a11y-form-labels")).toBe("PASS");
    expect(statusOf("<html><body><input name='e'></body></html>", "a11y-form-labels")).toBe("FAIL");
  });

  it("un placeholder NO cuenta como etiqueta", () => {
    expect(statusOf("<html><body><input placeholder='Tu email'></body></html>", "a11y-form-labels")).toBe("FAIL");
  });

  it("un enlace de icono con alt es accesible; sin él, no", () => {
    expect(statusOf('<html><body><a href="/x"><img src="i.svg" alt="Inicio"></a></body></html>', "a11y-link-text")).toBe("PASS");
    expect(statusOf('<html><body><a href="/x"><img src="i.svg" alt=""></a></body></html>', "a11y-link-text")).toBe("FAIL");
  });

  it("bloquear el zoom es un fallo de accesibilidad", () => {
    const blocked = '<html><head><meta name="viewport" content="width=device-width, user-scalable=no"></head><body></body></html>';
    const ok = '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>';

    expect(statusOf(blocked, "a11y-zoom")).toBe("FAIL");
    expect(statusOf(ok, "a11y-zoom")).toBe("PASS");
  });

  it("detecta saltos de nivel en los encabezados", () => {
    expect(statusOf("<html><body><h1>a</h1><h2>b</h2><h3>c</h3></body></html>", "a11y-heading-order")).toBe("PASS");
    expect(statusOf("<html><body><h1>a</h1><h4>b</h4></body></html>", "a11y-heading-order")).toBe("FAIL");
  });

  it("NO afirma nada sobre contraste ni foco desde el HTML", () => {
    const checks = load('<html lang="es"><body><p>hola</p></body></html>');

    for (const id of ["a11y-contrast", "a11y-focus", "a11y-keyboard"]) {
      const check = checks.find((c) => c.id === id)!;
      expect(check.status).toBe("NO_EVALUABLE");
      expect(check.weight).toBe(0);
      expect(check.missing).toBeTruthy();
    }
  });

  it("cada comprobación cita la referencia WCAG", () => {
    for (const check of load('<html lang="es"><body></body></html>')) {
      expect(check.reference).toContain("w3.org");
    }
  });
});

describe("datos estructurados", () => {
  const analyze = (html: string) => analyzeStructuredData(cheerio.load(html));

  function withJsonLd(json: string): string {
    return `<html><head><script type="application/ld+json">${json}</script></head><body></body></html>`;
  }

  it("detecta las propiedades obligatorias que faltan", () => {
    const report = analyze(withJsonLd('{"@type":"LocalBusiness","name":"Bar Pepe"}'));
    const required = report.checks.find((c) => c.id === "schema-localbusiness-required")!;

    expect(required.status).toBe("FAIL");
    expect(required.evidence).toContain("address");
  });

  it("aprueba cuando están todas las obligatorias", () => {
    const report = analyze(
      withJsonLd('{"@type":"LocalBusiness","name":"Bar Pepe","address":{"@type":"PostalAddress","streetAddress":"C/ Mayor 1"}}')
    );

    expect(report.checks.find((c) => c.id === "schema-localbusiness-required")!.status).toBe("PASS");
  });

  it("encuentra nodos dentro de @graph", () => {
    const report = analyze(
      withJsonLd('{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"X"},{"@type":"WebSite","name":"X","url":"https://x.test"}]}')
    );

    expect(report.nodes.map((n) => n.type).sort()).toEqual(["Organization", "WebSite"]);
  });

  it("un bloque JSON malformado se reporta, no se ignora en silencio", () => {
    const report = analyze(withJsonLd("{esto no es json}"));

    expect(report.malformed).toBe(1);
    const parses = report.checks.find((c) => c.id === "schema-parses")!;
    expect(parses.status).toBe("FAIL");
    expect(parses.evidence).toContain("Google los ignora");
  });

  it("NO inventa requisitos para un tipo que no conoce", () => {
    const report = analyze(withJsonLd('{"@type":"TipoInventado","name":"X"}'));

    expect(report.nodes[0].type).toBe("TipoInventado");
    // Se detecta el nodo, pero no se emite ningún juicio sobre él.
    expect(report.checks.some((c) => c.id.includes("tipoinventado"))).toBe(false);
  });

  it("las comprobaciones citan la documentación de Google", () => {
    const report = analyze(withJsonLd('{"@type":"Restaurant","name":"X","address":"Y"}'));

    for (const check of report.checks) {
      expect(check.reference).toContain("developers.google.com");
    }
  });
});

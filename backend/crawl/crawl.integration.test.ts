import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crawlSite } from "./crawler";
import { findIssues } from "./issues";
import { analyzeSite, selectAuditTargets, siteQualityGate } from "./crawl-site";
import { startTestSite, type TestSite } from "./test-site";
import { discoverSitemaps } from "./sitemap";
import { fetchRobotsTxt } from "./robots";
import type { SiteModel } from "./site-model";

/**
 * W2 — end-to-end against a real HTTP server.
 *
 * Everything here is real: real redirects, real 404s, real 500s, a real
 * redirect loop, a real sitemap index. Only the network is local. The crawler,
 * the parsers and the issue detection are the production code.
 */

const OPTIONS = { allowLoopbackForTesting: true, delayMs: 0 } as const;

let site: TestSite;
let model: SiteModel;

beforeAll(async () => {
  site = await startTestSite();
  // One crawl shared by most assertions: it is the expensive part, and every
  // test asserts a different property of the same real result.
  model = await crawlSite(site.url("/"), { ...OPTIONS, maxPages: 40, maxDepth: 5 });
}, 120_000);

afterAll(async () => {
  await site.close();
});

function pageAt(path: string) {
  return model.pages.find((page) => page.url === site.url(path));
}

describe("descubrimiento de URLs", () => {
  it("rastrea siguiendo los enlaces internos", () => {
    expect(pageAt("/")!.state).toBe("OK");
    expect(pageAt("/servicios")!.state).toBe("OK");
    expect(pageAt("/servicios/web")!.state).toBe("OK");
    expect(pageAt("/contacto")!.state).toBe("OK");
  });

  it("descubre URLs que solo están en el sitemap", () => {
    const orphan = pageAt("/huerfana");

    expect(orphan).toBeDefined();
    expect(orphan!.discoveredVia).toBe("sitemap");
    expect(orphan!.state).toBe("OK");
    expect(orphan!.inSitemap).toBe(true);
  });

  it("sigue el sitemap index hasta sus hijos", () => {
    expect(model.sitemap.status).toBe("VERIFIED");
    expect(model.sitemap.documents.some((d) => d.kind === "sitemapindex")).toBe(true);
    expect(model.sitemap.documents.filter((d) => d.kind === "urlset")).toHaveLength(2);
    // URLs de los dos hijos, no solo del primero.
    expect(model.sitemap.urls.map((u) => u.url)).toContain(site.url("/servicios/seo"));
    expect(model.sitemap.urls.map((u) => u.url)).toContain(site.url("/huerfana"));
  });

  it("encuentra el sitemap declarado en robots.txt", () => {
    expect(model.robots.status).toBe("VERIFIED");
    expect(model.robots.sitemaps).toEqual([site.url("/sitemap.xml")]);
    expect(model.sitemap.discoveredVia).toContain("robots.txt");
  });

  it("no sale del dominio", () => {
    for (const page of model.pages) {
      expect(page.url.startsWith(site.origin)).toBe(true);
    }
    // El enlace externo se registra en el grafo, pero no se rastrea.
    const externals = pageAt("/")!.outboundLinks.filter((link) => !link.internal);
    expect(externals.length).toBeGreaterThan(0);
  });

  it("no rastrea dos veces la misma URL con parámetros de campaña", () => {
    // La portada se enlaza también como /?utm_source=newsletter.
    const homepages = model.pages.filter((page) => page.url.startsWith(site.url("/?")) || page.url === site.url("/"));
    expect(homepages).toHaveLength(1);
  });
});

describe("estados HTTP", () => {
  it("registra un 404 como error de cliente", () => {
    const broken = pageAt("/roto")!;
    expect(broken.state).toBe("CLIENT_ERROR");
    expect(broken.status).toBe(404);
  });

  it("registra un 500 como error de servidor", () => {
    const error = pageAt("/error")!;
    expect(error.state).toBe("SERVER_ERROR");
    expect(error.status).toBe(500);
  });

  it("sigue una redirección simple y guarda el salto", () => {
    const redirected = pageAt("/viejo")!;

    expect(redirected.state).toBe("REDIRECT");
    expect(redirected.status).toBe(200);
    expect(redirected.redirects).toHaveLength(1);
    expect(redirected.finalUrl).toBe(site.url("/nuevo"));
  });

  it("detecta una cadena de dos saltos", () => {
    const chain = pageAt("/cadena1")!;

    expect(chain.redirects).toHaveLength(2);
    expect(chain.finalUrl).toBe(site.url("/cadena3"));
  });
});

describe("robots.txt", () => {
  it("no rastrea lo que robots.txt prohíbe", () => {
    const blocked = pageAt("/privado")!;

    expect(blocked.state).toBe("BLOCKED_BY_ROBOTS");
    expect(blocked.allowedByRobots).toBe(false);
    expect(blocked.robotsReason).toContain("Disallow");
    // Y no se llegó a pedir la página.
    expect(site.requestLog).not.toContain("/privado");
  });
});

describe("arquitectura", () => {
  it("la profundidad es la distancia en clics desde la portada", () => {
    expect(pageAt("/")!.depth).toBe(0);
    expect(pageAt("/servicios")!.depth).toBe(1);
    expect(pageAt("/servicios/web")!.depth).toBe(2);
  });

  it("calcula enlaces entrantes sin contar los autoenlaces", () => {
    const contacto = pageAt("/contacto")!;

    // Enlazada desde la portada y desde las dos páginas de servicios.
    expect(contacto.inboundLinks.length).toBeGreaterThanOrEqual(3);
    expect(contacto.inboundLinks).not.toContain(contacto.url);
  });

  it("identifica como huérfana la página que nadie enlaza", () => {
    expect(model.architecture.orphans).toContain(site.url("/huerfana"));
    // La portada y las enlazadas no son huérfanas.
    expect(model.architecture.orphans).not.toContain(site.url("/"));
    expect(model.architecture.orphans).not.toContain(site.url("/contacto"));
  });

  it("el destino de una redirección NO es huérfano: se llega a él", () => {
    // Nadie enlaza /nuevo directamente, pero /viejo está enlazado y redirige
    // ahí, así que los visitantes aterrizan en él.
    expect(model.pages.find((p) => p.url === site.url("/nuevo"))!.inboundLinks).toEqual([]);
    expect(model.architecture.orphans).not.toContain(site.url("/nuevo"));
    expect(model.architecture.orphans).not.toContain(site.url("/cadena3"));
  });

  it("agrupa las páginas por profundidad", () => {
    expect(model.architecture.byDepth[0]).toEqual([site.url("/")]);
    expect(model.architecture.byDepth[1]).toContain(site.url("/servicios"));
  });

  it("ordena las páginas más enlazadas", () => {
    expect(model.architecture.mostLinked[0].inbound).toBeGreaterThan(0);
    const inbounds = model.architecture.mostLinked.map((entry) => entry.inbound);
    expect([...inbounds].sort((a, b) => b - a)).toEqual(inbounds);
  });
});

describe("detección de problemas", () => {
  const codes = () => findIssues(model).map((issue) => issue.code);

  it("encuentra los errores 4xx y 5xx", () => {
    expect(codes()).toContain("CLIENT_ERROR");
    expect(codes()).toContain("SERVER_ERROR");
  });

  it("encuentra los enlaces internos rotos y dice desde dónde", () => {
    const broken = findIssues(model).find((issue) => issue.code === "BROKEN_LINK")!;

    expect(broken).toBeDefined();
    expect(broken.urls).toContain(site.url("/"));
    expect(broken.evidence).toContain("/roto");
  });

  it("encuentra la página huérfana", () => {
    const orphan = findIssues(model).find((issue) => issue.code === "ORPHAN_PAGE")!;
    expect(orphan.urls).toContain(site.url("/huerfana"));
  });

  it("encuentra títulos y meta descriptions duplicados", () => {
    const title = findIssues(model).find((issue) => issue.code === "DUPLICATE_TITLE")!;

    expect(title.urls).toContain(site.url("/servicios/web"));
    expect(title.urls).toContain(site.url("/servicios/seo"));
    expect(codes()).toContain("DUPLICATE_META_DESCRIPTION");
    expect(codes()).toContain("DUPLICATE_H1");
  });

  it("encuentra la misma página con y sin barra final", () => {
    const duplicate = findIssues(model).find((issue) => issue.code === "DUPLICATE_URL")!;
    expect(duplicate.evidence).toContain("/duplicada");
  });

  it("encuentra contenido idéntico en dos URLs", () => {
    const duplicate = findIssues(model).find((issue) => issue.code === "DUPLICATE_CONTENT")!;
    expect(duplicate.urls).toContain(site.url("/duplicada"));
  });

  it("encuentra canonicals cruzados", () => {
    const conflict = findIssues(model).find((issue) => issue.code === "CANONICAL_CONFLICT")!;

    expect(conflict).toBeDefined();
    expect(conflict.urls).toContain(site.url("/canonical-a"));
  });

  it("encuentra la cadena de redirecciones", () => {
    const chain = findIssues(model).find((issue) => issue.code === "REDIRECT_CHAIN")!;
    expect(chain.urls).toContain(site.url("/cadena1"));
  });

  it("encuentra páginas demasiado profundas", () => {
    const deep = findIssues(model).find((issue) => issue.code === "TOO_DEEP")!;
    expect(deep.urls).toContain(site.url("/profunda/a/b/c/d"));
  });

  it("encuentra en el sitemap una URL que no debería indexarse", () => {
    const issue = findIssues(model).find((entry) => entry.code === "SITEMAP_URL_NOT_INDEXABLE")!;

    expect(issue.urls).toContain(site.url("/noindex"));
    expect(issue.evidence).toContain("noindex");
  });

  it("encuentra en el sitemap una URL que devuelve error", () => {
    const issue = findIssues(model).find((entry) => entry.code === "SITEMAP_URL_ERROR")!;
    expect(issue.urls).toContain(site.url("/roto"));
  });

  it("encuentra páginas indexables ausentes del sitemap", () => {
    const issue = findIssues(model).find((entry) => entry.code === "MISSING_FROM_SITEMAP")!;
    expect(issue.urls).toContain(site.url("/nuevo"));
  });

  it("cada problema lleva evidencia, URLs y qué hacer", () => {
    for (const issue of findIssues(model)) {
      expect(issue.evidence.length).toBeGreaterThan(0);
      expect(issue.fix.length).toBeGreaterThan(0);
      expect(issue.urls.length).toBeGreaterThan(0);
      expect(["VERIFIED", "PROBABLE", "NOT_VERIFIED", "NO_EVALUABLE"]).toContain(issue.verification);
    }
  });

  it("ordena por gravedad", () => {
    const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
    const ranks = findIssues(model).map((issue) => order[issue.severity]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });
});

describe("bucles de redirección", () => {
  it("no se queda colgado y lo declara como bucle", async () => {
    const loopSite = await startTestSite({
      bare: true,
      routes: (origin) => ({
        "/": {
          body: `<html lang="es"><head><title>Inicio con bucle</title></head><body><a href="/bucle-a">bucle</a></body></html>`,
        },
        "/bucle-a": { status: 301, headers: { Location: `${origin}/bucle-b` } },
        "/bucle-b": { status: 301, headers: { Location: `${origin}/bucle-a` } },
      }),
    });

    try {
      const loopModel = await crawlSite(loopSite.url("/"), { ...OPTIONS, maxPages: 10 });
      const looping = loopModel.pages.find((page) => page.url === loopSite.url("/bucle-a"))!;

      expect(looping.state).toBe("UNREACHABLE");
      expect(looping.error).toContain("Bucle de redirecciones");
      expect(findIssues(loopModel).map((issue) => issue.code)).toContain("REDIRECT_LOOP");
    } finally {
      await loopSite.close();
    }
  }, 60_000);
});

describe("sitio sin sitemap ni robots", () => {
  it("lo declara en lugar de fallar", async () => {
    const bare = await startTestSite({
      bare: true,
      routes: () => ({
        "/": {
          body: `<html lang="es"><head><title>Sitio mínimo sin nada</title></head><body><main><h1>Hola</h1><a href="/otra">otra</a></main></body></html>`,
        },
        "/otra": {
          body: `<html lang="es"><head><title>Otra página del sitio mínimo</title></head><body><main><h1>Otra</h1></main></body></html>`,
        },
      }),
    });

    try {
      const bareModel = await crawlSite(bare.url("/"), { ...OPTIONS, maxPages: 10 });

      expect(bareModel.robots.status).toBe("NOT_FOUND");
      expect(bareModel.sitemap.status).toBe("NOT_FOUND");
      // Y aun así rastrea el sitio siguiendo enlaces.
      expect(bareModel.stats.ok).toBe(2);

      const codes = findIssues(bareModel).map((issue) => issue.code);
      expect(codes).toContain("NO_SITEMAP");
      expect(codes).toContain("NO_ROBOTS");
    } finally {
      await bare.close();
    }
  }, 60_000);
});

describe("límites del crawl", () => {
  it("respeta el máximo de páginas y declara lo que quedó sin ver", async () => {
    const limited = await crawlSite(site.url("/"), { ...OPTIONS, maxPages: 3 });

    expect(limited.stats.fetched).toBeLessThanOrEqual(3);
    expect(limited.stats.stoppedBy).toBe("max_pages");
    expect(limited.stats.notFetched).toBeGreaterThan(0);
    expect(limited.limitations.join(" ")).toContain("sin rastrear");
  }, 60_000);

  it("con un crawl parcial, las conclusiones bajan a PROBABLE", async () => {
    const limited = await crawlSite(site.url("/"), { ...OPTIONS, maxPages: 4 });
    const orphanIssue = findIssues(limited).find((issue) => issue.code === "ORPHAN_PAGE");

    // Si aparece, no puede afirmarse con la misma certeza que en un crawl completo.
    if (orphanIssue) {
      expect(orphanIssue.verification).toBe("PROBABLE");
      expect(orphanIssue.evidence).toContain("puede haber más");
    }
  }, 60_000);

  it("respeta el máximo de profundidad", async () => {
    const shallow = await crawlSite(site.url("/"), { ...OPTIONS, maxPages: 40, maxDepth: 1 });
    const deep = shallow.pages.find((page) => page.url === site.url("/servicios/web"));

    expect(deep?.state).toBe("NOT_FETCHED");
  }, 60_000);
});

describe("integración con W1", () => {
  it("audita una muestra de páginas y dice cuáles y por qué", async () => {
    const analysis = await analyzeSite(site.url("/"), {
      ...OPTIONS,
      maxPages: 12,
      auditSample: 2,
      skipMobile: true,
    });

    expect(analysis.audits).toHaveLength(2);
    expect(analysis.audits[0].url).toBe(site.url("/"));
    expect(analysis.audits[0].reason).toContain("entrada");
    expect(analysis.audits[0].audit.overall).not.toBeNull();
    expect(analysis.averagePageScore).not.toBeNull();

    // Y declara que la muestra no es el sitio entero.
    expect(analysis.limitations.join(" ")).toContain("no el sitio entero");
  }, 120_000);

  it("con auditSample 0 no audita nada y lo declara", async () => {
    const analysis = await analyzeSite(site.url("/"), { ...OPTIONS, maxPages: 5, auditSample: 0 });

    expect(analysis.audits).toEqual([]);
    expect(analysis.averagePageScore).toBeNull();
    expect(analysis.limitations.join(" ")).toContain("solo hay resultados de crawl");
  }, 60_000);

  it("elige la portada y luego las páginas más enlazadas", () => {
    const targets = selectAuditTargets(model, 3);

    expect(targets[0].url).toBe(site.url("/"));
    expect(targets).toHaveLength(3);
    for (const target of targets.slice(1)) {
      expect(target.reason).toContain("enlace");
    }
  });
});

describe("quality gate de sitio", () => {
  it("un problema crítico bloquea", () => {
    const gate = siteQualityGate(findIssues(model), model);

    expect(gate.passed).toBe(false);
    // El sitio de prueba tiene 404 y 500 a propósito.
    expect(gate.blockers.length).toBeGreaterThan(0);
  });

  it("un crawl incompleto también bloquea", async () => {
    const limited = await crawlSite(site.url("/"), { ...OPTIONS, maxPages: 2 });
    const gate = siteQualityGate([], limited);

    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain("no se ha visto el sitio entero");
  }, 60_000);

  it("un sitio limpio y completamente rastreado pasa", async () => {
    const clean = await startTestSite({
      bare: true,
      routes: (origin) => ({
        "/": {
          body: `<html lang="es"><head><title>Sitio limpio de prueba</title><meta name="description" content="Un sitio pequeño sin ningún problema que detectar."><link rel="canonical" href="${origin}/"></head><body><main><h1>Inicio</h1><a href="/dos">dos</a></main></body></html>`,
        },
        "/dos": {
          body: `<html lang="es"><head><title>Segunda página limpia</title><meta name="description" content="La segunda página, también sin problemas."><link rel="canonical" href="${origin}/dos"></head><body><main><h1>Dos</h1><a href="/">inicio</a></main></body></html>`,
        },
        "/robots.txt": {
          headers: { "Content-Type": "text/plain" },
          body: `User-agent: *\nDisallow:\nSitemap: ${origin}/sitemap.xml`,
        },
        "/sitemap.xml": {
          headers: { "Content-Type": "application/xml" },
          body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url><url><loc>${origin}/dos</loc></url></urlset>`,
        },
      }),
    });

    try {
      const cleanModel = await crawlSite(clean.url("/"), { ...OPTIONS, maxPages: 20 });
      const issues = findIssues(cleanModel);
      const gate = siteQualityGate(issues, cleanModel);

      expect(cleanModel.stats.stoppedBy).toBe("completed");
      expect(issues.filter((issue) => issue.severity === "critical")).toEqual([]);
      expect(gate.passed).toBe(true);
    } finally {
      await clean.close();
    }
  }, 60_000);
});

describe("lectura directa de robots y sitemap", () => {
  it("fetchRobotsTxt lee el fichero real", async () => {
    const robots = await fetchRobotsTxt(site.origin, OPTIONS);

    expect(robots.status).toBe("VERIFIED");
    expect(robots.rules.some((rule) => rule.pattern === "/privado")).toBe(true);
  });

  it("discoverSitemaps recorre el índice completo", async () => {
    const report = await discoverSitemaps(site.origin, { ...OPTIONS, fromRobots: [site.url("/sitemap.xml")] });

    expect(report.status).toBe("VERIFIED");
    expect(report.urls.length).toBeGreaterThanOrEqual(8);
  });
});

import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A complete fixture site for the crawler tests.
 *
 * Separate from the scanner's `test-server` on purpose: this one routes on
 * the full URL including the query string, which the crawler needs and the
 * scanner never did. Modifying the existing one would risk the W1 and scanner
 * suites for no benefit.
 *
 * The site deliberately contains every defect W2 is supposed to find, so the
 * tests assert against real HTTP behaviour — real 301 chains, real loops,
 * real 404s — instead of stubbed responses.
 */

export interface SiteRoute {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}

export interface TestSite {
  origin: string;
  url(path: string): string;
  requestLog: string[];
  close(): Promise<void>;
}

function page(options: {
  title: string;
  h1?: string;
  description?: string;
  canonical?: string;
  robots?: string;
  links?: string[];
  body?: string;
}): string {
  const links = (options.links ?? []).map((href) => `<a href="${href}">${href}</a>`).join("\n    ");

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>${options.title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${options.description ? `<meta name="description" content="${options.description}">` : ""}
  ${options.canonical ? `<link rel="canonical" href="${options.canonical}">` : ""}
  ${options.robots ? `<meta name="robots" content="${options.robots}">` : ""}
</head>
<body>
  <main>
    <h1>${options.h1 ?? options.title}</h1>
    <p>${options.body ?? "Contenido de la página de prueba."}</p>
    ${links}
  </main>
</body>
</html>`;
}

/**
 * Builds the fixture routes. Takes the origin because canonicals and sitemaps
 * must contain absolute URLs, and the port is only known once listening.
 */
export function buildRoutes(origin: string): Record<string, SiteRoute> {
  const DUPLICATE_BODY = "Exactamente el mismo texto en dos URLs distintas.";

  return {
    "/": {
      body: page({
        title: "Inicio — Sitio de prueba",
        description: "Página de inicio del sitio de prueba para el crawler.",
        links: [
          "/servicios",
          "/contacto",
          "/roto",
          "/error",
          "/viejo",
          "/cadena1",
          "/duplicada",
          "/duplicada/",
          "/canonical-a",
          "/noindex",
          "/privado",
          "/profunda",
          "/?utm_source=newsletter",
          "https://externo.example.com/",
        ],
      }),
    },

    "/servicios": {
      body: page({
        title: "Servicios — Sitio de prueba",
        description: "Listado de servicios que ofrece el sitio de prueba.",
        links: ["/servicios/web", "/servicios/seo"],
      }),
    },

    // Two pages sharing a title and a meta description: DUPLICATE_TITLE and
    // DUPLICATE_META_DESCRIPTION.
    "/servicios/web": {
      body: page({
        title: "Nuestros servicios",
        h1: "Servicios repetidos",
        description: "La misma descripción en dos páginas distintas.",
        links: ["/contacto"],
      }),
    },
    "/servicios/seo": {
      body: page({
        title: "Nuestros servicios",
        h1: "Servicios repetidos",
        description: "La misma descripción en dos páginas distintas.",
        links: ["/contacto"],
      }),
    },

    "/contacto": {
      body: page({
        title: "Contacto — Sitio de prueba",
        description: "Cómo ponerse en contacto con el sitio de prueba.",
      }),
    },

    // In the sitemap, linked from nowhere: ORPHAN_PAGE.
    "/huerfana": {
      body: page({
        title: "Página huérfana — Sitio de prueba",
        description: "Existe y está en el sitemap, pero nadie la enlaza.",
      }),
    },

    "/roto": { status: 404, body: page({ title: "No encontrada" }) },
    "/error": { status: 500, body: page({ title: "Error del servidor" }) },

    // Single redirect, and a two-hop chain.
    "/viejo": { status: 301, headers: { Location: `${origin}/nuevo` } },
    "/nuevo": {
      body: page({ title: "Página nueva — Sitio de prueba", description: "Destino de la redirección." }),
    },
    "/cadena1": { status: 301, headers: { Location: `${origin}/cadena2` } },
    "/cadena2": { status: 301, headers: { Location: `${origin}/cadena3` } },
    "/cadena3": {
      body: page({ title: "Final de la cadena", description: "Se llega tras dos redirecciones." }),
    },

    // A genuine loop: the guard should give up rather than spin.
    "/bucle-a": { status: 301, headers: { Location: `${origin}/bucle-b` } },
    "/bucle-b": { status: 301, headers: { Location: `${origin}/bucle-a` } },

    // Same content at two URLs differing only by the trailing slash.
    "/duplicada": {
      body: page({ title: "Duplicada", description: "Contenido repetido.", body: DUPLICATE_BODY }),
    },
    "/duplicada/": {
      body: page({ title: "Duplicada", description: "Contenido repetido.", body: DUPLICATE_BODY }),
    },

    // Cross-canonical: each claims the other is canonical.
    "/canonical-a": {
      body: page({
        title: "Canonical A",
        description: "Declara canónica a la B.",
        canonical: `${origin}/canonical-b`,
        links: ["/canonical-b"],
      }),
    },
    "/canonical-b": {
      body: page({
        title: "Canonical B",
        description: "Declara canónica a la A.",
        canonical: `${origin}/canonical-a`,
      }),
    },

    // Listed in the sitemap but carrying noindex.
    "/noindex": {
      body: page({
        title: "No indexable",
        description: "Está en el sitemap pero lleva noindex.",
        robots: "noindex, follow",
      }),
    },

    // Disallowed in robots.txt.
    "/privado": {
      body: page({ title: "Privada", description: "Bloqueada por robots.txt." }),
    },

    // Four levels down, to exercise the depth rules.
    "/profunda": { body: page({ title: "Profunda 1", links: ["/profunda/a"] }) },
    "/profunda/a": { body: page({ title: "Profunda 2", links: ["/profunda/a/b"] }) },
    "/profunda/a/b": { body: page({ title: "Profunda 3", links: ["/profunda/a/b/c"] }) },
    "/profunda/a/b/c": { body: page({ title: "Profunda 4", links: ["/profunda/a/b/c/d"] }) },
    "/profunda/a/b/c/d": { body: page({ title: "Profunda 5" }) },

    "/robots.txt": {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: [
        "User-agent: *",
        "Disallow: /privado",
        "Allow: /",
        "",
        `Sitemap: ${origin}/sitemap.xml`,
      ].join("\n"),
    },

    // A sitemap index pointing at two child sitemaps.
    "/sitemap.xml": {
      headers: { "Content-Type": "application/xml; charset=utf-8" },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${origin}/sitemap-paginas.xml</loc><lastmod>2026-01-15</lastmod></sitemap>
  <sitemap><loc>${origin}/sitemap-servicios.xml</loc></sitemap>
</sitemapindex>`,
    },

    "/sitemap-paginas.xml": {
      headers: { "Content-Type": "application/xml; charset=utf-8" },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${origin}/</loc><lastmod>2026-02-01</lastmod></url>
  <url><loc>${origin}/contacto</loc></url>
  <url><loc>${origin}/huerfana</loc></url>
  <url><loc>${origin}/noindex</loc></url>
  <url><loc>${origin}/roto</loc></url>
</urlset>`,
    },

    "/sitemap-servicios.xml": {
      headers: { "Content-Type": "application/xml; charset=utf-8" },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${origin}/servicios</loc></url>
  <url><loc>${origin}/servicios/web</loc></url>
  <url><loc>${origin}/servicios/seo</loc></url>
</urlset>`,
    },
  };
}

export interface StartTestSiteOptions {
  /** Replaces or adds routes after the defaults are built. */
  routes?: (origin: string) => Record<string, SiteRoute>;
  /** Serves no routes at all except what `routes` provides. */
  bare?: boolean;
}

export async function startTestSite(options: StartTestSiteOptions = {}): Promise<TestSite> {
  const requestLog: string[] = [];
  let routes: Record<string, SiteRoute> = {};

  const server = http.createServer((req, res) => {
    const requestUrl = req.url ?? "/";
    requestLog.push(requestUrl);

    // Route on the pathname, so tracking parameters resolve to the same page
    // — which is exactly what a real server does.
    const pathname = new URL(requestUrl, "http://localhost").pathname;
    const route = routes[pathname];

    if (!route) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page({ title: "404 — No encontrada" }));
      return;
    }

    res.writeHead(route.status ?? 200, {
      "Content-Type": "text/html; charset=utf-8",
      ...route.headers,
    });
    res.end(route.body ?? "");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  routes = {
    ...(options.bare ? {} : buildRoutes(origin)),
    ...(options.routes?.(origin) ?? {}),
  };

  return {
    origin,
    url: (path: string) => `${origin}${path}`,
    requestLog,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

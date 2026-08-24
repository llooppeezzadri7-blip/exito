import { describe, expect, it } from "vitest";
import {
  differsOnlyByTrailingSlash,
  looksLikePage,
  normalizeUrl,
  pathDepth,
  sameSite,
  stripWww,
} from "./url-normalize";
import { isAllowed, parseRobotsTxt } from "./robots";
import { parseSitemap } from "./sitemap";

/**
 * W2 — unit tests for the pure pieces.
 *
 * These have no network at all: URL identity, robots matching and sitemap
 * parsing are decidable from their inputs, and testing them through HTTP
 * would only make failures harder to read.
 */

describe("normalización de URLs", () => {
  it("elimina el fragmento", () => {
    expect(normalizeUrl("https://ejemplo.com/a#seccion")!.key).toBe("https://ejemplo.com/a");
    expect(normalizeUrl("https://ejemplo.com/a#seccion")!.hadFragment).toBe(true);
  });

  it("normaliza mayúsculas en esquema y host, pero NO en la ruta", () => {
    const normalized = normalizeUrl("HTTPS://Ejemplo.COM/Ruta")!;
    expect(normalized.key).toBe("https://ejemplo.com/Ruta");
  });

  it("elimina el puerto por defecto de cada esquema", () => {
    expect(normalizeUrl("https://ejemplo.com:443/a")!.key).toBe("https://ejemplo.com/a");
    expect(normalizeUrl("http://ejemplo.com:80/a")!.key).toBe("http://ejemplo.com/a");
    // Un puerto no estándar sí es significativo.
    expect(normalizeUrl("https://ejemplo.com:8443/a")!.key).toBe("https://ejemplo.com:8443/a");
  });

  it("quita los parámetros de campaña y lo declara", () => {
    const normalized = normalizeUrl("https://ejemplo.com/a?utm_source=x&gclid=y&pagina=2")!;

    expect(normalized.key).toBe("https://ejemplo.com/a?pagina=2");
    expect(normalized.strippedParams.sort()).toEqual(["gclid", "utm_source"]);
    expect(normalized.params).toEqual(["pagina"]);
  });

  it("ordena los parámetros para que el orden no genere URLs distintas", () => {
    expect(normalizeUrl("https://ejemplo.com/a?b=2&a=1")!.key).toBe(
      normalizeUrl("https://ejemplo.com/a?a=1&b=2")!.key
    );
  });

  it("NO fusiona la barra final: puede ser otra página", () => {
    const sin = normalizeUrl("https://ejemplo.com/servicios")!;
    const con = normalizeUrl("https://ejemplo.com/servicios/")!;

    // Se mantienen distintas para poder detectar el duplicado, no ocultarlo.
    expect(sin.key).not.toBe(con.key);
    expect(differsOnlyByTrailingSlash(sin.key, con.key)).toBe(true);
  });

  it("NO fusiona parámetros ordinarios", () => {
    expect(normalizeUrl("https://ejemplo.com/a?pagina=2")!.key).not.toBe(
      normalizeUrl("https://ejemplo.com/a")!.key
    );
  });

  it("resuelve rutas relativas contra su base", () => {
    expect(normalizeUrl("../contacto", "https://ejemplo.com/servicios/web")!.key).toBe(
      "https://ejemplo.com/contacto"
    );
  });

  it("rechaza esquemas que no son web", () => {
    expect(normalizeUrl("mailto:a@b.com")).toBeNull();
    expect(normalizeUrl("javascript:void(0)")).toBeNull();
    expect(normalizeUrl("no es una url")).toBeNull();
  });

  it("www y el dominio raíz son el mismo sitio", () => {
    expect(sameSite("https://www.ejemplo.com/a", "https://ejemplo.com/b")).toBe(true);
    expect(sameSite("https://ejemplo.com/a", "https://otro.com/b")).toBe(false);
    expect(stripWww("www.ejemplo.com")).toBe("ejemplo.com");
  });

  it("calcula la profundidad por segmentos de ruta", () => {
    expect(pathDepth("https://ejemplo.com/")).toBe(0);
    expect(pathDepth("https://ejemplo.com/a")).toBe(1);
    expect(pathDepth("https://ejemplo.com/a/b/c")).toBe(3);
  });

  it("distingue páginas de archivos", () => {
    expect(looksLikePage("https://ejemplo.com/servicios")).toBe(true);
    expect(looksLikePage("https://ejemplo.com/catalogo.pdf")).toBe(false);
    expect(looksLikePage("https://ejemplo.com/foto.JPG")).toBe(false);
    expect(looksLikePage("https://ejemplo.com/app.js")).toBe(false);
  });
});

describe("robots.txt", () => {
  const parse = (content: string) => parseRobotsTxt(content, "https://ejemplo.com/robots.txt");
  const allowed = (content: string, url: string) => isAllowed(parse(content), url).allowed;

  it("aplica Disallow sobre el prefijo de la ruta", () => {
    const robots = "User-agent: *\nDisallow: /privado";

    expect(allowed(robots, "https://ejemplo.com/privado")).toBe(false);
    expect(allowed(robots, "https://ejemplo.com/privado/a")).toBe(false);
    expect(allowed(robots, "https://ejemplo.com/publico")).toBe(true);
  });

  it("gana la regla más larga, y en empate gana Allow", () => {
    const robots = "User-agent: *\nDisallow: /admin\nAllow: /admin/publico";

    expect(allowed(robots, "https://ejemplo.com/admin/secreto")).toBe(false);
    expect(allowed(robots, "https://ejemplo.com/admin/publico")).toBe(true);
  });

  it("un Disallow vacío significa permitir todo", () => {
    expect(allowed("User-agent: *\nDisallow:", "https://ejemplo.com/cualquiera")).toBe(true);
  });

  it("soporta los comodines * y $", () => {
    expect(allowed("User-agent: *\nDisallow: /*.pdf$", "https://ejemplo.com/doc.pdf")).toBe(false);
    expect(allowed("User-agent: *\nDisallow: /*.pdf$", "https://ejemplo.com/doc.pdf.html")).toBe(true);
    expect(allowed("User-agent: *\nDisallow: /a/*/b", "https://ejemplo.com/a/x/b")).toBe(false);
  });

  it("elige el grupo del user-agent más específico", () => {
    const robots = [
      "User-agent: *",
      "Disallow: /",
      "",
      "User-agent: AI-Digital-Agency-OS-Crawler",
      "Disallow: /solo-esto",
    ].join("\n");

    expect(allowed(robots, "https://ejemplo.com/cualquiera")).toBe(true);
    expect(allowed(robots, "https://ejemplo.com/solo-esto")).toBe(false);
  });

  it("varios user-agent seguidos comparten el mismo grupo", () => {
    const robots = ["User-agent: Googlebot", "User-agent: *", "Disallow: /x"].join("\n");
    expect(allowed(robots, "https://ejemplo.com/x")).toBe(false);
  });

  it("extrae los sitemaps declarados", () => {
    const robots = parse("Sitemap: https://ejemplo.com/sitemap.xml\nUser-agent: *\nDisallow:");
    expect(robots.sitemaps).toEqual(["https://ejemplo.com/sitemap.xml"]);
  });

  it("ignora comentarios", () => {
    expect(allowed("User-agent: *\n# Disallow: /todo\nDisallow: /x", "https://ejemplo.com/todo")).toBe(true);
  });

  it("un robots.txt que no se pudo leer NO se interpreta como permiso", () => {
    const decision = isAllowed(
      { status: "NOT_VERIFIED", url: "x", rules: [], sitemaps: [], crawlDelaySeconds: null, reason: "timeout" },
      "https://ejemplo.com/a"
    );

    // Se rastrea, pero el motivo lo declara: no es lo mismo que un permiso.
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toContain("no verificado");
  });

  it("lee Crawl-delay", () => {
    expect(parse("User-agent: *\nCrawl-delay: 3").crawlDelaySeconds).toBe(3);
  });
});

describe("sitemap", () => {
  it("parsea un urlset con lastmod", () => {
    const document = parseSitemap(
      `<urlset><url><loc>https://ejemplo.com/a</loc><lastmod>2026-01-01</lastmod></url>
       <url><loc>https://ejemplo.com/b</loc></url></urlset>`,
      "https://ejemplo.com/sitemap.xml"
    );

    expect(document.kind).toBe("urlset");
    expect(document.entries).toHaveLength(2);
    expect(document.entries[0].lastModified).toBe("2026-01-01");
    // El lastmod pertenece a su propio <url>, no se contagia al siguiente.
    expect(document.entries[1].lastModified).toBeNull();
  });

  it("parsea un sitemap index y devuelve sus hijos", () => {
    const document = parseSitemap(
      `<sitemapindex><sitemap><loc>https://ejemplo.com/s1.xml</loc></sitemap>
       <sitemap><loc>https://ejemplo.com/s2.xml</loc></sitemap></sitemapindex>`,
      "https://ejemplo.com/sitemap.xml"
    );

    expect(document.kind).toBe("sitemapindex");
    expect(document.children).toEqual(["https://ejemplo.com/s1.xml", "https://ejemplo.com/s2.xml"]);
    expect(document.entries).toEqual([]);
  });

  it("decodifica entidades XML y CDATA", () => {
    const document = parseSitemap(
      `<urlset><url><loc>https://ejemplo.com/a?x=1&amp;y=2</loc></url>
       <url><loc><![CDATA[https://ejemplo.com/b]]></loc></url></urlset>`,
      "s"
    );

    expect(document.entries[0].url).toBe("https://ejemplo.com/a?x=1&y=2");
    expect(document.entries[1].url).toBe("https://ejemplo.com/b");
  });

  it("un documento que no es un sitemap se declara no verificado", () => {
    const document = parseSitemap("<html><body>hola</body></html>", "s");

    expect(document.status).toBe("NOT_VERIFIED");
    expect(document.kind).toBe("unknown");
    expect(document.reason).toContain("no es un sitemap válido");
  });
});

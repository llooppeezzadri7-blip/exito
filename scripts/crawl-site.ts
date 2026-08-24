import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeSite } from "@/backend/crawl/crawl-site";
import type { SiteAnalysis } from "@/backend/crawl/crawl-site";

/**
 * Crawls and analyses a whole site from the command line (W2).
 *
 *   npm run crawl -- https://ejemplo.com
 *   npm run crawl -- https://ejemplo.com --paginas 100 --profundidad 4
 *   npm run crawl -- http://localhost:3000 --local --auditar 5
 *   npm run crawl -- https://ejemplo.com --json sitio.json
 */

export function renderAnalysis(analysis: SiteAnalysis): string {
  const { site, issues, summary } = analysis;
  const lines: string[] = [];

  lines.push("");
  lines.push(`ANÁLISIS DE SITIO — ${site.origin}`);
  lines.push("═".repeat(74));

  lines.push(
    `Rastreadas ${site.stats.fetched} URL(s) en ${Math.round(site.stats.durationMs / 1000)} s · ` +
      `${site.stats.ok} OK · ${site.stats.redirects} redirecciones · ` +
      `${site.stats.clientErrors} errores 4xx · ${site.stats.serverErrors} errores 5xx`
  );
  lines.push(
    `Parada: ${site.stats.stoppedBy}` +
      (site.stats.notFetched > 0 ? ` · ${site.stats.notFetched} descubiertas sin rastrear` : "")
  );

  lines.push("");
  lines.push("ARQUITECTURA");
  lines.push("─".repeat(74));
  for (const depth of Object.keys(site.architecture.byDepth).map(Number).sort((a, b) => a - b)) {
    const urls = site.architecture.byDepth[depth];
    lines.push(`  Nivel ${depth}: ${urls.length} página(s)`);
  }
  lines.push(`  Profundidad máxima: ${site.architecture.maxDepth}`);
  lines.push(`  Media de enlaces internos por página: ${site.architecture.averageOutboundLinks.toFixed(1)}`);
  lines.push(`  Páginas huérfanas: ${site.architecture.orphans.length}`);

  if (site.architecture.mostLinked.length > 0) {
    lines.push("");
    lines.push("  Más enlazadas:");
    for (const entry of site.architecture.mostLinked.slice(0, 5)) {
      lines.push(`    ${String(entry.inbound).padStart(3)} enlaces  ${entry.url}`);
    }
  }

  lines.push("");
  lines.push("FUENTES DE DESCUBRIMIENTO");
  lines.push("─".repeat(74));
  lines.push(`  robots.txt: ${site.robots.status}${site.robots.reason ? ` — ${site.robots.reason}` : ""}`);
  lines.push(
    `  sitemap:    ${site.sitemap.status} · ${site.sitemap.urls.length} URL(s) en ` +
      `${site.sitemap.documents.length} documento(s)${site.sitemap.reason ? ` — ${site.sitemap.reason}` : ""}`
  );

  lines.push("");
  lines.push(
    `PROBLEMAS: ${summary.total} · ${summary.critical} críticos · ${summary.serious} serios · ` +
      `${summary.moderate} moderados · ${summary.minor} menores`
  );
  lines.push("─".repeat(74));

  for (const issue of issues) {
    lines.push(`[${issue.severity}] ${issue.title}${issue.verification !== "VERIFIED" ? ` (${issue.verification})` : ""}`);
    lines.push(`   ${issue.evidence}`);
    lines.push(`   Arreglo: ${issue.fix}`);
    lines.push("");
  }

  if (analysis.audits.length > 0) {
    lines.push("AUDITORÍA W1 POR PÁGINA");
    lines.push("─".repeat(74));
    for (const entry of analysis.audits) {
      lines.push(
        `  ${String(entry.audit.overall ?? "—").padStart(3)}/100  ${entry.url}` +
          (entry.audit.overall !== null ? ` (medido el ${Math.round(entry.audit.confidence * 100)}%)` : "")
      );
      lines.push(`         ${entry.reason}`);
    }
    if (analysis.averagePageScore !== null) {
      lines.push(`  Media de la muestra: ${analysis.averagePageScore}/100`);
    }
  }

  lines.push("");
  lines.push(`QUALITY GATE DE SITIO: ${analysis.gate.passed ? "PASA" : "NO PASA"}`);
  lines.push(`  ${analysis.gate.reason}`);

  lines.push("");
  lines.push("LO QUE ESTE ANÁLISIS NO HA PODIDO ESTABLECER");
  lines.push("─".repeat(74));
  if (analysis.limitations.length === 0) {
    lines.push("  Nada: el crawl cubrió todo lo alcanzable y se auditó lo previsto.");
  }
  for (const limitation of analysis.limitations) lines.push(`  · ${limitation}`);

  lines.push("");
  return lines.join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const url = argv.find((arg) => arg.startsWith("http"));

  if (!url) {
    console.error(
      "Uso: npm run crawl -- https://ejemplo.com [--local] [--paginas N] [--profundidad N] [--auditar N] [--json salida.json]"
    );
    process.exit(1);
  }

  const numberArg = (flag: string, fallback: number): number => {
    const index = argv.indexOf(flag);
    const parsed = index >= 0 ? Number(argv[index + 1]) : NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };

  const jsonIndex = argv.indexOf("--json");
  const jsonPath = jsonIndex >= 0 ? argv[jsonIndex + 1] : null;
  const allowLocal = argv.includes("--local");

  console.log(`\nRastreando ${url}…${allowLocal ? " (loopback permitido)" : ""}`);

  const analysis = await analyzeSite(url, {
    allowLoopbackForTesting: allowLocal,
    maxPages: numberArg("--paginas", 50),
    maxDepth: numberArg("--profundidad", 5),
    auditSample: numberArg("--auditar", 3),
    skipMobile: argv.includes("--sin-movil"),
    respectRobots: !argv.includes("--ignorar-robots"),
    mobileOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : {}),
      allowLoopbackForTesting: allowLocal,
    },
    onProgress: ({ fetched, queued, current }) => {
      process.stdout.write(`\r  ${String(fetched).padStart(4)} rastreadas · ${String(queued).padStart(4)} en cola · ${current.slice(0, 60).padEnd(60)}`);
    },
  });

  process.stdout.write("\r" + " ".repeat(100) + "\r");
  console.log(renderAnalysis(analysis));

  if (jsonPath) {
    mkdirSync(resolve(jsonPath, ".."), { recursive: true });
    writeFileSync(resolve(jsonPath), JSON.stringify(analysis, null, 2), "utf8");
    console.log(`Modelo completo del sitio en ${resolve(jsonPath)}\n`);
  }

  process.exit(analysis.gate.passed ? 0 : 1);
}

if (process.argv[1]?.endsWith("crawl-site.ts")) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exit(1);
  });
}

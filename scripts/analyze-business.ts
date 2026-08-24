import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { getRepository } from "@/lib/database";
import { ensureMemoryReady } from "@/lib/memory/bootstrap";
import { flushMemory } from "@/lib/memory/research-memory";
import { analyzeBusiness } from "@/backend/opportunity/analyze-business";
import { renderRecommendation } from "@/backend/opportunity/recommend";

/**
 * "Analiza este negocio" from the command line.
 *
 *   npm run analizar -- https://negocio.com
 *   npm run analizar -- https://negocio.com --nombre "Restaurant Can Prova"
 *   npm run analizar -- http://localhost:3000 --local --una-pagina
 *   npm run analizar -- https://negocio.com --json analisis.json
 *
 * crawl → audit → diagnosis → recommendation, using the real modules.
 */

async function main() {
  const argv = process.argv.slice(2);
  const url = argv.find((arg) => arg.startsWith("http"));

  if (!url) {
    console.error(
      "Uso: npm run analizar -- https://negocio.com [--nombre \"Nombre\"] [--local] [--una-pagina] [--paginas N] [--json salida.json]"
    );
    process.exit(1);
  }

  const stringArg = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const numberArg = (flag: string, fallback: number): number => {
    const raw = stringArg(flag);
    const parsed = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  const allowLocal = argv.includes("--local");
  const jsonPath = stringArg("--json");
  const businessName = stringArg("--nombre");

  await ensureMemoryReady();
  const repository = await getRepository();
  const settings = await repository.getSettings();

  console.log(`\n╭─────────────────────────────────────────────────────────────╮`);
  console.log(`│  Análisis de negocio — ${(businessName ?? url).slice(0, 36).padEnd(36)} │`);
  console.log(`╰─────────────────────────────────────────────────────────────╯\n`);

  const analysis = await analyzeBusiness(url, {
    settings,
    businessName,
    allowLoopbackForTesting: allowLocal,
    singlePage: argv.includes("--una-pagina"),
    maxPages: numberArg("--paginas", 30),
    skipMobile: argv.includes("--sin-movil"),
    mobileOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : {}),
      allowLoopbackForTesting: allowLocal,
    },
    onProgress: (stage, detail) => console.log(`  [${stage.padEnd(9)}] ${detail}`),
  });

  await flushMemory();

  console.log("\n" + "═".repeat(74));
  if (analysis.site) {
    const stats = analysis.site.site.stats;
    console.log(
      `Sitio: ${stats.fetched} URL(s) rastreadas · ${stats.ok} OK · ` +
        `${stats.clientErrors} 4xx · ${stats.serverErrors} 5xx · ` +
        `${analysis.site.issues.length} problemas técnicos`
    );
  }
  if (analysis.audit?.overall !== null && analysis.audit) {
    console.log(
      `Auditoría de la portada: ${analysis.audit.overall}/100 ` +
        `(medido el ${Math.round(analysis.audit.confidence * 100)}% del modelo)`
    );
  }
  console.log(`Duración: ${Math.round(analysis.durationMs / 1000)} s`);
  console.log("═".repeat(74) + "\n");

  console.log(renderRecommendation(analysis.recommendation));

  if (jsonPath) {
    mkdirSync(resolve(jsonPath, ".."), { recursive: true });
    writeFileSync(resolve(jsonPath), JSON.stringify(analysis, null, 2), "utf8");
    console.log(`\nAnálisis completo en ${resolve(jsonPath)}`);
  }

  console.log("");
  // No opportunity is a valid, non-error outcome: it just means do not sell.
  process.exit(0);
}

if (process.argv[1]?.endsWith("analyze-business.ts")) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exit(1);
  });
}

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { getRepository } from "@/lib/database";
import { ensureMemoryReady } from "@/lib/memory/bootstrap";
import { flushMemory } from "@/lib/memory/research-memory";
import { CsvBusinessSourceProvider } from "@/lib/integrations/business-sources";
import { analyzePortfolio, type BatchResult, type OpportunityRecord } from "@/backend/opportunity/batch";
import { buildDemoBrief } from "@/backend/opportunity/demo-brief";

/**
 * The agency's morning command: take a list of businesses, come back with a
 * ranked list of who to call and what to say.
 *
 *   npm run prospectar -- negocios.csv
 *   npm run prospectar -- negocios.csv --local --top 3
 *   npm run prospectar -- negocios.csv --json cartera.json --briefs briefs/
 *
 * The CSV accepts the same columns as the dashboard importer: nombre/name,
 * web/website, ciudad/city, sector, telefono/phone, rating, reseñas.
 */

function bar(score: number | null): string {
  if (score === null) return "░".repeat(20) + "  sin puntuar";
  const filled = Math.round((score / 100) * 20);
  return "█".repeat(filled) + "░".repeat(20 - filled) + ` ${String(score).padStart(3)}/100`;
}

const STATUS_LABELS: Record<OpportunityRecord["status"], string> = {
  ALTA_OPORTUNIDAD: "ALTA OPORTUNIDAD",
  OPORTUNIDAD_MEDIA: "Oportunidad media",
  SIN_OPORTUNIDAD_CLARA: "Sin oportunidad clara",
  EVIDENCIA_INSUFICIENTE: "Evidencia insuficiente",
  SIN_WEB: "Sin web propia",
  NO_ANALIZADO: "No analizado",
};

function renderRanking(result: BatchResult, top: number): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("═".repeat(76));
  lines.push("CARTERA ANALIZADA");
  lines.push("═".repeat(76));
  lines.push(
    `${result.stats.total} negocios · ${result.stats.analyzed} analizados · ` +
      `${result.stats.withoutWebsite} sin web · ${result.stats.failed} fallidos`
  );
  lines.push(
    `${result.stats.highOpportunity} de alta oportunidad · ` +
      `${result.stats.noOpportunity} sin oportunidad clara · ` +
      `valor total del pipeline: ${result.stats.totalPipelineValueEur} €`
  );
  lines.push(`Duración: ${Math.round(result.durationMs / 1000)} s`);
  lines.push("");

  lines.push("RANKING");
  lines.push("─".repeat(76));
  for (const [index, record] of result.ranking.entries()) {
    lines.push(
      `#${String(index + 1).padStart(2)}  ${bar(record.opportunityScore)}  ${record.business.name}`
    );
    lines.push(
      `      ${STATUS_LABELS[record.status]} · confianza ${record.confidence} · ` +
        `evidencia ${Math.round(record.evidenceCoverage * 100)}%` +
        (record.estimatedValueEur !== null ? ` · ${record.estimatedValueEur} €` : "")
    );
  }

  const unranked = result.records.filter((record) => record.opportunityScore === null);
  if (unranked.length > 0) {
    lines.push("");
    lines.push("SIN PUNTUAR (no es lo mismo que puntuar cero)");
    lines.push("─".repeat(76));
    for (const record of unranked) {
      lines.push(`  ${record.business.name}: ${record.reasons[0]}${record.error ? ` — ${record.error}` : ""}`);
    }
  }

  // ---- The detail for the top opportunities ----------------------------
  lines.push("");
  lines.push("═".repeat(76));
  lines.push(`TOP ${Math.min(top, result.ranking.length)} — DETALLE`);
  lines.push("═".repeat(76));

  for (const [index, record] of result.ranking.slice(0, top).entries()) {
    const recommendation = record.recommendation;
    lines.push("");
    lines.push(`#${index + 1} — ${record.business.name}`);
    lines.push("─".repeat(76));
    lines.push(
      `OPORTUNIDAD: ${record.opportunityScore}/100 · CONFIANZA: ${record.confidence}` +
        (record.business.rating !== null ? ` · ${record.business.rating}★` : "") +
        (record.business.reviewCount !== null ? ` (${record.business.reviewCount} reseñas)` : "")
    );
    if (record.business.website) lines.push(`WEB: ${record.business.website}`);
    if (record.business.city) lines.push(`UBICACIÓN: ${record.business.city}`);

    lines.push("");
    lines.push("POR QUÉ:");
    for (const reason of record.reasons) lines.push(`  · ${reason}`);

    if (record.problems.length > 0) {
      lines.push("");
      lines.push("PROBLEMAS:");
      for (const problem of record.problems.slice(0, 6)) {
        lines.push(`  [${problem.severity}] ${problem.statement}`);
        lines.push(`      ${problem.evidence[0]}`);
      }
    }

    if (recommendation) {
      lines.push("");
      lines.push(`RECOMENDACIÓN: ${recommendation.headline}`);
      lines.push(`  ${recommendation.rationale}`);
      for (const service of recommendation.services) {
        lines.push(
          `  ${service.priority}. ${service.label} — ${service.priceEur !== null ? `${service.priceEur} €` : "a presupuestar"}`
        );
      }
      if (recommendation.totalEur !== null) {
        lines.push(`  VALOR ESTIMADO DEL PROYECTO: ${recommendation.totalEur} €`);
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const csvPath = argv.find((arg) => arg.endsWith(".csv"));

  if (!csvPath) {
    console.error(
      "Uso: npm run prospectar -- negocios.csv [--local] [--top N] [--una-pagina] [--json cartera.json] [--briefs carpeta/]"
    );
    console.error("");
    console.error("Columnas del CSV: nombre, web, ciudad, sector, telefono, rating, reseñas");
    process.exit(1);
  }

  const stringArg = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const top = Number(stringArg("--top") ?? 3);
  const allowLocal = argv.includes("--local");
  const jsonPath = stringArg("--json");
  const briefsDir = stringArg("--briefs");

  const csv = readFileSync(resolve(csvPath), "utf8");
  const discovery = new CsvBusinessSourceProvider().importFromText(csv);

  if (discovery.errors.length > 0) {
    console.log(`\n${discovery.errors.length} fila(s) del CSV se descartaron:`);
    for (const error of discovery.errors.slice(0, 5)) console.log(`  · ${error.message}`);
  }

  if (discovery.records.length === 0) {
    console.error("\nEl CSV no contiene ningún negocio válido.");
    process.exit(1);
  }

  await ensureMemoryReady();
  const repository = await getRepository();
  const settings = await repository.getSettings();

  console.log(`\nProcesando ${discovery.records.length} negocio(s) de ${csvPath}…\n`);

  const result = await analyzePortfolio(discovery.records, {
    settings,
    allowLoopbackForTesting: allowLocal,
    singlePage: argv.includes("--una-pagina"),
    maxPagesPerSite: Number(stringArg("--paginas") ?? 20),
    skipMobile: argv.includes("--sin-movil"),
    mobileOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : {}),
      allowLoopbackForTesting: allowLocal,
    },
    onProgress: (index, total, name, status) =>
      console.log(`  [${String(index + 1).padStart(3)}/${total}] ${name.slice(0, 44).padEnd(44)} ${status}`),
  });

  await flushMemory();
  console.log(renderRanking(result, top));

  if (jsonPath) {
    mkdirSync(resolve(jsonPath, ".."), { recursive: true });
    writeFileSync(resolve(jsonPath), JSON.stringify(result, null, 2), "utf8");
    console.log(`Cartera completa en ${resolve(jsonPath)}`);
  }

  // Briefs are only produced for the opportunities that justify one.
  if (briefsDir) {
    mkdirSync(resolve(briefsDir), { recursive: true });
    let written = 0;

    for (const record of result.ranking.slice(0, top)) {
      const brief = buildDemoBrief(record);
      const slug = record.business.name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      writeFileSync(resolve(briefsDir, `${slug}.json`), JSON.stringify(brief, null, 2), "utf8");
      written += 1;
    }

    console.log(`${written} DEMO_BRIEF escritos en ${resolve(briefsDir)}`);
  }

  console.log("");
  process.exit(0);
}

if (process.argv[1]?.endsWith("prospect.ts")) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exit(1);
  });
}

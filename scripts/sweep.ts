import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { getRepository } from "@/lib/database";
import { ensureMemoryReady } from "@/lib/memory/bootstrap";
import { flushMemory } from "@/lib/memory/research-memory";
import { COSTA_BRAVA_MUNICIPALITIES } from "@/lib/research/costa-brava";
import { estimateSweep, sweepRegion, PRIORITY_CATEGORIES, SWEEP_DEFAULTS } from "@/backend/opportunity/sweep";
import { buildDemoBrief } from "@/backend/opportunity/demo-brief";
import {
  DEFAULT_CHECKPOINT_DIR,
  FileCheckpoint,
  MemoryCheckpoint,
  type SweepCheckpoint,
} from "@/backend/opportunity/checkpoint";
import type { OpportunityRecord } from "@/backend/opportunity/batch";
import { preflight, printPreflight } from "./preflight";

/**
 * Sweeps the whole Costa Brava: discover → audit → score → rank, in one go.
 *
 *   npm run barrido
 *   npm run barrido -- --municipios Blanes,Roses --sectores Restaurantes
 *   npm run barrido -- --analizar 100 --top 10 --briefs briefs/
 *
 * Unlike `npm run cycle`, which is the unattended loop on a small budget,
 * this is the deliberate one-off sweep an operator launches to fill the
 * pipeline. It states its cost before spending anything.
 */

const STATUS_LABELS: Record<OpportunityRecord["status"], string> = {
  ALTA_OPORTUNIDAD: "ALTA OPORTUNIDAD",
  OPORTUNIDAD_MEDIA: "Oportunidad media",
  SIN_OPORTUNIDAD_CLARA: "Sin oportunidad clara",
  EVIDENCIA_INSUFICIENTE: "Evidencia insuficiente",
  SIN_WEB: "Sin web propia",
  NO_ANALIZADO: "No analizado",
};

function bar(score: number | null): string {
  if (score === null) return "░".repeat(20) + "  sin puntuar";
  const filled = Math.round((score / 100) * 20);
  return "█".repeat(filled) + "░".repeat(20 - filled) + ` ${String(score).padStart(3)}/100`;
}

async function main() {
  const argv = process.argv.slice(2);

  const stringArg = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const listArg = (flag: string): string[] =>
    (stringArg(flag) ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const numberArg = (flag: string, fallback: number): number => {
    const raw = stringArg(flag);
    const parsed = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  const municipalities = listArg("--municipios");
  const categories = listArg("--sectores").length ? listArg("--sectores") : [...PRIORITY_CATEGORIES];
  const maxAnalyzed = numberArg("--analizar", SWEEP_DEFAULTS.maxAnalyzed);
  const maxPerQuery = numberArg("--por-consulta", SWEEP_DEFAULTS.maxPerQuery);
  const top = numberArg("--top", 10);
  const briefsDir = stringArg("--briefs");
  const jsonPath = stringArg("--json");

  const municipalityCount = municipalities.length || COSTA_BRAVA_MUNICIPALITIES.length;
  const estimate = estimateSweep(municipalityCount, categories.length, maxAnalyzed);

  console.log("\n╭──────────────────────────────────────────────────────────────╮");
  console.log("│  Barrido de oportunidades — Costa Brava                      │");
  console.log("╰──────────────────────────────────────────────────────────────╯\n");
  console.log(`  Municipios:  ${municipalityCount}`);
  console.log(`  Sectores:    ${categories.length} (${categories.join(", ")})`);
  console.log(`  Consultas de descubrimiento: ~${estimate.discoveryQueries}`);
  console.log(`  Negocios a analizar a fondo: hasta ${maxAnalyzed}`);
  console.log(
    `  Duración estimada: entre ${estimate.estimatedMinutes} y ${estimate.estimatedMinutesMax} min` +
      (estimate.estimatedMinutesMax >= 60
        ? ` (hasta ${(estimate.estimatedMinutesMax / 60).toFixed(1)} h)`
        : "")
  );
  console.log(`  Coste: 0 € — las fuentes son abiertas y sin clave.\n`);

  const checkpoint: SweepCheckpoint = argv.includes("--sin-checkpoint")
    ? new MemoryCheckpoint()
    : new FileCheckpoint(stringArg("--checkpoint") ?? DEFAULT_CHECKPOINT_DIR);

  const alreadyDone = checkpoint.loadRecords().length;
  if (alreadyDone > 0) {
    console.log(
      `  Reanudando: ${alreadyDone} negocio(s) ya analizados en ${checkpoint.describe()}.\n` +
        `  Para empezar de cero, borra esa carpeta.\n`
    );
  } else {
    console.log(
      `  Progreso guardado en ${checkpoint.describe()} — si esto se interrumpe,\n` +
        `  vuelve a lanzar el mismo comando y continúa donde lo dejó.\n`
    );
  }

  // A sweep that runs against dead sources produces zero opportunities and
  // looks identical to a region with none. Check first.
  const probe = await preflight();
  printPreflight(probe);

  if (probe.reachable === 0 && !argv.includes("--force")) {
    console.log(
      "Se cancela: sin fuentes accesibles el barrido devolvería cero negocios\n" +
        "por falta de red, no por falta de negocios. Usa --force para insistir.\n"
    );
    process.exit(1);
  }

  await ensureMemoryReady();
  const repository = await getRepository();
  const settings = await repository.getSettings();

  const result = await sweepRegion({
    settings,
    checkpoint,
    municipalities,
    categories,
    maxPerQuery,
    maxAnalyzed,
    maxPagesPerSite: numberArg("--paginas", 15),
    skipMobile: argv.includes("--sin-movil"),
    mobileOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : undefined,
    onProgress: (stage, detail) => {
      process.stdout.write(`\r  [${stage}] ${detail.slice(0, 66).padEnd(66)}`);
    },
  });

  await flushMemory();
  process.stdout.write("\r" + " ".repeat(80) + "\r");

  const { batch } = result;

  console.log("\n" + "═".repeat(78));
  console.log("BARRIDO COMPLETADO");
  console.log("═".repeat(78));
  console.log(
    `Descubiertos ${result.discovered} · ${result.unique} únicos tras deduplicar · ` +
      `${result.analyzed} analizados a fondo` + (result.skipped > 0 ? ` · ${result.skipped} sin analizar` : "")
  );
  console.log(
    `${batch.stats.highOpportunity} de alta oportunidad · ${batch.stats.withoutWebsite} sin web · ` +
      `${batch.stats.noOpportunity} sin oportunidad clara · ${batch.stats.failed} fallidos`
  );
  console.log(`Valor total del pipeline: ${batch.stats.totalPipelineValueEur} €`);
  console.log(`Duración: ${Math.round(result.durationMs / 60000)} min`);
  if (result.discoveryResumed || result.resumedAnalyses > 0) {
    console.log(
      `Reanudado: ${result.discoveryResumed ? "descubrimiento reutilizado" : "descubrimiento nuevo"}` +
        `, ${result.resumedAnalyses} negocio(s) traídos de la ejecución anterior.`
    );
  }
  console.log("");

  console.log("FUENTES");
  console.log("─".repeat(78));
  for (const source of result.sources) {
    console.log(
      `  ${source.source.padEnd(16)} ${source.queries} consultas · ` +
        `${source.failures} fallos · ${source.records} negocios aprovechables`
    );
  }

  console.log("");
  console.log(`LOS ${Math.min(top, batch.ranking.length)} MÁS NECESITADOS`);
  console.log("─".repeat(78));

  for (const [index, record] of batch.ranking.slice(0, top).entries()) {
    console.log(`#${String(index + 1).padStart(2)}  ${bar(record.opportunityScore)}  ${record.business.name}`);
    console.log(
      `      ${STATUS_LABELS[record.status]} · ${record.business.city ?? "sin municipio"} · ` +
        `${record.business.sector ?? "sin sector"}` +
        (record.estimatedValueEur !== null ? ` · ${record.estimatedValueEur} €` : "")
    );
    if (record.business.website) console.log(`      ${record.business.website}`);
    if (record.business.phone) console.log(`      ${record.business.phone}`);

    const worst = record.problems[0];
    if (worst) console.log(`      → ${worst.statement}`);
    console.log("");
  }

  console.log("LO QUE ESTE BARRIDO NO ESTABLECE");
  console.log("─".repeat(78));
  for (const limitation of result.limitations) console.log(`  · ${limitation}`);
  console.log("");

  if (jsonPath) {
    mkdirSync(resolve(jsonPath, ".."), { recursive: true });
    writeFileSync(resolve(jsonPath), JSON.stringify(result, null, 2), "utf8");
    console.log(`Barrido completo en ${resolve(jsonPath)}`);
  }

  if (briefsDir) {
    mkdirSync(resolve(briefsDir), { recursive: true });
    let written = 0;
    for (const record of batch.ranking.slice(0, top)) {
      if (record.status !== "ALTA_OPORTUNIDAD") continue;
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
    console.log(`${written} DEMO_BRIEF escritos en ${resolve(briefsDir)} (solo alta oportunidad).`);
  }

  console.log("");
  process.exit(0);
}

if (process.argv[1]?.endsWith("sweep.ts")) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exit(1);
  });
}

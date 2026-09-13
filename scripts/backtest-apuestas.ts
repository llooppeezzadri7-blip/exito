#!/usr/bin/env node
/**
 * Backtest runner for the betting playbook.
 *
 *   npm run apuestas:backtest -- --download --div SP1 --seasons 2425,2324,2223
 *   npm run apuestas:backtest -- data/SP1-2425.csv data/E0-2425.csv
 *   npm run apuestas:backtest -- data/*.csv --strategy laliga_cards_over_2.5 --odds 1.32
 *
 * Data comes from football-data.co.uk, the only free source carrying results,
 * corners, cards and historical odds together. Downloads go to ./data by
 * default; --download needs outbound network access.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseSeasons } from "../lib/betting/football-data";
import { MIN_SAMPLE, summarize } from "../lib/betting/backtest";
import { findStrategy, PLAYBOOK, runStrategy, survivors, type StrategyReport } from "../lib/betting/playbook";
import { SYSTEM_BAND } from "../lib/betting/sportium";
import { oddsNeededForRoi } from "../lib/betting/backtest";

const BASE_URL = "https://www.football-data.co.uk/mmz4281";
const DATA_DIR = "data";

interface Args {
  files: string[];
  download: boolean;
  divisions: string[];
  seasons: string[];
  strategyKey: string | null;
  assumedOdds: number | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    files: [],
    download: false,
    divisions: ["SP1", "E0"],
    seasons: ["2425", "2324", "2223"],
    strategyKey: null,
    assumedOdds: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[(i += 1)];
    switch (arg) {
      case "--download": args.download = true; break;
      case "--div": args.divisions = next().split(","); break;
      case "--seasons": args.seasons = next().split(","); break;
      case "--strategy": args.strategyKey = next(); break;
      case "--odds": args.assumedOdds = Number(next()); break;
      case "--help": printHelp(); process.exit(0); break;
      default:
        if (arg.startsWith("--")) throw new Error(`Opción desconocida: ${arg}`);
        args.files.push(arg);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
Backtest del sistema de apuestas (LaLiga / Premier, orientado a Sportium).

  --download              Descarga las temporadas indicadas a ./${DATA_DIR}
  --div SP1,E0            Divisiones (SP1 = LaLiga, E0 = Premier). Por defecto: SP1,E0
  --seasons 2425,2324     Temporadas. Por defecto: 2425,2324,2223
  --strategy <clave>      Ejecuta solo una estrategia del playbook
  --odds <cuota>          Sustituye la cuota asumida de esa estrategia
  --help                  Esta ayuda

Estrategias disponibles:
${PLAYBOOK.map((s) => `  ${s.key.padEnd(32)} ${s.label}`).join("\n")}
`);
}

async function download(divisions: string[], seasons: string[]): Promise<string[]> {
  await mkdir(DATA_DIR, { recursive: true });
  const paths: string[] = [];

  for (const season of seasons) {
    for (const division of divisions) {
      const url = `${BASE_URL}/${season}/${division}.csv`;
      const target = join(DATA_DIR, `${division}-${season}.csv`);
      process.stdout.write(`Descargando ${url} ... `);
      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.log(`ERROR ${response.status}`);
          continue;
        }
        await writeFile(target, await response.text(), "utf8");
        paths.push(target);
        console.log("ok");
      } catch (error) {
        console.log(`FALLO (${error instanceof Error ? error.message : String(error)})`);
      }
    }
  }
  return paths;
}

function percent(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function reportLine(report: StrategyReport): string {
  if (report.settled === 0) return `  sin apuestas tras los filtros`;

  const flags: string[] = [];
  if (!report.sampleIsSufficient) flags.push(`muestra corta (<${MIN_SAMPLE})`);
  if (report.pricesWereAssumed) flags.push("cuota asumida");

  return [
    `  n=${String(report.settled).padStart(4)}`,
    `acierto ${percent(report.hitRate).padStart(6)}`,
    `IC95 [${percent(report.hitRate95.low)} – ${percent(report.hitRate95.high)}]`,
    `cuota ${report.averageOdds.toFixed(2)}`,
    `necesita ${report.breakEvenOdds.toFixed(2)}`,
    `ROI ${percent(report.roi).padStart(7)}`,
    flags.length ? `[${flags.join(", ")}]` : "",
  ].join("  ");
}

function printReport(reports: StrategyReport[]): void {
  console.log("\n" + "=".repeat(100));
  console.log(`PLAYBOOK · banda del sistema ${SYSTEM_BAND.min} – ${SYSTEM_BAND.max}`);
  console.log("=".repeat(100));

  for (const report of reports) {
    console.log(`\n${report.strategy.label}  (${report.strategy.key})`);
    console.log(reportLine(report));
    if (report.settled > 0) {
      console.log(`  para +5% ROI necesitarías cuota ${oddsNeededForRoi(report.hitRate, 0.05).toFixed(2)}`);
      console.log(`  racha perdedora máx ${report.longestLosingStreak} · drawdown máx ${report.maxDrawdown.toFixed(1)}u`);
    }
  }

  const passed = survivors(reports);
  console.log("\n" + "=".repeat(100));
  console.log(`SOBREVIVEN: ${passed.length} de ${reports.length}`);
  console.log("=".repeat(100));

  if (passed.length === 0) {
    console.log(
      "\nNinguna estrategia supera el punto de equilibrio en el peor caso de su intervalo.\n" +
        "Eso NO significa que no haya negocio: significa que con estos datos y estas cuotas\n" +
        "asumidas no puedes demostrarlo. Consigue cuotas reales de Sportium y repite."
    );
  } else {
    for (const report of passed) {
      console.log(`\n${report.strategy.label}`);
      console.log(`  ${report.strategy.rationale}`);
      console.log(summarize(report).split("\n").map((l) => `  ${l}`).join("\n"));
    }
  }

  console.log(
    "\nRecuerda: las cuotas marcadas como asumidas no son precios reales de Sportium.\n" +
      "Hasta que las sustituyas por precios que hayas visto de verdad, el ROI es una hipótesis."
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let files = args.files;
  if (args.download) files = [...files, ...(await download(args.divisions, args.seasons))];

  if (files.length === 0) {
    console.error("No hay ficheros. Usa --download o pasa rutas de CSV. --help para ver las opciones.");
    process.exitCode = 1;
    return;
  }

  const contents = await Promise.all(files.map((file) => readFile(file, "utf8")));
  const { matches, skipped } = parseSeasons(contents);
  console.log(
    `Cargados ${matches.length} partidos de ${files.length} fichero(s) ` +
      `(${files.map((f) => basename(f)).join(", ")}); ${skipped} filas descartadas.`
  );

  if (matches.length === 0) {
    console.error("Ningún partido utilizable. ¿Son CSV de football-data.co.uk?");
    process.exitCode = 1;
    return;
  }

  let strategies = PLAYBOOK;
  if (args.strategyKey) {
    const strategy = findStrategy(args.strategyKey);
    if (!strategy) {
      console.error(`Estrategia desconocida: ${args.strategyKey}. Usa --help para ver la lista.`);
      process.exitCode = 1;
      return;
    }
    strategies = [strategy];
  }
  if (args.assumedOdds !== null) {
    strategies = strategies.map((s) => ({ ...s, assumedOdds: args.assumedOdds ?? s.assumedOdds }));
  }

  printReport(strategies.map((strategy) => runStrategy(matches, strategy)));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

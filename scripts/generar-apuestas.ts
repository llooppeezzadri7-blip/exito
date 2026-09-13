#!/usr/bin/env node
/**
 * Generate betting recommendations and write them to disk.
 *
 *   npm run apuestas:generar
 *   npm run apuestas:generar -- --banca 100 --casa sportium --deporte soccer_spain_la_liga
 *
 * Without ODDS_API_KEY this runs on the DEMO provider and says so on every
 * line. Demo rows are written to the history file but never counted in P&L.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { generateRecommendations, RECOMMENDATIONS_PATH } from "../lib/betting/generate";
import { HISTORY_PATH, recordRecommendations } from "../lib/betting/history";
import { PROVENANCE_LABEL } from "../lib/betting/providers/types";
import { LA_LIGA } from "../lib/betting/providers";

interface Args {
  bankrollEur: number;
  bookmaker?: string;
  sport: string;
  allBands: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { bankrollEur: 100, sport: LA_LIGA, allBands: false };

  for (let i = 0; i < argv.length; i += 1) {
    const next = () => argv[(i += 1)];
    switch (argv[i]) {
      case "--banca": args.bankrollEur = Number(next()); break;
      case "--casa": args.bookmaker = next(); break;
      case "--deporte": args.sport = next(); break;
      case "--todas-las-cuotas": args.allBands = true; break;
      case "--help":
        console.log(`
Genera las apuestas recomendadas y las guarda en ${RECOMMENDATIONS_PATH}.

  --banca <euros>          Banca para calcular el stake. Por defecto: 100
  --casa <clave>           Solo una casa, por ejemplo: sportium
  --deporte <clave>        Por defecto: ${LA_LIGA}
  --todas-las-cuotas       No filtrar por la banda del sistema
`);
        process.exit(0);
    }
  }
  return args;
}

function pct(n: number, digits = 2): string {
  return `${(n * 100).toFixed(digits)}%`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const result = await generateRecommendations({
    sport: args.sport,
    bankrollEur: args.bankrollEur,
    bookmaker: args.bookmaker,
    band: args.allBands ? null : undefined,
  });

  console.log("=".repeat(88));
  console.log(`FUENTE: ${result.source}  [${PROVENANCE_LABEL[result.sourceProvenance]}]`);
  console.log(result.notice);
  console.log(result.estimateNotice);
  if (result.error) console.log(`AVISO: ${result.error}`);
  console.log("=".repeat(88));

  if (result.recommendations.length === 0) {
    console.log("\nNo hay recomendaciones.");
    console.log(`Cuotas leídas: ${result.quotesFetched}. Sin analizar: ${result.unanalysed.length}.`);
    if (result.unanalysed.length > 0) console.log(`Motivo: ${result.unanalysed[0].reason}`);
  }

  for (const rec of result.recommendations) {
    const tag = PROVENANCE_LABEL[rec.overallProvenance];
    console.log(`\n[${tag}] ${rec.event} · ${rec.market} · ${rec.selection}`);
    console.log(
      `  cuota ${rec.odds.toFixed(2)} (${rec.bookmaker}) | implícita ${pct(rec.impliedProbability, 1)} | ` +
        `estimada ${pct(rec.estimatedProbability, 1)} | valor ${pct(rec.edge)}`
    );
    console.log(
      `  stake ${rec.stakeEur.toFixed(2)} € | confianza ${rec.confidence} | ` +
        `apostable: ${rec.bettable ? "SÍ" : "NO"} | actualizada ${rec.fetchedAt}`
    );
    console.log(`  ${rec.verdict}`);
    console.log(`  probabilidad: ${rec.probabilityBasis}`);
  }

  const outputPath = join(process.cwd(), RECOMMENDATIONS_PATH);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  const { added, skipped } = await recordRecommendations(result.recommendations);

  console.log("\n" + "=".repeat(88));
  console.log(`Apuestas generadas: ${result.recommendations.length} (apostables de verdad: ${result.bettableCount})`);
  console.log(`Guardadas en: ${outputPath}`);
  console.log(`Historial: ${HISTORY_PATH} (+${added} nuevas, ${skipped} ya registradas)`);
  if (result.overallProvenance === "demo") {
    console.log("\nTODO LO DE ARRIBA ES DEMO. Conecta ODDS_API_KEY para obtener cuotas reales.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

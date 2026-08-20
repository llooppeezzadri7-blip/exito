import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { getRepository } from "@/lib/database";
import { ensureMemoryReady } from "@/lib/memory/bootstrap";
import { runAutonomousCycle } from "@/backend/planner/autonomous-cycle";
import { DEFAULT_CYCLE_BUDGET, type CycleBudget } from "@/backend/planner/next-objective";
import type { ReportedLead } from "@/backend/planner/report";
import { preflight, printPreflight } from "./preflight";

/**
 * Runs one real autonomous cycle from the command line.
 *
 * The same code path as the dashboard button and the cron endpoint — not a
 * gentler version of it. What you see here is what runs unattended.
 *
 *   npm run cycle                        # el sistema elige el objetivo
 *   npm run cycle -- --municipio Blanes  # objetivo impuesto
 *   npm run cycle -- --leads 10 --municipios 1
 *   npm run cycle -- --force             # ejecutar aunque las fuentes no respondan
 */

interface Args {
  municipalities: string[];
  sectors: string[];
  budget: CycleBudget;
  force: boolean;
  outDir: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const list = (flag: string): string[] =>
    (get(flag) ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

  const number = (flag: string, fallback: number): number => {
    const raw = get(flag);
    const parsed = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    municipalities: list("--municipio").concat(list("--municipios")),
    sectors: list("--sector").concat(list("--sectores")),
    budget: {
      municipalitiesPerCycle: number("--objetivos", DEFAULT_CYCLE_BUDGET.municipalitiesPerCycle),
      maxLeads: number("--leads", DEFAULT_CYCLE_BUDGET.maxLeads),
      maxDurationMs: number("--minutos", DEFAULT_CYCLE_BUDGET.maxDurationMs / 60000) * 60000,
    },
    force: argv.includes("--force"),
    outDir: get("--salida") ?? "informes",
  };
}

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * CSV of the reported leads. Deliberately not `toCsv` from the research
 * export: that one takes a whole run record, and the cycle hands back a
 * report. Same data, different shape.
 */
function leadsToCsv(leads: ReportedLead[]): string {
  const columns: { header: string; get: (lead: ReportedLead) => string | number | null }[] = [
    { header: "Puesto", get: (l) => l.rank },
    { header: "Negocio", get: (l) => l.name },
    { header: "Municipio", get: (l) => l.city },
    { header: "Sector", get: (l) => l.sector },
    { header: "Puntuación", get: (l) => l.score },
    { header: "Evidencia", get: (l) => `${Math.round(l.confidence * 100)}%` },
    { header: "Tier", get: (l) => l.tier },
    { header: "Identidad", get: (l) => l.verificationStatus },
    { header: "Web", get: (l) => l.contact.website },
    { header: "Por qué puntúa así", get: (l) => l.whyItRanks },
    { header: "Hallazgo principal", get: (l) => l.mainFinding },
    { header: "Servicio recomendado", get: (l) => l.recommendedService },
    { header: "Motivo de la recomendación", get: (l) => l.recommendationReason },
    { header: "Pendiente de comprobar", get: (l) => l.openQuestions.join(" | ") },
  ];

  return [
    columns.map((c) => c.header).join(","),
    ...leads.map((lead) => columns.map((c) => csvCell(c.get(lead))).join(",")),
  ].join("\n");
}

function bar(label: string, current: number, total: number): string {
  const width = 24;
  const filled = total > 0 ? Math.round((current / total) * width) : 0;
  return `${label.padEnd(24)} [${"█".repeat(filled)}${"░".repeat(width - filled)}] ${current}/${total}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log("\n╭─────────────────────────────────────────────────────────╮");
  console.log("│  Ciclo autónomo de prospección — Costa Brava            │");
  console.log("╰─────────────────────────────────────────────────────────╯");

  // 1. Are the sources actually reachable?
  const probe = await preflight();
  printPreflight(probe);

  if (probe.reachable === 0 && !args.force) {
    console.log(
      "Se cancela el ciclo: sin fuentes accesibles el resultado serían cero\n" +
        "leads por falta de red, indistinguible de cero leads por falta de\n" +
        "negocios. Usa --force si quieres ejecutarlo igualmente.\n"
    );
    process.exit(1);
  }

  // 2. Memory: without this the cycle "learns" from an empty log every time.
  const memory = await ensureMemoryReady();
  console.log(`Memoria: ${memory.reason}`);
  if (!memory.persistent) {
    console.log("  ⚠ Lo aprendido en este ciclo NO sobrevivirá al proceso. Ver AUTONOMY.md.");
  }

  console.log(
    `\nPresupuesto: ${args.budget.municipalitiesPerCycle} objetivo(s), ` +
      `${args.budget.maxLeads} leads, ${Math.round(args.budget.maxDurationMs / 60000)} min.\n`
  );

  const repository = await getRepository();
  let lastLine = "";

  const record = await runAutonomousCycle({
    repository,
    trigger: "manual",
    budget: args.budget,
    explicit: args.municipalities.length
      ? {
          statement: `Investigar ${args.municipalities.join(", ")} por indicación manual.`,
          municipalities: args.municipalities,
          ...(args.sectors.length ? { sectors: args.sectors } : {}),
        }
      : undefined,
    onProgress: (progress) => {
      if (progress.phase === "PLANNING") {
        console.log("Planificando…");
        return;
      }
      if (progress.phase === "RESEARCHING" && progress.currentTarget) {
        const step = progress.steps.find((s) => s.status === "RUNNING");
        const line = step
          ? `  ${progress.currentTarget}: ${bar(step.label, step.current, step.total)}`
          : `  ${progress.currentTarget}: preparando…`;
        if (line !== lastLine) {
          console.log(line);
          lastLine = line;
        }
      }
    },
  });

  // 3. What it decided, and why.
  console.log("\n╭─ Objetivo elegido ──────────────────────────────────────╮");
  console.log(`  Modo:   ${record.selectionMode}`);
  console.log(`  Qué:    ${record.goal.statement}`);
  console.log(`  Por qué: ${record.selectionReason}`);
  console.log(`  Muestra: ${record.sampleSize === 0 ? "ninguna todavía" : `${record.sampleSize} observaciones`}`);

  const applied = record.adjustmentsApplied.filter((a) => a.applied);
  const refused = record.adjustmentsApplied.filter((a) => !a.applied);
  if (applied.length) {
    console.log("\n  Ajustes aplicados automáticamente:");
    for (const adjustment of applied) {
      console.log(`    · ${adjustment.effect} (n=${adjustment.sampleSize})`);
    }
  }
  if (refused.length) {
    console.log("\n  Ajustes NO aplicados:");
    for (const adjustment of refused) {
      console.log(`    · ${adjustment.effect} — ${adjustment.reason}`);
    }
  }

  console.log("\n╭─ Resultado ─────────────────────────────────────────────╮");
  console.log(`  Estado:    ${record.status}`);
  console.log(
    `  Objetivos: ${record.targetsExecuted} de ${record.targetsPlanned}` +
      (record.targetsInPlan > record.targetsPlanned
        ? ` (el plan tenía ${record.targetsInPlan}; el presupuesto del ciclo permitía ${record.targetsPlanned})`
        : "")
  );
  console.log(`  Negocios:  ${record.businessesAnalyzed} analizados`);
  console.log(`  Leads:     ${record.leadsProduced}`);
  console.log(`  Duración:  ${Math.round(record.durationMs / 1000)} s`);
  console.log(`  Fin:       ${record.stoppedBecause}`);
  if (record.error) console.log(`  Error:     ${record.error}`);

  if (record.report) {
    console.log("\n" + record.report.text);

    mkdirSync(resolve(args.outDir), { recursive: true });
    const stamp = record.startedAt.replace(/[:.]/g, "-");
    const reportPath = resolve(args.outDir, `informe-${stamp}.txt`);
    writeFileSync(reportPath, record.report.text, "utf8");
    console.log(`Informe guardado en ${reportPath}`);

    if (record.report.topLeads.length > 0) {
      const csvPath = resolve(args.outDir, `leads-${stamp}.csv`);
      writeFileSync(csvPath, leadsToCsv(record.report.topLeads), "utf8");
      console.log(`Leads guardados en ${csvPath}`);
    }
  }

  console.log(
    "\nPara que el sistema aprenda de esto, marca el desenlace real de cada lead\n" +
      "(Cliente / Perdido / No interesado) en /dashboard/pipeline.\n"
  );

  process.exit(record.status === "COMPLETED" ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("\nEl ciclo falló de forma inesperada:");
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { auditWebsite } from "@/backend/audit/audit-website";
import { DIMENSION_WEIGHTS } from "@/backend/audit/types";
import type { WebAuditResult } from "@/backend/audit/types";

/**
 * Audits a real website from the command line (§30, §31, §39).
 *
 *   npm run audit -- https://ejemplo.com
 *   npm run audit -- https://ejemplo.com --sin-movil
 *   npm run audit -- https://ejemplo.com --json auditoria.json
 */

function bar(score: number | null): string {
  if (score === null) return "─".repeat(20) + "  sin medir";
  const filled = Math.round((score / 100) * 20);
  return "█".repeat(filled) + "░".repeat(20 - filled) + `  ${String(score).padStart(3)}/100`;
}

export function renderAudit(audit: WebAuditResult): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(`AUDITORÍA — ${audit.finalUrl}`);
  lines.push("═".repeat(72));

  if (audit.overall === null) {
    lines.push(audit.gate.reason);
    lines.push("");
    for (const limitation of audit.limitations) lines.push(`  · ${limitation}`);
    return lines.join("\n");
  }

  lines.push(
    `PUNTUACIÓN GLOBAL: ${audit.overall}/100   ` +
      `(medido el ${Math.round(audit.confidence * 100)}% del modelo)`
  );
  lines.push("");

  for (const dimension of audit.dimensions) {
    const peso = String(DIMENSION_WEIGHTS[dimension.key]).padStart(2);
    lines.push(
      `  ${dimension.label.padEnd(22)} ${bar(dimension.score)}   peso ${peso}%` +
        (dimension.notEvaluable > 0 ? `  · ${dimension.notEvaluable} sin medir` : "")
    );
  }

  lines.push("");
  lines.push("─".repeat(72));
  lines.push(`QUALITY GATE: ${audit.gate.passed ? "PASA" : "NO PASA"}`);
  lines.push(`  ${audit.gate.reason}`);

  if (audit.priorities.length > 0) {
    lines.push("");
    lines.push("QUÉ ARREGLAR, POR ORDEN");
    lines.push("─".repeat(72));
    for (const [index, check] of audit.priorities.slice(0, 15).entries()) {
      lines.push(`${String(index + 1).padStart(2)}. [${check.severity}] ${check.label}`);
      lines.push(`    Observado: ${check.evidence}`);
      if (check.fix) lines.push(`    Arreglo:   ${check.fix}`);
      if (check.reference) lines.push(`    Ref:       ${check.reference}`);
    }
    if (audit.priorities.length > 15) {
      lines.push(`    … y ${audit.priorities.length - 15} más.`);
    }
  }

  lines.push("");
  lines.push("LO QUE ESTA AUDITORÍA NO HA PODIDO COMPROBAR");
  lines.push("─".repeat(72));
  for (const limitation of audit.limitations) lines.push(`  · ${limitation}`);

  const unmeasured = audit.dimensions.flatMap((d) => d.checks).filter((c) => c.status === "NO_EVALUABLE");
  for (const check of unmeasured) {
    lines.push(`  · ${check.label}: ${check.missing}`);
  }

  lines.push("");
  return lines.join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const url = argv.find((arg) => arg.startsWith("http"));

  if (!url) {
    console.error(
      "Uso: npm run audit -- https://ejemplo.com [--local] [--sin-movil] [--json salida.json]"
    );
    process.exit(1);
  }

  const jsonIndex = argv.indexOf("--json");
  const jsonPath = jsonIndex >= 0 ? argv[jsonIndex + 1] : null;

  // Auditing your own dev server is a legitimate use — it is what you do
  // before shipping — but it has to be asked for. Left on by default it
  // would turn this into an SSRF tool pointed at whatever is on localhost.
  const allowLocal = argv.includes("--local");

  console.log(`\nAuditando ${url}…${allowLocal ? " (loopback permitido)" : ""}`);

  const audit = await auditWebsite(url, {
    allowLoopbackForTesting: allowLocal,
    skipMobile: argv.includes("--sin-movil"),
    mobileOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : {}),
      allowLoopbackForTesting: allowLocal,
    },
  });

  console.log(renderAudit(audit));

  if (jsonPath) {
    mkdirSync(resolve(jsonPath, ".."), { recursive: true });
    writeFileSync(resolve(jsonPath), JSON.stringify(audit, null, 2), "utf8");
    console.log(`Auditoría completa en ${resolve(jsonPath)}\n`);
  }

  // A failed gate is a non-zero exit, so this can be wired into CI.
  process.exit(audit.gate.passed ? 0 : 1);
}

if (process.argv[1]?.endsWith("audit-site.ts")) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exit(1);
  });
}

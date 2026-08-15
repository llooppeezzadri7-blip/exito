import type { ResearchRunRecord, ResearchResultItem } from "./types";

/**
 * Result export (brief §11). Evidence and sources travel with the data —
 * an export that drops them would turn traceable findings into unsourced
 * assertions the moment they leave the app.
 */

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CSV_COLUMNS: { header: string; get: (item: ResearchResultItem) => unknown }[] = [
  { header: "negocio", get: (i) => i.name },
  { header: "localidad", get: (i) => i.city },
  { header: "sector", get: (i) => i.sector },
  { header: "puntuacion", get: (i) => i.score },
  { header: "confianza_pct", get: (i) => Math.round(i.confidence * 100) },
  { header: "nivel", get: (i) => i.tier },
  { header: "problema_principal", get: (i) => i.primaryProblem },
  { header: "servicio_recomendado", get: (i) => i.recommendedService },
  { header: "motivo_recomendacion", get: (i) => i.recommendationReason },
  { header: "web_estado", get: (i) => i.websiteResolution?.status ?? "NO_ANALIZADO" },
  { header: "web_url", get: (i) => i.websiteResolution?.url },
  { header: "competidores_usados", get: (i) => i.competitors.length },
  { header: "competencia_verificada", get: (i) => (i.competitorsVerified ? "SI" : "NO") },
  { header: "segunda_investigacion", get: (i) => (i.secondResearch?.performed ? "SI" : "NO") },
  { header: "correcciones", get: (i) => i.secondResearch?.corrected.join(" | ") },
  { header: "fases_fallidas", get: (i) => i.failedPhases.join(" | ") },
  {
    header: "factores",
    get: (i) => i.factors.map((f) => `${f.key}=${f.points}/${f.max} (${f.status})`).join(" | "),
  },
  {
    header: "evidencias",
    get: (i) => i.evidence.map((e) => `[${e.kind}/${e.status}] ${e.statement}`).join(" | "),
  },
  {
    header: "fuentes",
    get: (i) =>
      [...new Set(i.evidence.map((e) => e.sourceUrl ?? e.source))].join(" | "),
  },
];

export function toCsv(run: ResearchRunRecord): string {
  const header = CSV_COLUMNS.map((c) => c.header).join(",");
  const rows = run.results.map((item) =>
    CSV_COLUMNS.map((column) => csvCell(column.get(item))).join(",")
  );
  return [header, ...rows].join("\n");
}

export function toJson(run: ResearchRunRecord): string {
  return JSON.stringify(
    {
      investigacion: {
        id: run.id,
        configuracion: run.config,
        estado: run.status,
        iniciada: run.startedAt,
        finalizada: run.finishedAt,
      },
      // Every result keeps its factors, evidence and sources verbatim.
      resultados: run.results,
      incidencias: run.issues,
      pasos: run.steps,
    },
    null,
    2
  );
}

export function exportFilename(run: ResearchRunRecord, extension: "csv" | "json"): string {
  const municipality = run.config.municipality.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const date = run.startedAt.slice(0, 10);
  return `investigacion-${municipality}-${date}.${extension}`;
}

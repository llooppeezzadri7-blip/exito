import type { RawBusinessRecord } from "@/lib/integrations/business-sources/types";
import { COSTA_BRAVA_MUNICIPALITIES } from "@/lib/research/costa-brava";
import { discoverBusinesses, usesTourismRegister } from "@/backend/research/discovery";
import { dedupeBatch } from "@/lib/research/dedupe";
import { recordSourceQuery } from "@/lib/memory/research-memory";
import { analyzePortfolio, type BatchOptions, type BatchResult } from "./batch";

/**
 * "Busca oportunidades en toda la Costa Brava" — discovery across the whole
 * region, then the full analysis chain, then one consolidated ranking.
 *
 * The autonomous cycle already does this for three municipalities at a time,
 * on a budget, because it is designed to run unattended forever. This is the
 * other mode: a deliberate, operator-launched sweep of everything, run once,
 * to fill the pipeline.
 *
 * The ceilings are still real — a sweep of seventy municipalities across six
 * sectors is thousands of requests, and hitting a free public API that hard is
 * how an IP gets banned. So the caller states a budget and it is enforced
 * here, with whatever was skipped reported rather than silently dropped.
 */

export interface SweepOptions extends Omit<BatchOptions, "onProgress"> {
  /** Municipalities to sweep. Defaults to every configured one. */
  municipalities?: string[];
  /** Subsectors to look for, as OpenStreetMap-backed categories. */
  categories: string[];
  /** Hard ceiling on businesses discovered per municipality+category pair. */
  maxPerQuery?: number;
  /** Hard ceiling on how many businesses get the full website analysis. */
  maxAnalyzed?: number;
  /** Pause between discovery queries, to stay welcome on a free API. */
  delayMs?: number;
  onProgress?: (stage: "DISCOVER" | "ANALYZE", detail: string) => void;
}

export interface SweepResult {
  discovered: number;
  unique: number;
  analyzed: number;
  /** Businesses found but not analysed because the ceiling was reached. */
  skipped: number;
  /** Per-source outcome, so a dead source is visible rather than inferred. */
  sources: { source: string; queries: number; failures: number; records: number }[];
  /** Municipality + category pairs that returned nothing at all. */
  emptyQueries: string[];
  batch: BatchResult;
  durationMs: number;
  limitations: string[];
}

export const SWEEP_DEFAULTS = {
  maxPerQuery: 20,
  maxAnalyzed: 60,
  delayMs: 1200,
} as const;

/**
 * Sectors worth sweeping first for a local-business agency: high value per
 * customer, and a website that actually changes whether the phone rings.
 * Every one of these has an OpenStreetMap category behind it — a sector the
 * sources cannot find is a sector we cannot sweep.
 */
export const PRIORITY_CATEGORIES = [
  "Restaurantes",
  "Hoteles",
  "Clínicas dentales",
  "Peluquerías y barberías",
  "Talleres",
  "Gimnasios",
  "Inmobiliarias",
] as const;

export async function sweepRegion(options: SweepOptions): Promise<SweepResult> {
  const startedAt = Date.now();
  const maxPerQuery = options.maxPerQuery ?? SWEEP_DEFAULTS.maxPerQuery;
  const maxAnalyzed = options.maxAnalyzed ?? SWEEP_DEFAULTS.maxAnalyzed;
  const delayMs = options.delayMs ?? SWEEP_DEFAULTS.delayMs;
  const limitations: string[] = [];

  const municipalities = options.municipalities?.length
    ? COSTA_BRAVA_MUNICIPALITIES.filter((m) => options.municipalities!.includes(m.name)).map((m) => m.name)
    : COSTA_BRAVA_MUNICIPALITIES.map((m) => m.name);

  const discovered: RawBusinessRecord[] = [];
  const sourceStats = new Map<string, { queries: number; failures: number; records: number }>();
  const emptyQueries: string[] = [];
  let first = true;

  for (const municipality of municipalities) {
    for (const category of options.categories) {
      if (!first && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      first = false;

      options.onProgress?.("DISCOVER", `${category} en ${municipality}`);

      try {
        const result = await discoverBusinesses({
          municipality,
          category,
          maxResults: maxPerQuery,
          includeTourismRegister: usesTourismRegister(category),
        });

        for (const report of result.reports) {
          const stats = sourceStats.get(report.source) ?? { queries: 0, failures: 0, records: 0 };
          stats.queries += 1;
          if (!report.ok) stats.failures += 1;
          stats.records += report.usable;
          sourceStats.set(report.source, stats);

          // The same memory the learning engine reads, so a real sweep
          // teaches the planner which municipalities actually produce.
          recordSourceQuery(
            {
              source: report.source as never,
              municipality,
              sector: null,
              category,
              returned: report.records,
              usable: report.usable,
              ok: report.ok,
              durationMs: report.durationMs,
              error: report.error,
            },
            { runId: null }
          );
        }

        const records = result.businesses.map((entry) => ({
          ...entry.record,
          sector: entry.record.sector ?? category,
          city: entry.record.city ?? municipality,
        }));

        if (records.length === 0) emptyQueries.push(`${category} en ${municipality}`);
        discovered.push(...records);
      } catch (err) {
        // One failed query must not end a sweep of seventy municipalities.
        emptyQueries.push(
          `${category} en ${municipality} (falló: ${err instanceof Error ? err.message : "error"})`
        );
      }
    }
  }

  // Deduplicate across the whole region: the same business found under two
  // categories, or straddling a municipal boundary, is still one business.
  const { unique } = dedupeBatch(
    discovered.map((record) => ({
      ...record,
      phone: record.phone ?? null,
      website_url: record.website_url ?? null,
      address: record.address ?? null,
      city: record.city ?? null,
      gbp_place_id: record.gbp_place_id ?? null,
    }))
  );

  const toAnalyze = unique.slice(0, maxAnalyzed) as RawBusinessRecord[];
  const skipped = unique.length - toAnalyze.length;

  if (skipped > 0) {
    limitations.push(
      `Se descubrieron ${unique.length} negocios únicos y se analizaron ${toAnalyze.length}: el resto quedó fuera del techo de ${maxAnalyzed}. No están descartados, solo sin analizar.`
    );
  }

  if (emptyQueries.length > 0) {
    limitations.push(
      `${emptyQueries.length} combinación(es) de municipio y sector no devolvieron nada. Puede ser que no haya ese tipo de negocio mapeado ahí, no que no exista.`
    );
  }

  options.onProgress?.("ANALYZE", `${toAnalyze.length} negocios únicos`);

  const batch = await analyzePortfolio(toAnalyze, {
    ...options,
    onProgress: (index, total, name, status) =>
      options.onProgress?.("ANALYZE", `[${index + 1}/${total}] ${name} — ${status}`),
  });

  return {
    discovered: discovered.length,
    unique: unique.length,
    analyzed: toAnalyze.length,
    skipped,
    sources: [...sourceStats.entries()].map(([source, stats]) => ({ source, ...stats })),
    emptyQueries,
    batch,
    durationMs: Date.now() - startedAt,
    limitations,
  };
}

/** Rough request count, so an operator can see the cost before launching. */
export function estimateSweep(
  municipalities: number,
  categories: number,
  maxAnalyzed: number
): { discoveryQueries: number; siteRequests: number; estimatedMinutes: number } {
  const discoveryQueries = municipalities * categories;
  // Each analysed business gets a crawl (up to ~20 pages) plus one audit.
  const siteRequests = maxAnalyzed * 22;
  const estimatedMinutes = Math.ceil((discoveryQueries * 2 + maxAnalyzed * 8) / 60);

  return { discoveryQueries, siteRequests, estimatedMinutes };
}

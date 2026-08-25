import type { RawBusinessRecord } from "@/lib/integrations/business-sources/types";
import { COSTA_BRAVA_MUNICIPALITIES } from "@/lib/research/costa-brava";
import { discoverBusinesses, usesTourismRegister } from "@/backend/research/discovery";
import { dedupeBatch } from "@/lib/research/dedupe";
import { recordSourceQuery, flushMemory } from "@/lib/memory/research-memory";
import { analyzePortfolio, type BatchOptions, type BatchResult } from "./batch";
import {
  businessKey,
  discoveryScope,
  type DiscoverySnapshot,
  type SweepCheckpoint,
} from "./checkpoint";

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
  /**
   * Where partial progress is written. With one attached, a sweep killed
   * halfway keeps its discovery and every business it had already analysed,
   * and a relaunch continues from there instead of starting over.
   */
  checkpoint?: SweepCheckpoint;
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
  /** True when discovery came from a checkpoint rather than the live sources. */
  discoveryResumed: boolean;
  /** Businesses carried over from an interrupted run rather than re-analysed. */
  resumedAnalyses: number;
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

  const scope = discoveryScope({ municipalities, categories: options.categories, maxPerQuery });
  const cached = options.checkpoint?.loadDiscovery(scope) ?? null;

  const discovered: RawBusinessRecord[] = [];
  const sourceStats = new Map<string, { queries: number; failures: number; records: number }>();
  const emptyQueries: string[] = [];
  let first = true;
  let queriesRun = 0;

  for (const municipality of cached ? [] : municipalities) {
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

        // What the sources produced is written down every so often rather
        // than only at the end: a sweep that dies at query four hundred
        // should still have taught the planner what the first four hundred
        // found.
        queriesRun += 1;
        if (queriesRun % 25 === 0) await flushMemory();
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
  const snapshot: DiscoverySnapshot = cached ?? {
    discovered: discovered.length,
    unique: dedupeBatch(
      discovered.map((record) => ({
        ...record,
        phone: record.phone ?? null,
        website_url: record.website_url ?? null,
        address: record.address ?? null,
        city: record.city ?? null,
        gbp_place_id: record.gbp_place_id ?? null,
      }))
    ).unique as RawBusinessRecord[],
    sources: [...sourceStats.entries()].map(([source, stats]) => ({ source, ...stats })),
    emptyQueries,
  };

  if (!cached) {
    // Saved before a single site is crawled: discovery is the rate-limited
    // half, and losing it means five hundred more requests to a free API.
    options.checkpoint?.saveDiscovery(scope, snapshot);
    await flushMemory();
  } else {
    limitations.push(
      `El descubrimiento se reutilizó de una ejecución anterior (${snapshot.unique.length} negocios únicos). ` +
        "Las cifras de fuentes son las de aquella ejecución, no se volvieron a consultar."
    );
  }

  const unique = snapshot.unique;
  const toAnalyze = unique.slice(0, maxAnalyzed);
  const skipped = unique.length - toAnalyze.length;

  if (skipped > 0) {
    limitations.push(
      `Se descubrieron ${unique.length} negocios únicos y se analizaron ${toAnalyze.length}: el resto quedó fuera del techo de ${maxAnalyzed}. No están descartados, solo sin analizar.`
    );
  }

  if (snapshot.emptyQueries.length > 0) {
    limitations.push(
      `${snapshot.emptyQueries.length} combinación(es) de municipio y sector no devolvieron nada. Puede ser que no haya ese tipo de negocio mapeado ahí, no que no exista.`
    );
  }

  const previous = options.checkpoint?.loadRecords() ?? [];

  // Only the ones actually in this run's shortlist get reused. Reporting the
  // whole checkpoint as "reused" would overstate it whenever the shortlist
  // changed between runs.
  const shortlist = new Set(
    toAnalyze.map((record) =>
      businessKey({ name: record.name, website: record.website_url, city: record.city })
    )
  );
  const resumedAnalyses = previous.filter((record) =>
    shortlist.has(businessKey(record.business))
  ).length;

  if (resumedAnalyses > 0) {
    limitations.push(
      `${resumedAnalyses} negocio(s) se reutilizaron de una ejecución interrumpida y no se volvieron a visitar.`
    );
  }

  options.onProgress?.("ANALYZE", `${toAnalyze.length} negocios únicos`);

  const batch = await analyzePortfolio(toAnalyze, {
    ...options,
    previous,
    onRecord: (record) => options.checkpoint?.appendRecord(record),
    onProgress: (index, total, name, status) =>
      options.onProgress?.("ANALYZE", `[${index + 1}/${total}] ${name} — ${status}`),
  });

  return {
    discovered: snapshot.discovered,
    unique: unique.length,
    analyzed: toAnalyze.length,
    skipped,
    sources: snapshot.sources,
    emptyQueries: snapshot.emptyQueries,
    discoveryResumed: cached !== null,
    resumedAnalyses,
    batch,
    durationMs: Date.now() - startedAt,
    limitations,
  };
}

/**
 * Rough cost, so an operator can see it before launching.
 *
 * The first version of this quoted "~30 min" for a full sweep that would in
 * practice have taken hours, because it costed an analysed business at eight
 * seconds. A fifteen-page crawl plus a Chromium launch is nowhere near eight
 * seconds. An estimate that optimistic is worse than none: it is what makes
 * someone leave a two-hour job unattended in a terminal they then close.
 *
 * So the numbers below are measured-order-of-magnitude, and the answer is a
 * range rather than a single figure it cannot honestly promise.
 */
const COST_SECONDS = {
  /** Overpass response plus the courtesy pause between queries. */
  discoveryQueryFast: 3,
  discoveryQuerySlow: 8,
  /** A multi-page crawl, nine audit dimensions, and a real browser. */
  businessFast: 20,
  businessSlow: 70,
} as const;

export function estimateSweep(
  municipalities: number,
  categories: number,
  maxAnalyzed: number,
  delayMs: number = SWEEP_DEFAULTS.delayMs
): {
  discoveryQueries: number;
  siteRequests: number;
  estimatedMinutes: number;
  estimatedMinutesMax: number;
} {
  const discoveryQueries = municipalities * categories;
  // Each analysed business gets a crawl (up to ~20 pages) plus one audit.
  const siteRequests = maxAnalyzed * 22;

  const pause = (delayMs / 1000) * discoveryQueries;
  const fast = discoveryQueries * COST_SECONDS.discoveryQueryFast + pause + maxAnalyzed * COST_SECONDS.businessFast;
  const slow = discoveryQueries * COST_SECONDS.discoveryQuerySlow + pause + maxAnalyzed * COST_SECONDS.businessSlow;

  return {
    discoveryQueries,
    siteRequests,
    estimatedMinutes: Math.ceil(fast / 60),
    estimatedMinutesMax: Math.ceil(slow / 60),
  };
}

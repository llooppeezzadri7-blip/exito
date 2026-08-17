import { OverpassBusinessSourceProvider } from "@/lib/integrations/business-sources/overpass-provider";
import { TurismeCatBusinessSourceProvider } from "@/lib/integrations/business-sources/turisme-cat-provider";
import type { DiscoveryResult, RawBusinessRecord } from "@/lib/integrations/business-sources/types";
import { corroborate, type CorroboratedBusiness } from "@/lib/research/corroboration";

/**
 * Multi-source discovery.
 *
 * Replaces the single paid provider with several free, keyless ones, and
 * routes everything through corroboration so that a business reported by one
 * source alone is PROBABLE rather than fact.
 *
 * Every source is optional at runtime: if one is down, the sweep continues
 * with the rest and says which one failed. Losing a source lowers
 * corroboration — it does not stop discovery.
 */

export interface DiscoverySourceReport {
  source: string;
  ok: boolean;
  records: number;
  /** Records that survived corroboration — the number that actually matters. */
  usable: number;
  error: string | null;
  costUsd: number;
  durationMs: number;
}

export interface AutonomousDiscoveryResult {
  businesses: CorroboratedBusiness[];
  reports: DiscoverySourceReport[];
  errors: DiscoveryResult["errors"];
  summary: Record<"VERIFICADO" | "PROBABLE" | "NO_VERIFICADO", number>;
}

export interface AutonomousDiscoveryOptions {
  municipality: string;
  /** Subsector name; decides which OSM tags are queried. */
  category?: string;
  maxResults?: number;
  overpass?: Pick<OverpassBusinessSourceProvider, "search">;
  turismeCat?: Pick<TurismeCatBusinessSourceProvider, "search">;
  /** Sectors for which the tourism register is relevant. */
  includeTourismRegister?: boolean;
}

export async function discoverBusinesses(
  options: AutonomousDiscoveryOptions
): Promise<AutonomousDiscoveryResult> {
  const reports: DiscoverySourceReport[] = [];
  const errors: DiscoveryResult["errors"] = [];
  const all: RawBusinessRecord[] = [];

  const overpass = options.overpass ?? new OverpassBusinessSourceProvider();
  const turismeCat = options.turismeCat ?? new TurismeCatBusinessSourceProvider();
  const maxResults = options.maxResults ?? 50;

  // --- OpenStreetMap ---
  if (options.category) {
    const startedAt = Date.now();
    try {
      const result = await overpass.search({
        municipality: options.municipality,
        category: options.category,
        maxResults,
      });
      all.push(...result.records);
      errors.push(...result.errors);
      reports.push({
        source: "openstreetmap",
        ok: true,
        records: result.records.length,
        usable: 0,
        error: null,
        costUsd: 0,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      reports.push({
        source: "openstreetmap",
        ok: false,
        records: 0,
        usable: 0,
        error: err instanceof Error ? err.message : "Overpass no respondió",
        costUsd: 0,
        durationMs: Date.now() - startedAt,
      });
    }
  } else {
    reports.push({
      source: "openstreetmap",
      ok: false,
      records: 0,
      usable: 0,
      error: "Sin subsector no se puede elegir la etiqueta OSM: no se consulta en vez de adivinar.",
      costUsd: 0,
      durationMs: 0,
    });
  }

  // --- Registre de Turisme de Catalunya ---
  // Only accommodation is in this register; querying it for a hairdresser
  // would return nothing and imply an absence that means nothing.
  if (options.includeTourismRegister) {
    const startedAt = Date.now();
    try {
      const result = await turismeCat.search({
        municipality: options.municipality,
        maxResults,
      });
      all.push(...result.records);
      errors.push(...result.errors);
      reports.push({
        source: "turisme_cat",
        ok: true,
        records: result.records.length,
        usable: 0,
        error: null,
        costUsd: 0,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      reports.push({
        source: "turisme_cat",
        ok: false,
        records: 0,
        usable: 0,
        error: err instanceof Error ? err.message : "El registro de turismo no respondió",
        costUsd: 0,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  const { businesses, summary } = corroborate(all);

  // Attribute the corroborated survivors back to the sources that found them,
  // so learning measures usable yield rather than raw volume.
  for (const report of reports) {
    report.usable = businesses.filter((entry) =>
      entry.sources.includes(report.source as never)
    ).length;
  }

  return { businesses, reports, errors, summary };
}

/** Sectors whose businesses appear in the Catalan tourism register. */
export function usesTourismRegister(sector: string | undefined): boolean {
  return sector === "Turismo";
}

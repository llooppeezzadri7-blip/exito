import type { DiscoveryResult, RawBusinessRecord } from "./types";

/**
 * OpenStreetMap business discovery through the Overpass API.
 *
 * Free, keyless, and permitted for commercial use under ODbL with
 * attribution. This is the backbone that replaced Google Places: it answers
 * "which businesses exist in this municipality" without a paid API.
 *
 * Endpoint (public instance):
 *   POST https://overpass-api.de/api/interpreter  body: data=<Overpass QL>
 *
 * Usage policy: the public instances shed load rather than hard-blocking, but
 * they are a shared free resource. Hence the deliberate rate limiting, the
 * bounded result count, and the single query per municipality+category.
 *
 * Coverage caveat, stated rather than hidden: OSM is community-mapped, so
 * hospitality and retail are well covered on the Costa Brava while
 * professional services are patchier. A business absent from OSM is not
 * evidence that it does not exist.
 */

export const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

/**
 * Exported so the health check sends exactly what the real requests send.
 * Overpass answers 406 to a request without it, which made the preflight
 * report the source as down while the actual scraping worked fine — a health
 * check stricter than the code it is checking is worse than none.
 */
export const DISCOVERY_USER_AGENT =
  "AI-Digital-Agency-OS/1.0 (prospecting research; contact via repository)";
const DEFAULT_TIMEOUT_MS = 60_000;
const OVERPASS_QUERY_TIMEOUT_S = 45;
const MAX_RETRIES = 2;

/** Maps our subsectors to the OSM tags that actually describe them. */
export interface OsmCategory {
  /** Overpass filter fragments, e.g. '["amenity"="restaurant"]'. */
  filters: string[];
  sector: string;
  subsector: string;
}

export const OSM_CATEGORIES: Record<string, OsmCategory> = {
  Restaurantes: {
    filters: ['["amenity"="restaurant"]'],
    sector: "Hostelería",
    subsector: "Restaurantes",
  },
  "Bares y cafeterías": {
    filters: ['["amenity"="cafe"]', '["amenity"="bar"]', '["amenity"="pub"]'],
    sector: "Hostelería",
    subsector: "Bares y cafeterías",
  },
  Hoteles: {
    filters: ['["tourism"="hotel"]'],
    sector: "Turismo",
    subsector: "Hoteles",
  },
  Campings: {
    filters: ['["tourism"="camp_site"]'],
    sector: "Turismo",
    subsector: "Campings",
  },
  "Apartamentos turísticos": {
    filters: ['["tourism"="apartment"]'],
    sector: "Turismo",
    subsector: "Apartamentos turísticos",
  },
  "Peluquerías y barberías": {
    filters: ['["shop"="hairdresser"]'],
    sector: "Servicios locales",
    subsector: "Peluquerías y barberías",
  },
  Talleres: {
    filters: ['["shop"="car_repair"]'],
    sector: "Servicios locales",
    subsector: "Talleres",
  },
  "Clínicas dentales": {
    filters: ['["amenity"="dentist"]', '["healthcare"="dentist"]'],
    sector: "Servicios locales",
    subsector: "Clínicas dentales",
  },
  Gimnasios: {
    filters: ['["leisure"="fitness_centre"]'],
    sector: "Servicios locales",
    subsector: "Gimnasios",
  },
  Inmobiliarias: {
    filters: ['["office"="estate_agent"]'],
    sector: "Inmobiliario",
    subsector: "Inmobiliarias",
  },
  Moda: {
    filters: ['["shop"="clothes"]'],
    sector: "Comercio",
    subsector: "Moda",
  },
  Joyerías: {
    filters: ['["shop"="jewelry"]'],
    sector: "Comercio",
    subsector: "Joyerías",
  },
};

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

export interface OverpassSearchOptions {
  municipality: string;
  category: string;
  maxResults?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export class OverpassError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "OverpassError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Builds an Overpass QL query scoped to a municipality's administrative area.
 * `area[name=...]` is used rather than a bounding box so results follow the
 * real municipal boundary instead of a rectangle that would pull in
 * neighbouring towns.
 */
export function buildOverpassQuery(municipality: string, category: OsmCategory, limit: number): string {
  const escaped = municipality.replace(/["\\]/g, "\\$&");
  const selectors = category.filters
    .flatMap((filter) => [`  node${filter}(area.searchArea);`, `  way${filter}(area.searchArea);`])
    .join("\n");

  return `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}];
area["name"="${escaped}"]["boundary"="administrative"]->.searchArea;
(
${selectors}
);
out center tags ${limit};`;
}

/**
 * Turns an OSM element into a business record. Only tags that were actually
 * present become fields — an unmapped phone stays absent, never an empty
 * string, so downstream code cannot mistake "not mapped" for "has none".
 */
export function mapElementToRecord(
  element: OverpassElement,
  category: OsmCategory
): RawBusinessRecord | null {
  const tags = element.tags ?? {};
  const name = tags.name?.trim();
  if (!name) return null;

  const record: RawBusinessRecord = {
    name,
    source: "openstreetmap",
    sector: category.sector,
    category: category.subsector,
  };

  const phone = tags.phone ?? tags["contact:phone"];
  const website = tags.website ?? tags["contact:website"];
  const email = tags.email ?? tags["contact:email"];

  if (phone) record.phone = phone.trim();
  if (website) {
    // OSM sometimes stores bare hostnames; normalise to an absolute URL so
    // the resolver and scanner receive something fetchable.
    const trimmed = website.trim();
    record.website_url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }
  if (email) record.email = email.trim();

  const street = tags["addr:street"];
  const houseNumber = tags["addr:housenumber"];
  if (street) record.address = houseNumber ? `${street}, ${houseNumber}` : street;
  if (tags["addr:city"]) record.city = tags["addr:city"];
  if (tags["addr:postcode"]) record.postal_code = tags["addr:postcode"];

  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (typeof lat === "number") record.latitude = lat;
  if (typeof lon === "number") record.longitude = lon;

  // OSM has no ratings or review counts. They stay absent rather than zeroed:
  // a zero would read downstream as "nobody reviewed it", which is a claim we
  // have no basis for.
  return record;
}

export class OverpassBusinessSourceProvider {
  readonly id = "openstreetmap" as const;
  /** No key, no billing account: always usable. */
  readonly isActive = true;
  readonly costPerRequestUsd = 0;

  lastRequestCount = 0;

  async search(options: OverpassSearchOptions): Promise<DiscoveryResult> {
    const category = OSM_CATEGORIES[options.category];
    if (!category) {
      return {
        records: [],
        errors: [
          {
            row: 0,
            message: `Categoría "${options.category}" sin equivalencia en OpenStreetMap: no se busca en vez de adivinar una etiqueta.`,
          },
        ],
      };
    }

    const doFetch = options.fetchImpl ?? fetch;
    const sleep = options.sleep ?? defaultSleep;
    const limit = Math.max(1, Math.min(200, options.maxResults ?? 50));
    const query = buildOverpassQuery(options.municipality, category, limit);
    const errors: DiscoveryResult["errors"] = [];

    this.lastRequestCount = 0;

    let payload: OverpassResponse | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      this.lastRequestCount++;
      const { recordApiCall } = await import("@/lib/research/api-log");
      const startedAt = Date.now();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      try {
        const response = await doFetch(OVERPASS_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            // Overpass asks for an identifying agent so they can contact
            // heavy users instead of blocking them.
            "User-Agent": DISCOVERY_USER_AGENT,
          },
          body: new URLSearchParams({ data: query }).toString(),
          signal: controller.signal,
        });

        if (response.ok) {
          payload = (await response.json()) as OverpassResponse;
          recordApiCall({
            provider: "openstreetmap",
            operation: "overpass:interpreter",
            ok: true,
            durationMs: Date.now() - startedAt,
            resultCount: payload.elements?.length ?? 0,
            estimatedCostUsd: 0,
            errorCode: null,
          });
          break;
        }

        recordApiCall({
          provider: "openstreetmap",
          operation: "overpass:interpreter",
          ok: false,
          durationMs: Date.now() - startedAt,
          resultCount: null,
          estimatedCostUsd: 0,
          errorCode: String(response.status),
        });

        // 429/504 are Overpass's load-shedding signals, not failures.
        const retryable = response.status === 429 || response.status === 504 || response.status >= 500;
        if (!retryable || attempt === MAX_RETRIES) {
          throw new OverpassError(`Overpass respondió ${response.status}`, response.status);
        }
        await sleep(2 ** attempt * 2000);
      } catch (err) {
        if (err instanceof OverpassError) throw err;
        if (attempt === MAX_RETRIES) {
          throw new OverpassError(
            err instanceof Error ? err.message : "Overpass no respondió",
            0
          );
        }
        await sleep(2 ** attempt * 2000);
      } finally {
        clearTimeout(timer);
      }
    }

    const records: RawBusinessRecord[] = [];
    for (const element of payload?.elements ?? []) {
      const record = mapElementToRecord(element, category);
      if (record) {
        // OSM does not carry the municipality on every element; fall back to
        // the one we searched, which is a fact about the query, not a guess.
        if (!record.city) record.city = options.municipality;
        records.push(record);
      } else {
        errors.push({
          row: element.id,
          message: `Elemento OSM ${element.id} descartado: sin nombre.`,
        });
      }
      if (records.length >= limit) break;
    }

    return { records, errors };
  }
}

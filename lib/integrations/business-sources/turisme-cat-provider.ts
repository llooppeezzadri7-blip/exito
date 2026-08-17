import { recordApiCall } from "@/lib/research/api-log";
import type { DiscoveryResult, RawBusinessRecord } from "./types";

/**
 * Registre de Turisme de Catalunya — official register of tourism
 * accommodation, published as open data by the Generalitat.
 *
 * Free, keyless, and authoritative: if an establishment appears here it is
 * legally registered, which is a stronger guarantee of existence than any
 * scraped listing. Served by Socrata, so the standard SoQL parameters apply.
 *
 * Endpoint:
 *   GET https://analisi.transparenciacatalunya.cat/resource/t2h3-cgys.json
 *       ?$limit=...&$where=...
 *
 * Scope caveat: this register covers accommodation (hotels, apartments,
 * campsites, rural tourism). Restaurants and shops are NOT in it — their
 * discovery comes from OpenStreetMap and directories instead.
 */

const DATASET_URL = "https://analisi.transparenciacatalunya.cat/resource/t2h3-cgys.json";
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Field names as published by the dataset. Kept in one place because Socrata
 * column names are stable but not obvious, and a rename here is a one-line
 * fix rather than a hunt through parsing code.
 */
interface TurismeCatRow {
  nom?: string;
  nom_establiment?: string;
  municipi?: string;
  comarca?: string;
  adreca?: string;
  adre_a?: string;
  telefon?: string;
  tel_fon?: string;
  email?: string;
  web?: string;
  tipus?: string;
  tipus_establiment?: string;
  categoria?: string;
  places?: string;
  numero_registre?: string;
  [key: string]: string | undefined;
}

export interface TurismeCatSearchOptions {
  municipality: string;
  maxResults?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class TurismeCatError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "TurismeCatError";
  }
}

/** Reads the first present variant of a field, since the dataset has aliases. */
function pick(row: TurismeCatRow, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function mapRowToRecord(row: TurismeCatRow, municipality: string): RawBusinessRecord | null {
  const name = pick(row, "nom", "nom_establiment");
  if (!name) return null;

  const record: RawBusinessRecord = {
    name,
    source: "turisme_cat",
    sector: "Turismo",
    city: pick(row, "municipi") ?? municipality,
    country: "España",
  };

  const type = pick(row, "tipus", "tipus_establiment");
  if (type) record.category = type;

  const address = pick(row, "adreca", "adre_a");
  if (address) record.address = address;

  const phone = pick(row, "telefon", "tel_fon");
  if (phone) record.phone = phone;

  const email = pick(row, "email");
  if (email) record.email = email;

  const web = pick(row, "web");
  if (web) record.website_url = /^https?:\/\//i.test(web) ? web : `https://${web}`;

  const region = pick(row, "comarca");
  if (region) record.region = region;

  return record;
}

export class TurismeCatBusinessSourceProvider {
  readonly id = "turisme_cat" as const;
  /** Open data, no key, no billing account. */
  readonly isActive = true;
  readonly costPerRequestUsd = 0;

  lastRequestCount = 0;

  async search(options: TurismeCatSearchOptions): Promise<DiscoveryResult> {
    const doFetch = options.fetchImpl ?? fetch;
    const limit = Math.max(1, Math.min(500, options.maxResults ?? 100));
    const errors: DiscoveryResult["errors"] = [];

    // Socrata is case-sensitive on values; upper() keeps the match robust
    // against how the municipality is capitalised in the register.
    const escaped = options.municipality.replace(/'/g, "''").toUpperCase();
    const url = `${DATASET_URL}?$limit=${limit}&$where=${encodeURIComponent(
      `upper(municipi)='${escaped}'`
    )}`;

    this.lastRequestCount = 1;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    let rows: TurismeCatRow[];
    try {
      const response = await doFetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      if (!response.ok) {
        recordApiCall({
          provider: "turisme_cat",
          operation: "socrata:establiments",
          ok: false,
          durationMs: Date.now() - startedAt,
          resultCount: null,
          estimatedCostUsd: 0,
          errorCode: String(response.status),
        });
        throw new TurismeCatError(
          `Registre de Turisme respondió ${response.status}`,
          response.status
        );
      }

      rows = (await response.json()) as TurismeCatRow[];
      recordApiCall({
        provider: "turisme_cat",
        operation: "socrata:establiments",
        ok: true,
        durationMs: Date.now() - startedAt,
        resultCount: rows.length,
        estimatedCostUsd: 0,
        errorCode: null,
      });
    } catch (err) {
      if (err instanceof TurismeCatError) throw err;
      throw new TurismeCatError(
        err instanceof Error ? err.message : "El registro de turismo no respondió",
        0
      );
    } finally {
      clearTimeout(timer);
    }

    const records: RawBusinessRecord[] = [];
    rows.forEach((row, index) => {
      const record = mapRowToRecord(row, options.municipality);
      if (record) records.push(record);
      else errors.push({ row: index, message: "Fila del registro sin nombre de establecimiento." });
    });

    return { records, errors };
  }
}

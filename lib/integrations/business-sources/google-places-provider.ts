import { env, hasGooglePlaces } from "@/lib/config/env";
import { recordApiCall } from "@/lib/research/api-log";
import type { BusinessSourceProvider, DiscoveryParams, DiscoveryResult, RawBusinessRecord } from "./types";
import { ProviderNotConfiguredError } from "./types";

/**
 * Google Places API (New) connector.
 *
 * Endpoints, verified against developers.google.com/maps/documentation/places/web-service
 * (not guessed):
 *   POST https://places.googleapis.com/v1/places:searchText
 *     headers: Content-Type: application/json, X-Goog-Api-Key, X-Goog-FieldMask
 *     body: { textQuery, pageSize (<=20), pageToken?, languageCode?, regionCode?, locationBias? }
 *
 * Billing note (§27): the field mask decides the SKU. `rating` and
 * `userRatingCount` are Enterprise-tier fields, so the mask below bills at
 * Enterprise. It is kept in one constant so the cost of a sweep is a
 * one-line decision rather than something buried in a request body.
 */

const SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.location",
  "places.businessStatus",
  "places.primaryTypeDisplayName",
  "places.types",
  "nextPageToken",
].join(",");

const MAX_PAGE_SIZE = 20;
const MAX_RETRIES = 3;

/**
 * Hard ceiling on paid pages per query. Every page is a billed request, so
 * pagination needs a stop that does not depend on the API behaving: a run
 * must never be able to spend without bound because the response keeps
 * handing back a nextPageToken.
 */
const MAX_PAGES_PER_QUERY = 5;

/** Estimated USD per Text Search request. See ENVIRONMENT.md — the real SKU
 * depends on the field mask and on the monthly free allowance, so this is an
 * upper-bound ESTIMATE for pre-flight budgeting, never a billed figure. */
export const PLACES_COST_PER_REQUEST_USD = 0.032;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

interface PlacesAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

interface PlacesPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: PlacesAddressComponent[];
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  location?: { latitude?: number; longitude?: number };
  businessStatus?: string;
  primaryTypeDisplayName?: { text?: string };
  types?: string[];
}

interface PlacesResponse {
  places?: PlacesPlace[];
  nextPageToken?: string;
}

export interface PlacesSearchOptions {
  /** Text query, e.g. "restaurante en Lloret de Mar". */
  query: string;
  maxResults?: number;
  languageCode?: string;
  regionCode?: string;
  sector?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable so tests don't actually sleep through backoff. */
  sleep?: (ms: number) => Promise<void>;
}

export class PlacesApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "PlacesApiError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function componentOf(place: PlacesPlace, type: string): string | undefined {
  return place.addressComponents?.find((c) => c.types?.includes(type))?.longText;
}

/**
 * Maps a Places result to our record shape. Every field is copied only when
 * Places actually returned it — nothing is inferred, and a missing website
 * stays missing rather than becoming an empty string (§4).
 */
export function mapPlaceToRecord(place: PlacesPlace, sector?: string): RawBusinessRecord | null {
  const name = place.displayName?.text?.trim();
  if (!name) return null;

  // Permanently closed businesses are not prospects (§18: descartar cerradas).
  if (place.businessStatus === "CLOSED_PERMANENTLY") return null;

  const record: RawBusinessRecord = { name, source: "google_places" };

  if (place.id) record.gbp_place_id = place.id;
  if (place.formattedAddress) record.address = place.formattedAddress;
  if (place.internationalPhoneNumber) record.phone = place.internationalPhoneNumber;
  if (place.websiteUri) record.website_url = place.websiteUri;
  if (typeof place.rating === "number") record.rating = place.rating;
  if (typeof place.userRatingCount === "number") record.review_count = place.userRatingCount;
  if (typeof place.location?.latitude === "number") record.latitude = place.location.latitude;
  if (typeof place.location?.longitude === "number") record.longitude = place.location.longitude;
  if (place.primaryTypeDisplayName?.text) record.category = place.primaryTypeDisplayName.text;
  if (sector) record.sector = sector;

  const city = componentOf(place, "locality") ?? componentOf(place, "postal_town");
  const region = componentOf(place, "administrative_area_level_2");
  const country = componentOf(place, "country");
  const postalCode = componentOf(place, "postal_code");
  if (city) record.city = city;
  if (region) record.region = region;
  if (country) record.country = country;
  if (postalCode) record.postal_code = postalCode;

  return record;
}

/** True when Places returned no website field at all for this place. */
export function placeHasNoWebsite(place: PlacesPlace): boolean {
  return !place.websiteUri;
}

export class GooglePlacesBusinessSourceProvider implements BusinessSourceProvider {
  readonly id = "google_places" as const;

  get isActive() {
    return hasGooglePlaces;
  }

  /** Requests actually issued in the last discover() call — for cost tracking. */
  lastRequestCount = 0;

  private async requestPage(
    body: Record<string, unknown>,
    options: PlacesSearchOptions
  ): Promise<PlacesResponse> {
    const doFetch = options.fetchImpl ?? fetch;
    const sleep = options.sleep ?? defaultSleep;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      this.lastRequestCount++;
      const startedAt = Date.now();

      const response = await doFetch(SEARCH_TEXT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": env.GOOGLE_PLACES_API_KEY!,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const payload = (await response.json()) as PlacesResponse;
        recordApiCall({
          provider: "google_places",
          operation: "places:searchText",
          ok: true,
          durationMs: Date.now() - startedAt,
          resultCount: payload.places?.length ?? 0,
          estimatedCostUsd: PLACES_COST_PER_REQUEST_USD,
          errorCode: null,
        });
        return payload;
      }

      const retryable = RETRYABLE_STATUS.has(response.status);
      recordApiCall({
        provider: "google_places",
        operation: "places:searchText",
        ok: false,
        durationMs: Date.now() - startedAt,
        resultCount: null,
        // A rejected request is still a request against the quota.
        estimatedCostUsd: PLACES_COST_PER_REQUEST_USD,
        errorCode: String(response.status),
      });

      if (!retryable || attempt === MAX_RETRIES) {
        const detail = await response.text().catch(() => "");
        throw new PlacesApiError(
          `Places API respondió ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
          response.status,
          retryable
        );
      }

      // Exponential backoff: 1s, 2s, 4s (§26).
      await sleep(2 ** attempt * 1000);
    }

    throw new PlacesApiError("Places API: reintentos agotados", 0, true);
  }

  /**
   * Runs one text query, following `nextPageToken` until `maxResults` is
   * reached. Returns exactly what the API gave back — no padding, no
   * synthesised entries.
   */
  async search(options: PlacesSearchOptions): Promise<DiscoveryResult> {
    if (!hasGooglePlaces) {
      throw new ProviderNotConfiguredError("Google Places API", ["GOOGLE_PLACES_API_KEY"]);
    }

    const maxResults = Math.max(1, options.maxResults ?? MAX_PAGE_SIZE);
    const records: RawBusinessRecord[] = [];
    const errors: DiscoveryResult["errors"] = [];
    let pageToken: string | undefined;
    let index = 0;

    this.lastRequestCount = 0;

    // Three independent stops, because each page is money and none of them
    // may depend on the API behaving well:
    //   1. the requested number of results is reached,
    //   2. a hard page ceiling,
    //   3. a page that adds nothing new (all filtered out, or empty), which
    //      would otherwise loop forever since records.length never grows,
    //   4. a repeated pageToken, which is the same loop by another route.
    const seenTokens = new Set<string>();

    for (let page = 0; page < MAX_PAGES_PER_QUERY && records.length < maxResults; page++) {
      const body: Record<string, unknown> = {
        textQuery: options.query,
        pageSize: Math.min(MAX_PAGE_SIZE, maxResults - records.length),
        languageCode: options.languageCode ?? "es",
        regionCode: options.regionCode ?? "ES",
      };
      if (pageToken) body.pageToken = pageToken;

      const response = await this.requestPage(body, options);
      const before = records.length;

      for (const place of response.places ?? []) {
        const record = mapPlaceToRecord(place, options.sector);
        if (record) records.push(record);
        else
          errors.push({
            row: index,
            message: `Resultado descartado (sin nombre o cerrado permanentemente): ${place.id ?? "sin id"}`,
          });
        index++;
      }

      if (records.length === before) {
        errors.push({
          row: index,
          message: "Página sin resultados aprovechables: se detiene la paginación para no seguir gastando peticiones.",
        });
        break;
      }

      if (!response.nextPageToken) break;
      if (seenTokens.has(response.nextPageToken)) {
        errors.push({
          row: index,
          message: "La API devolvió un pageToken repetido: paginación detenida.",
        });
        break;
      }

      seenTokens.add(response.nextPageToken);
      pageToken = response.nextPageToken;
    }

    return { records: records.slice(0, maxResults), errors };
  }

  async discover(params: DiscoveryParams): Promise<DiscoveryResult> {
    const parts = [params.sector, params.city && `en ${params.city}`].filter(Boolean);
    if (parts.length === 0) {
      throw new Error("Se necesita al menos sector o ciudad para buscar en Google Places.");
    }

    return this.search({
      query: parts.join(" "),
      maxResults: params.quantity,
      languageCode: params.language,
      sector: params.sector,
    });
  }
}

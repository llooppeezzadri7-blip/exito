import { hasGooglePlaces } from "@/lib/config/env";
import type { BusinessSourceProvider, DiscoveryParams, DiscoveryResult } from "./types";
import { ProviderNotConfiguredError } from "./types";

/**
 * Google Places API (New) connector — implemented but left INACTIVE by
 * explicit decision with the user (2026-08-11, see ROADMAP.md) to avoid
 * incurring paid API costs before they opt in with billing + an API key.
 *
 * Endpoints (verified against developers.google.com/maps/documentation/places/web-service,
 * not guessed):
 *   POST https://places.googleapis.com/v1/places:searchText
 *     headers: Content-Type: application/json, X-Goog-Api-Key, X-Goog-FieldMask
 *     body: { textQuery, pageSize (<=20), pageToken?, languageCode?, locationBias? }
 *     response place fields used: id, displayName, formattedAddress,
 *       internationalPhoneNumber, websiteUri, rating, userRatingCount,
 *       location, businessStatus, types
 *   GET  https://places.googleapis.com/v1/places/{PLACE_ID}
 *     (Place Details — for enrichment beyond what Text Search returns)
 *
 * Cost: pay-per-request (Places API New pricing), requires a Google Cloud
 * project with billing enabled. See ENVIRONMENT.md.
 */
export class GooglePlacesBusinessSourceProvider implements BusinessSourceProvider {
  readonly id = "google_places" as const;
  get isActive() {
    return hasGooglePlaces;
  }

  async discover(_params: DiscoveryParams): Promise<DiscoveryResult> {
    if (!hasGooglePlaces) {
      throw new ProviderNotConfiguredError("Google Places API", ["GOOGLE_PLACES_API_KEY"]);
    }

    // Intentionally not implemented against the live API yet: activating
    // this path is a cost-bearing decision the user makes explicitly by
    // setting the key. When they do, implement searchText pagination
    // (pageSize<=20, follow pageToken) + optional Place Details enrichment
    // here, using env.GOOGLE_PLACES_API_KEY.
    throw new Error(
      "GOOGLE_PLACES_API_KEY is set, but the live Places API call is not implemented yet " +
        "— wire it up in lib/integrations/business-sources/google-places-provider.ts."
    );
  }
}

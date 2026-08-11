import type { BusinessSource } from "@/lib/database/types";

/** A business record as it comes out of a source, before it's persisted. */
export interface RawBusinessRecord {
  name: string;
  category?: string;
  sector?: string;
  address?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
  phone?: string;
  website_url?: string;
  email?: string;
  gbp_place_id?: string;
  rating?: number;
  review_count?: number;
  latitude?: number;
  longitude?: number;
  source: BusinessSource;
}

export interface DiscoveryParams {
  country?: string;
  city?: string;
  postalCode?: string;
  sector?: string;
  quantity?: number;
  language?: string;
}

export interface DiscoveryRowError {
  row: number;
  message: string;
}

export interface DiscoveryResult {
  records: RawBusinessRecord[];
  errors: DiscoveryRowError[];
}

/**
 * Abstraction over "where prospects come from". Every implementation must
 * degrade safely (throw a clear, typed error) rather than silently return
 * fabricated data when it isn't configured. See ARCHITECTURE.md §6 and §9.
 */
export interface BusinessSourceProvider {
  readonly id: BusinessSource;
  readonly isActive: boolean;
  discover(params: DiscoveryParams): Promise<DiscoveryResult>;
}

/** A provider driven by an uploaded file rather than a search query (e.g. CSV import). */
export interface FileImportProvider {
  readonly id: BusinessSource;
  readonly isActive: true;
  importFromText(csvText: string): DiscoveryResult;
}

export class ProviderNotConfiguredError extends Error {
  constructor(providerId: string, missingEnvVars: string[]) {
    super(
      `${providerId} is not configured. Set ${missingEnvVars.join(", ")} to activate it (see ENVIRONMENT.md).`
    );
    this.name = "ProviderNotConfiguredError";
  }
}

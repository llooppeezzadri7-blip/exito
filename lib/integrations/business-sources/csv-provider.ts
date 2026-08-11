import Papa from "papaparse";
import { z } from "zod";
import type { DiscoveryResult, FileImportProvider, RawBusinessRecord } from "./types";

/**
 * Accepts common Spanish/English column names so agencies can drop in
 * whatever export their existing tools (Google Maps scrapers they already
 * had, spreadsheets, CRM exports) produce, without a required template.
 */
const HEADER_ALIASES: Record<keyof Omit<RawBusinessRecord, "source">, string[]> = {
  name: ["name", "nombre", "business_name", "negocio"],
  category: ["category", "categoria", "categoría"],
  sector: ["sector", "industry", "sector_actividad"],
  address: ["address", "direccion", "dirección"],
  city: ["city", "ciudad", "localidad"],
  region: ["region", "región", "provincia", "state"],
  postal_code: ["postal_code", "codigo_postal", "código_postal", "cp", "zip"],
  country: ["country", "pais", "país"],
  phone: ["phone", "telefono", "teléfono", "tel"],
  website_url: ["website", "website_url", "web", "url", "sitio_web"],
  email: ["email", "correo", "e-mail"],
  gbp_place_id: ["gbp_place_id", "place_id", "google_place_id"],
  rating: ["rating", "valoracion", "valoración"],
  review_count: ["review_count", "reviews", "num_resenas", "numero_resenas", "número_reseñas"],
  latitude: ["latitude", "lat", "latitud"],
  longitude: ["longitude", "lng", "lon", "longitud"],
};

const rowSchema = z.object({
  name: z.string().trim().min(1, "El nombre del negocio es obligatorio"),
  category: z.string().trim().optional(),
  sector: z.string().trim().optional(),
  address: z.string().trim().optional(),
  city: z.string().trim().optional(),
  region: z.string().trim().optional(),
  postal_code: z.string().trim().optional(),
  country: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  website_url: z.string().trim().url("URL de web no válida").optional().or(z.literal("")),
  email: z.string().trim().email("Email no válido").optional().or(z.literal("")),
  gbp_place_id: z.string().trim().optional(),
  rating: z.coerce.number().min(0).max(5).optional(),
  review_count: z.coerce.number().int().min(0).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
});

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

function findField(field: keyof typeof HEADER_ALIASES, normalizedRow: Record<string, string>) {
  for (const alias of HEADER_ALIASES[field]) {
    if (normalizedRow[alias] !== undefined && normalizedRow[alias] !== "") return normalizedRow[alias];
  }
  return undefined;
}

export class CsvBusinessSourceProvider implements FileImportProvider {
  readonly id = "csv_import" as const;
  readonly isActive = true as const;

  importFromText(csvText: string): DiscoveryResult {
    const parsed = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: normalizeHeader,
    });

    const records: RawBusinessRecord[] = [];
    const errors: DiscoveryResult["errors"] = [];

    parsed.data.forEach((row, index) => {
      const candidate = {
        name: findField("name", row),
        category: findField("category", row),
        sector: findField("sector", row),
        address: findField("address", row),
        city: findField("city", row),
        region: findField("region", row),
        postal_code: findField("postal_code", row),
        country: findField("country", row),
        phone: findField("phone", row),
        website_url: findField("website_url", row),
        email: findField("email", row),
        gbp_place_id: findField("gbp_place_id", row),
        rating: findField("rating", row),
        review_count: findField("review_count", row),
        latitude: findField("latitude", row),
        longitude: findField("longitude", row),
      };

      const result = rowSchema.safeParse(candidate);
      if (!result.success) {
        errors.push({
          row: index + 2, // +1 for header row, +1 for 1-indexing
          message: result.error.issues.map((i) => i.message).join("; "),
        });
        return;
      }

      const clean = result.data;
      records.push({
        name: clean.name,
        category: clean.category || undefined,
        sector: clean.sector || undefined,
        address: clean.address || undefined,
        city: clean.city || undefined,
        region: clean.region || undefined,
        postal_code: clean.postal_code || undefined,
        country: clean.country || undefined,
        phone: clean.phone || undefined,
        website_url: clean.website_url || undefined,
        email: clean.email || undefined,
        gbp_place_id: clean.gbp_place_id || undefined,
        rating: clean.rating,
        review_count: clean.review_count,
        latitude: clean.latitude,
        longitude: clean.longitude,
        source: "csv_import",
      });
    });

    for (const parseError of parsed.errors) {
      errors.push({ row: (parseError.row ?? 0) + 2, message: parseError.message });
    }

    return { records, errors };
  }
}

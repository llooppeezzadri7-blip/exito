import type { BusinessSource, BusinessVerificationStatus } from "@/lib/database/types";
import type { RawBusinessRecord } from "@/lib/integrations/business-sources/types";
import { findDuplicate, identityDomain, normalizePhone } from "./dedupe";

/**
 * Cross-source corroboration.
 *
 * The rule, decided explicitly:
 *
 *   1 independent source            → PROBABLE
 *   2+ independent sources agreeing → VERIFICADO
 *   sources that contradict         → NO_VERIFICADO, until resolved
 *
 * A single source can never promote itself to VERIFICADO, however
 * authoritative it looks. That is the whole point: the failures this system
 * was built around came from trusting one source and calling it a fact.
 */

export interface CorroboratedBusiness {
  record: RawBusinessRecord;
  /** Distinct sources that independently reported this business. */
  sources: BusinessSource[];
  status: BusinessVerificationStatus;
  /** Fields where sources disagreed, with the competing values. */
  conflicts: FieldConflict[];
  /** Human-readable trail of how the record was assembled. */
  notes: string[];
}

export interface FieldConflict {
  field: "phone" | "website_url" | "address";
  values: { source: BusinessSource; value: string }[];
}

/** Fields strong enough that a disagreement means we may have two businesses. */
const DECISIVE_FIELDS = ["phone", "website_url"] as const;

function normalizedFieldValue(field: string, value: string): string {
  if (field === "phone") return normalizePhone(value) ?? value;
  if (field === "website_url") return identityDomain(value) ?? value.toLowerCase();
  return value.trim().toLowerCase();
}

/**
 * Merges records that describe the same business, filling gaps rather than
 * overwriting: the first source to provide a field keeps it, and a later
 * source that disagrees produces a conflict instead of silently winning.
 */
function mergeInto(
  target: CorroboratedBusiness,
  incoming: RawBusinessRecord
): void {
  if (!target.sources.includes(incoming.source)) {
    target.sources.push(incoming.source);
  }

  for (const [key, value] of Object.entries(incoming) as [keyof RawBusinessRecord, unknown][]) {
    if (key === "source" || value === undefined || value === null || value === "") continue;

    const existing = target.record[key];
    if (existing === undefined || existing === null || existing === "") {
      // Gap filled — no conflict possible.
      (target.record as unknown as Record<string, unknown>)[key] = value;
      continue;
    }

    if (typeof existing !== "string" || typeof value !== "string") continue;
    if (!(DECISIVE_FIELDS as readonly string[]).includes(key)) continue;

    const a = normalizedFieldValue(key, existing);
    const b = normalizedFieldValue(key, value);
    if (a === b) continue;

    const field = key as FieldConflict["field"];
    const conflict = target.conflicts.find((c) => c.field === field);
    if (conflict) {
      if (!conflict.values.some((v) => v.value === value)) {
        conflict.values.push({ source: incoming.source, value });
      }
    } else {
      target.conflicts.push({
        field,
        values: [
          { source: target.record.source, value: existing },
          { source: incoming.source, value },
        ],
      });
    }
  }
}

function statusFor(entry: CorroboratedBusiness): BusinessVerificationStatus {
  if (entry.conflicts.length > 0) return "NO_VERIFICADO";
  return entry.sources.length >= 2 ? "VERIFICADO" : "PROBABLE";
}

export interface CorroborationResult {
  businesses: CorroboratedBusiness[];
  /** Counts by status, for reporting what a sweep actually produced. */
  summary: Record<BusinessVerificationStatus, number>;
}

/**
 * Takes everything the sources returned and produces one entry per real
 * business, with its verification status and any contradictions preserved.
 */
export function corroborate(records: RawBusinessRecord[]): CorroborationResult {
  const entries: CorroboratedBusiness[] = [];

  for (const record of records) {
    const candidates = entries.map((entry) => ({
      ...entry.record,
      phone: entry.record.phone ?? null,
      website_url: entry.record.website_url ?? null,
      address: entry.record.address ?? null,
      city: entry.record.city ?? null,
      gbp_place_id: entry.record.gbp_place_id ?? null,
      __index: entries.indexOf(entry),
    }));

    const match = findDuplicate(
      {
        name: record.name,
        phone: record.phone ?? null,
        website_url: record.website_url ?? null,
        address: record.address ?? null,
        city: record.city ?? null,
        gbp_place_id: record.gbp_place_id ?? null,
      },
      candidates
    );

    if (match) {
      const entry = entries[match.existing.__index];
      const before = entry.sources.length;
      mergeInto(entry, record);
      if (entry.sources.length > before) {
        entry.notes.push(
          `Corroborado por ${record.source} (coincidencia por ${match.reason}, confianza ${match.confidence}).`
        );
      } else {
        entry.notes.push(`${record.source} devolvió el mismo negocio otra vez; no cuenta como fuente adicional.`);
      }
      entry.status = statusFor(entry);
      continue;
    }

    const entry: CorroboratedBusiness = {
      record: { ...record },
      sources: [record.source],
      status: "PROBABLE",
      conflicts: [],
      notes: [`Descubierto por ${record.source}.`],
    };
    entry.status = statusFor(entry);
    entries.push(entry);
  }

  const summary: Record<BusinessVerificationStatus, number> = {
    VERIFICADO: 0,
    PROBABLE: 0,
    NO_VERIFICADO: 0,
  };
  for (const entry of entries) summary[entry.status] += 1;

  return { businesses: entries, summary };
}

/** Explains a status in terms the user can act on, for the UI and exports. */
export function explainStatus(entry: CorroboratedBusiness): string {
  if (entry.status === "NO_VERIFICADO") {
    const fields = entry.conflicts.map((c) => c.field).join(", ");
    return `Fuentes contradictorias en: ${fields}. Hay que resolverlo antes de darlo por bueno.`;
  }
  if (entry.status === "VERIFICADO") {
    return `Confirmado de forma independiente por ${entry.sources.length} fuentes: ${entry.sources.join(", ")}.`;
  }
  return `Una sola fuente (${entry.sources[0]}): plausible, pero sin confirmación independiente.`;
}

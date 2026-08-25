import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RawBusinessRecord } from "@/lib/integrations/business-sources/types";
import type { OpportunityRecord } from "./batch";

/**
 * Making a two-hour sweep survivable.
 *
 * The first real sweep died at the ninety-minute mark because the terminal
 * that launched it closed, and it had produced exactly nothing: discovery,
 * analysis and every written artefact all landed in the final lines of the
 * script. Ninety minutes of real requests to real websites, thrown away.
 *
 * So the sweep now writes as it goes. Discovery is cached once complete —
 * it is the expensive, rate-limited half, and repeating five hundred queries
 * to a free public API just to get back to where you were is both slow and
 * rude. Each analysed business is appended the moment it is finished. A
 * relaunch reads both back and carries on from the first business it has no
 * record of.
 *
 * The append format is JSON Lines rather than a JSON array for one reason: a
 * process killed mid-write leaves a truncated final line, and a truncated
 * line can be discarded without losing the hundred before it. A truncated
 * array is unparseable in its entirety.
 */

export const DEFAULT_CHECKPOINT_DIR = ".barrido";

export interface CheckpointBusiness {
  name: string;
  website?: string | null;
  city?: string | null;
}

/**
 * Identity for resume purposes. Name plus host plus town: the same business
 * discovered twice under different categories must resolve to one key, or a
 * resumed sweep re-analyses it and the ranking counts it twice.
 */
export function businessKey(business: CheckpointBusiness): string {
  const name = business.name.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const city = (business.city ?? "").trim().toLowerCase();

  let host = "";
  if (business.website) {
    try {
      host = new URL(business.website).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      host = business.website.trim().toLowerCase();
    }
  }

  return `${name}|${host}|${city}`;
}

/**
 * Everything the discovery half produced. The counts travel with the records
 * because a resumed sweep still has to report where its businesses came from
 * and which queries came back empty — dropping the statistics would turn a
 * resumed run's source table into a row of zeroes that reads as "every source
 * is dead".
 */
export interface DiscoverySnapshot {
  discovered: number;
  unique: RawBusinessRecord[];
  sources: { source: string; queries: number; failures: number; records: number }[];
  emptyQueries: string[];
}

export interface SweepCheckpoint {
  /** Cached discovery for this exact scope, or null if there is none. */
  loadDiscovery(scope: string): DiscoverySnapshot | null;
  saveDiscovery(scope: string, snapshot: DiscoverySnapshot): void;
  /** Businesses already analysed in a previous, interrupted run. */
  loadRecords(): OpportunityRecord[];
  appendRecord(record: OpportunityRecord): void;
  /** Human-readable description of where the state lives. */
  describe(): string;
}

/**
 * The scope a discovery cache belongs to. Reusing discovery from a different
 * set of municipalities or sectors would silently analyse the wrong region,
 * so the scope is part of the key and a mismatch means a fresh discovery.
 */
export function discoveryScope(input: {
  municipalities: string[];
  categories: string[];
  maxPerQuery: number;
}): string {
  const municipalities = [...input.municipalities].sort().join(",") || "TODOS";
  const categories = [...input.categories].sort().join(",");
  return `${municipalities}::${categories}::${input.maxPerQuery}`;
}

interface DiscoveryFile {
  scope: string;
  savedAt: string;
  snapshot: DiscoverySnapshot;
}

export class FileCheckpoint implements SweepCheckpoint {
  private readonly dir: string;
  private readonly discoveryPath: string;
  private readonly recordsPath: string;
  /** Lines that could not be parsed — reported, never silently dropped. */
  public corruptLines = 0;

  constructor(dir: string = DEFAULT_CHECKPOINT_DIR) {
    this.dir = resolve(dir);
    this.discoveryPath = resolve(this.dir, "discovery.json");
    this.recordsPath = resolve(this.dir, "records.jsonl");
    mkdirSync(this.dir, { recursive: true });
  }

  describe(): string {
    return this.dir;
  }

  loadDiscovery(scope: string): DiscoverySnapshot | null {
    if (!existsSync(this.discoveryPath)) return null;
    try {
      const parsed = JSON.parse(readFileSync(this.discoveryPath, "utf8")) as DiscoveryFile;
      if (parsed.scope !== scope) return null;
      return Array.isArray(parsed.snapshot?.unique) ? parsed.snapshot : null;
    } catch {
      // A corrupt cache is not worth a crash: rediscovering is slow but safe.
      return null;
    }
  }

  saveDiscovery(scope: string, snapshot: DiscoverySnapshot): void {
    const payload: DiscoveryFile = { scope, savedAt: new Date().toISOString(), snapshot };
    writeFileSync(this.discoveryPath, JSON.stringify(payload), "utf8");
  }

  loadRecords(): OpportunityRecord[] {
    if (!existsSync(this.recordsPath)) return [];

    const records: OpportunityRecord[] = [];
    for (const line of readFileSync(this.recordsPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line) as OpportunityRecord);
      } catch {
        // Almost always the last line of a run that was killed mid-write.
        this.corruptLines += 1;
      }
    }
    return records;
  }

  appendRecord(record: OpportunityRecord): void {
    appendFileSync(this.recordsPath, JSON.stringify(record) + "\n", "utf8");
  }
}

/** Keeps state in memory only — for tests, and for `--sin-checkpoint`. */
export class MemoryCheckpoint implements SweepCheckpoint {
  private discovery: { scope: string; snapshot: DiscoverySnapshot } | null = null;
  private readonly records: OpportunityRecord[] = [];

  describe(): string {
    return "memoria (no sobrevive al proceso)";
  }
  loadDiscovery(scope: string): DiscoverySnapshot | null {
    return this.discovery?.scope === scope ? this.discovery.snapshot : null;
  }
  saveDiscovery(scope: string, snapshot: DiscoverySnapshot): void {
    this.discovery = { scope, snapshot };
  }
  loadRecords(): OpportunityRecord[] {
    return [...this.records];
  }
  appendRecord(record: OpportunityRecord): void {
    this.records.push(record);
  }
}

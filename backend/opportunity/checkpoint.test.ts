import { afterEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  businessKey,
  discoveryScope,
  FileCheckpoint,
  MemoryCheckpoint,
  type DiscoverySnapshot,
} from "./checkpoint";
import { analyzePortfolio, type OpportunityRecord } from "./batch";
import type { Settings } from "@/lib/database/types";

/**
 * The property that matters here is survival: a sweep killed at the ninety
 * minute mark must not have produced nothing. Every test below is a way that
 * could go wrong.
 */

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "barrido-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const SETTINGS = { research_delay_ms: 0 } as unknown as Settings;

function record(name: string, website: string | null, city: string): OpportunityRecord {
  return {
    business: { name, website, city, sector: "Restaurantes", phone: null, rating: null, reviewCount: null },
    opportunityScore: 50,
    confidence: "MEDIUM",
    evidenceCoverage: 0.9,
    status: "OPORTUNIDAD_MEDIA",
    problems: [],
    recommendation: null,
    estimatedValueEur: null,
    reasons: [],
    analysis: null,
    error: null,
  };
}

describe("identidad de negocio", () => {
  it("trata el mismo negocio hallado dos veces como uno solo", () => {
    // Encontrado bajo "Restaurantes" y bajo "Hoteles", con www y sin www.
    const first = businessKey({ name: "Can Bonastre", website: "https://www.canbonastre.cat/", city: "Begur" });
    const second = businessKey({ name: "can bonastre ", website: "https://canbonastre.cat/menu", city: "begur" });

    expect(first).toBe(second);
  });

  it("no confunde dos negocios con el mismo nombre en pueblos distintos", () => {
    expect(businessKey({ name: "Ca la Maria", website: null, city: "Roses" })).not.toBe(
      businessKey({ name: "Ca la Maria", website: null, city: "Blanes" })
    );
  });
});

describe("checkpoint en disco", () => {
  it("conserva lo analizado cuando el proceso muere", () => {
    const dir = tempDir();
    const first = new FileCheckpoint(dir);

    first.appendRecord(record("Uno", "https://uno.cat", "Roses"));
    first.appendRecord(record("Dos", "https://dos.cat", "Roses"));

    // Otro proceso, arrancado después de que el primero muriera.
    const second = new FileCheckpoint(dir);
    expect(second.loadRecords().map((r) => r.business.name)).toEqual(["Uno", "Dos"]);
  });

  it("sobrevive a una línea truncada a media escritura", () => {
    const dir = tempDir();
    const checkpoint = new FileCheckpoint(dir);
    checkpoint.appendRecord(record("Uno", "https://uno.cat", "Roses"));
    checkpoint.appendRecord(record("Dos", "https://dos.cat", "Roses"));

    // Exactamente lo que deja un SIGHUP en mitad de un append.
    appendFileSync(resolve(dir, "records.jsonl"), '{"business":{"name":"Tr');

    const reloaded = new FileCheckpoint(dir);
    const records = reloaded.loadRecords();

    expect(records).toHaveLength(2);
    expect(reloaded.corruptLines).toBe(1);
  });

  it("no reutiliza el descubrimiento de otro ámbito", () => {
    const dir = tempDir();
    const checkpoint = new FileCheckpoint(dir);
    const snapshot: DiscoverySnapshot = {
      discovered: 3,
      unique: [{ name: "Uno", source: "osm" } as never],
      sources: [],
      emptyQueries: [],
    };

    const roses = discoveryScope({ municipalities: ["Roses"], categories: ["Restaurantes"], maxPerQuery: 20 });
    const blanes = discoveryScope({ municipalities: ["Blanes"], categories: ["Restaurantes"], maxPerQuery: 20 });
    checkpoint.saveDiscovery(roses, snapshot);

    expect(checkpoint.loadDiscovery(roses)?.unique).toHaveLength(1);
    // Reutilizarlo aquí analizaría Roses creyendo que analiza Blanes.
    expect(checkpoint.loadDiscovery(blanes)).toBeNull();
  });

  it("no revienta con un fichero de descubrimiento corrupto", () => {
    const dir = tempDir();
    writeFileSync(resolve(dir, "discovery.json"), "{no es json");

    expect(new FileCheckpoint(dir).loadDiscovery("cualquiera")).toBeNull();
  });
});

describe("reanudación del lote", () => {
  it("no vuelve a visitar un negocio ya analizado", async () => {
    const previous = [record("Ya visto", "https://yavisto.cat", "Roses")];

    const result = await analyzePortfolio(
      [
        { name: "Ya visto", website_url: "https://yavisto.cat", city: "Roses", source: "osm" } as never,
        { name: "Sin web", website_url: null, city: "Roses", source: "osm" } as never,
      ],
      { settings: SETTINGS, previous }
    );

    // Si hubiera reintentado "Ya visto" habría salido por red y fallado.
    expect(result.records).toHaveLength(2);
    expect(result.records[0]!.status).toBe("OPORTUNIDAD_MEDIA");
    expect(result.records[0]!.error).toBeNull();
    expect(result.records[1]!.status).toBe("SIN_WEB");
  });

  it("entrega cada negocio en cuanto termina, no al final", async () => {
    const checkpoint = new MemoryCheckpoint();
    const seenDuringRun: number[] = [];

    await analyzePortfolio(
      [
        { name: "A", website_url: null, city: "Roses", source: "osm" } as never,
        { name: "B", website_url: null, city: "Roses", source: "osm" } as never,
        { name: "C", website_url: null, city: "Roses", source: "osm" } as never,
      ],
      {
        settings: SETTINGS,
        onRecord: (produced) => {
          checkpoint.appendRecord(produced);
          seenDuringRun.push(checkpoint.loadRecords().length);
        },
      }
    );

    // Uno, dos, tres — no "tres" tres veces al terminar.
    expect(seenDuringRun).toEqual([1, 2, 3]);
  });

  it("no reescribe lo reanudado, para no duplicarlo en disco", async () => {
    const checkpoint = new MemoryCheckpoint();
    const previous = [record("Ya visto", "https://yavisto.cat", "Roses")];
    const written: string[] = [];

    await analyzePortfolio(
      [{ name: "Ya visto", website_url: "https://yavisto.cat", city: "Roses", source: "osm" } as never],
      {
        settings: SETTINGS,
        previous,
        onRecord: (produced) => {
          checkpoint.appendRecord(produced);
          written.push(produced.business.name);
        },
      }
    );

    expect(written).toEqual([]);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runAutonomousCycle, listCycles, resetCycles, saveCycle } from "./autonomous-cycle";
import {
  chooseNextObjective,
  coverage,
  DEFAULT_CYCLE_BUDGET,
  staleMunicipalities,
  unexploredMunicipalities,
} from "./next-objective";
import { applyAdjustments, pendingAdjustments } from "./apply-learning";
import { MockAgencyRepository } from "@/lib/database/mock-repository";
import { mockStore } from "@/lib/database/mock-store";
import { startTestServer, BAD_PAGE, type TestServer } from "@/backend/scanner/test-server";
import {
  queryEvents,
  recordOutcome,
  recordSourceQuery,
  resetMemory,
  type LeadOutcome,
} from "@/lib/memory/research-memory";
import { resetErrorMemory } from "@/lib/memory/error-memory";
import { resetExperiments } from "@/lib/memory/experiments";
import type { DiscoveryPort } from "@/backend/research/run-research";

/**
 * FASE 5.5 / 5.6 — the unattended cycle.
 *
 * What is being demonstrated: the system picks its own objective, says why in
 * terms that can be checked, respects its budget, records what it did, and
 * gets *better* at choosing once real sales exist — without ever loosening a
 * verification rule to do it.
 */

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer({
    "/malo": { body: BAD_PAGE },
    "/robots.txt": { body: "User-agent: *", headers: { "Content-Type": "text/plain" } },
  });
});

afterAll(async () => {
  await server.close();
});

const NOW = new Date("2026-02-17T09:00:00Z");

function discovery(): DiscoveryPort {
  let call = 0;
  return {
    isActive: true,
    async search({ query }) {
      call += 1;
      const city = query.split(" en ").pop() ?? "Blanes";
      return {
        records: [
          {
            name: `Negocio ${call}`,
            source: "openstreetmap" as const,
            city,
            address: `Carrer ${call}, ${city}`,
            phone: `+3497240000${call}`,
            website_url: `${server.url}/malo`,
            sector: "Hostelería",
          },
        ],
        errors: [],
      };
    },
  };
}

/** n outcomes in a municipality, of which `won` closed. */
function sales(municipality: string, total: number, won: number) {
  for (let i = 0; i < total; i++) {
    recordOutcome({
      businessId: `b-${municipality}-${i}`,
      outcome: (i < won ? "WON" : "LOST") as LeadOutcome,
      scoreAtTime: 70,
      confidenceAtTime: 0.85,
      recommendedService: null,
      soldService: null,
      municipality,
      sector: "Hostelería",
      businessSource: "openstreetmap",
      factorsAtTime: null,
      notes: null,
    });
  }
}

function sweptAt(municipality: string, at: string) {
  recordSourceQuery(
    {
      source: "openstreetmap",
      municipality,
      sector: "Hostelería",
      category: "Restaurantes",
      returned: 10,
      usable: 7,
      ok: true,
      durationMs: 400,
      error: null,
    },
    { runId: "run-old", at }
  );
}

beforeEach(() => {
  mockStore.businesses = [];
  mockStore.scores = [];
  mockStore.websiteScans = [];
  resetMemory();
  resetErrorMemory();
  resetExperiments();
  resetCycles();
});

describe("elección autónoma del siguiente objetivo", () => {
  it("sin historial, explora y lo dice explícitamente", () => {
    const choice = chooseNextObjective({ now: NOW });

    expect(choice.mode).toBe("exploration");
    expect(choice.sampleSize).toBe(0);
    expect(choice.reason).toMatch(/no se ha investigado nunca|No hay evidencia histórica/i);
    expect(choice.municipalities.length).toBe(DEFAULT_CYCLE_BUDGET.municipalitiesPerCycle);
  });

  it("NO inventa una estadística de rendimiento cuando no la tiene", () => {
    const choice = chooseNextObjective({ now: NOW });

    // Nada que suene a medición: ni porcentajes ni ratios inventados.
    expect(choice.reason).not.toMatch(/\d+%\s*de\s*(cierre|éxito)/i);
    expect(choice.sampleSize).toBe(0);
  });

  it("con ventas reales suficientes, explota el municipio que cierra mejor", () => {
    sales("Blanes", 20, 18);
    sales("Roses", 20, 1);

    const choice = chooseNextObjective({ now: NOW });

    expect(choice.mode).toBe("exploitation");
    expect(choice.municipalities[0]).toBe("Blanes");
    expect(choice.sampleSize).toBeGreaterThanOrEqual(20);
    expect(choice.reason).toContain("desenlaces");
  });

  it("unas pocas ventas NO bastan para explotar: sigue explorando", () => {
    sales("Blanes", 4, 4);

    const choice = chooseNextObjective({ now: NOW });
    expect(choice.mode).toBe("exploration");
    expect(choice.sampleSize).toBe(0);
  });

  it("revisa lo que ha envejecido antes que nada", () => {
    // Barrido hace 60 días: por encima del umbral de revisión.
    sweptAt("Cadaqués", "2025-12-15T09:00:00Z");
    // Y ventas de sobra en otro sitio, que aun así no deben ganar.
    sales("Blanes", 20, 18);

    const choice = chooseNextObjective({ now: NOW });

    expect(choice.mode).toBe("revisit");
    expect(choice.municipalities).toContain("Cadaqués");
    expect(choice.reason).toContain("días");
  });

  it("un barrido reciente no dispara revisión", () => {
    sweptAt("Cadaqués", "2026-02-10T09:00:00Z"); // 7 días

    expect(staleMunicipalities(NOW)).toEqual([]);
    expect(chooseNextObjective({ now: NOW }).mode).not.toBe("revisit");
  });

  it("un objetivo explícito manda sobre cualquier heurística", () => {
    sales("Blanes", 30, 28);

    const choice = chooseNextObjective({
      now: NOW,
      explicit: { statement: "Quiero Palamós.", municipalities: ["Palamós"] },
    });

    expect(choice.mode).toBe("explicit");
    expect(choice.municipalities).toEqual(["Palamós"]);
    expect(choice.reason).toContain("explícitamente");
  });

  it("la cobertura se lee del log, no de un contador aparte", () => {
    expect(unexploredMunicipalities().length).toBe(coverage().length);

    sweptAt("Blanes", "2026-02-16T09:00:00Z");

    const blanes = coverage().find((entry) => entry.municipality === "Blanes")!;
    expect(blanes.queries).toBe(1);
    expect(blanes.businessesFound).toBe(7);
    expect(unexploredMunicipalities().some((e) => e.municipality === "Blanes")).toBe(false);
  });
});

describe("ciclo autónomo completo", () => {
  it("elige, investiga y deja constancia de todo sin intervención", async () => {
    const record = await runAutonomousCycle({
      repository: new MockAgencyRepository(),
      trigger: "test",
      discovery: discovery(),
      disableMobile: true,
      scanOptions: { allowLoopbackForTesting: true },
      now: () => NOW,
    });

    expect(record.status).toBe("COMPLETED");
    expect(record.selectionMode).toBe("exploration");
    expect(record.selectionReason.length).toBeGreaterThan(0);
    expect(record.targetsExecuted).toBeGreaterThan(0);
    expect(record.report).not.toBeNull();
    expect(record.finishedAt).not.toBe("");

    // La decisión queda en la memoria, con su modo y su muestra.
    const decisions = queryEvents({ type: "DECISION_MADE" });
    const objective = decisions.find((e) => e.summary.startsWith("Siguiente objetivo"));
    expect(objective).toBeDefined();
    expect(objective!.data.mode).toBe("exploration");
    expect(objective!.data.sampleSize).toBe(0);
  });

  it("respeta el presupuesto del ciclo aunque el plan quiera más", async () => {
    const record = await runAutonomousCycle({
      repository: new MockAgencyRepository(),
      trigger: "test",
      discovery: discovery(),
      disableMobile: true,
      scanOptions: { allowLoopbackForTesting: true },
      now: () => NOW,
      budget: { municipalitiesPerCycle: 1, maxLeads: 2, maxDurationMs: 60_000 },
    });

    expect(record.targetsExecuted).toBeLessThanOrEqual(1);
    expect(record.leadsProduced).toBeLessThanOrEqual(2);
  });

  it("un fallo del ciclo se registra en lugar de propagarse", async () => {
    const broken: DiscoveryPort = {
      isActive: true,
      async search() {
        throw new Error("Overpass caído");
      },
    };

    const record = await runAutonomousCycle({
      repository: new MockAgencyRepository(),
      trigger: "test",
      discovery: broken,
      disableMobile: true,
      now: () => NOW,
    });

    // El descubrimiento falla por objetivo, así que el ciclo termina bien
    // pero sin leads: una fuente caída no es un fallo del ciclo.
    expect(record.status).toBe("COMPLETED");
    expect(record.leadsProduced).toBe(0);
  });

  it("dos ciclos seguidos no repiten el mismo municipio a ciegas", async () => {
    const options = {
      repository: new MockAgencyRepository(),
      trigger: "test" as const,
      discovery: discovery(),
      disableMobile: true,
      scanOptions: { allowLoopbackForTesting: true },
      budget: { municipalitiesPerCycle: 1, maxLeads: 5, maxDurationMs: 60_000 },
    };

    const first = await runAutonomousCycle({ ...options, now: () => NOW });
    const second = await runAutonomousCycle({ ...options, now: () => NOW });

    // El primero deja rastro de cobertura, así que el segundo elige otro.
    expect(second.goal.municipalities).not.toEqual(first.goal.municipalities);
  });

  it("guarda el ciclo con su coste, su duración y su resultado", async () => {
    const record = await runAutonomousCycle({
      repository: new MockAgencyRepository(),
      trigger: "cron",
      discovery: discovery(),
      disableMobile: true,
      scanOptions: { allowLoopbackForTesting: true },
      now: () => NOW,
    });
    saveCycle(record);

    const [saved] = listCycles();
    expect(saved.trigger).toBe("cron");
    expect(typeof saved.durationMs).toBe("number");
    expect(typeof saved.estimatedCostUsd).toBe("number");
    expect(saved.stoppedBecause.length).toBeGreaterThan(0);
  });
});

describe("aplicación de lo aprendido", () => {
  it("sin evidencia suficiente no aplica nada", () => {
    sales("Blanes", 4, 4);

    const applied = applyAdjustments().filter((a) => a.applied);
    expect(applied).toEqual([]);
  });

  it("con evidencia suficiente aplica y deja el motivo con la muestra", () => {
    sales("Blanes", 25, 22);
    sales("Roses", 25, 2);

    const adjustments = applyAdjustments();
    const blanes = adjustments.find((a) => a.target === "Blanes")!;

    expect(blanes.applied).toBe(true);
    expect(blanes.area).toBe("municipality_order");
    expect(blanes.sampleSize).toBeGreaterThanOrEqual(25);
    expect(blanes.reason).toContain("desenlaces reales");
  });

  it("NUNCA aplica un cambio sobre un área prohibida, por mucha evidencia que haya", () => {
    for (let i = 0; i < 60; i++) {
      recordOutcome({
        businessId: `b${i}`,
        outcome: i < 55 ? "WON" : "LOST",
        scoreAtTime: 95,
        confidenceAtTime: 0.95,
        recommendedService: "SEO local",
        soldService: "SEO local",
        municipality: null,
        sector: null,
        businessSource: null,
        factorsAtTime: { necesidad: 25 },
        notes: null,
      });
    }

    for (const adjustment of applyAdjustments()) {
      if (!adjustment.applied) continue;
      // Solo pueden aplicarse áreas autónomas declaradas.
      expect(["municipality_order", "sector_order", "source_priority", "query_strategy"]).toContain(
        adjustment.area
      );
    }
  });

  it("los rechazos también se registran, no se ocultan", () => {
    sales("Blanes", 3, 3);
    applyAdjustments();

    const refusals = queryEvents({ type: "DECISION_MADE" }).filter((e) =>
      e.summary.startsWith("Ajuste NO aplicado")
    );
    // Puede no haber ninguno si no hay ni propuesta; si la hay, lleva motivo.
    for (const refusal of refusals) {
      expect(refusal.summary).toContain("Motivo:");
    }
  });

  it("pendingAdjustments no muta nada por sí solo", () => {
    sales("Blanes", 25, 22);

    const before = queryEvents().length;
    pendingAdjustments();
    expect(queryEvents().length).toBe(before);
  });
});

describe("el aprendizaje cambia la decisión, y se nota", () => {
  it("el mismo sistema elige distinto antes y después de tener ventas", () => {
    const sinVentas = chooseNextObjective({ now: NOW });
    expect(sinVentas.mode).toBe("exploration");

    sales("Palamós", 22, 20);
    sales("Roses", 22, 1);

    const conVentas = chooseNextObjective({ now: NOW });
    expect(conVentas.mode).toBe("exploitation");
    expect(conVentas.municipalities[0]).toBe("Palamós");
    expect(conVentas.sampleSize).toBeGreaterThan(sinVentas.sampleSize);
  });
});

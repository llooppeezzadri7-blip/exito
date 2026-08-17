import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runAutonomousResearch } from "./autonomous-run";
import { buildPlan } from "./planner";
import { MockAgencyRepository } from "@/lib/database/mock-repository";
import { mockStore } from "@/lib/database/mock-store";
import { startTestServer, BAD_PAGE, GOOD_PAGE, type TestServer } from "@/backend/scanner/test-server";
import { queryEvents, resetMemory } from "@/lib/memory/research-memory";
import { resetErrorMemory } from "@/lib/memory/error-memory";
import type { DiscoveryPort } from "@/backend/research/run-research";
import type { ResearchGoal } from "./types";

/**
 * FASE 4.10 — the autonomous mode, end to end.
 *
 * Only discovery is substituted (there is no outbound network here and the
 * open sources must not be hit from a test). Everything downstream is the
 * real code: real HTTP against a loopback server, the real scanner, the real
 * scoring model, the real triage and the real report.
 */

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer({
    "/bueno": { body: GOOD_PAGE },
    "/malo": { body: BAD_PAGE },
    "/robots.txt": { body: "User-agent: *", headers: { "Content-Type": "text/plain" } },
  });
});

afterAll(async () => {
  await server.close();
});

const GOAL: ResearchGoal = {
  statement: "Encuentra prospectos en Blanes y Roses.",
  zone: "Costa Brava",
  maxLeads: 10,
  maxDepth: "profunda",
  municipalities: ["Blanes", "Roses"],
  sectors: ["Hostelería"],
};

/** Emits businesses named after the municipality asked for, so each target is distinguishable. */
function discoveryPerTarget(): DiscoveryPort {
  let call = 0;
  return {
    isActive: true,
    async search({ query }) {
      call += 1;
      const municipality = query.split(" en ").pop() ?? "Desconocido";
      return {
        records: [
          {
            name: `Restaurant Bo ${call}`,
            source: "openstreetmap" as const,
            city: municipality,
            address: `Carrer Gran ${call}, ${municipality}`,
            phone: `+3497200000${call}`,
            website_url: `${server.url}/malo`,
            sector: "Hostelería",
          },
          {
            name: `Marisquería Mal ${call}`,
            source: "openstreetmap" as const,
            city: municipality,
            address: `Passeig ${call}, ${municipality}`,
            phone: `+3497211111${call}`,
            website_url: `${server.url}/bueno`,
            sector: "Hostelería",
          },
        ],
        errors: [],
      };
    },
  };
}

const scanOptions = { allowLoopbackForTesting: true } as const;

beforeEach(() => {
  mockStore.businesses = [];
  mockStore.scores = [];
  mockStore.websiteScans = [];
  resetMemory();
  resetErrorMemory();
});

describe("FASE 4.10 — modo autónomo de extremo a extremo", () => {
  it("planifica, investiga varios objetivos, tría y entrega un informe", async () => {
    const repository = new MockAgencyRepository();
    const phases: string[] = [];

    const result = await runAutonomousResearch({
      goal: GOAL,
      repository,
      discovery: discoveryPerTarget(),
      disableMobile: true,
      scanOptions,
      maxTargets: 3,
      now: () => new Date("2026-02-10T09:00:00Z"),
      onProgress: (progress) => phases.push(progress.phase),
    });

    expect(result.plan.targets.length).toBeGreaterThan(0);
    expect(result.targets.filter((t) => !t.skipped).length).toBe(3);
    expect(result.leads.length).toBeGreaterThan(0);
    expect(phases[0]).toBe("PLANNING");
    expect(phases.at(-1)).toBe("DONE");

    // El informe existe y cita el objetivo real del usuario.
    expect(result.report.topLeads.length).toBeGreaterThan(0);
    expect(result.report.summary.lines.join(" ")).toContain(GOAL.statement);
    expect(result.report.text).toContain("MEJORES OPORTUNIDADES");
  });

  it("ordena los leads por puntuación y, a igualdad, por evidencia", async () => {
    const repository = new MockAgencyRepository();
    const result = await runAutonomousResearch({
      goal: GOAL,
      repository,
      discovery: discoveryPerTarget(),
      disableMobile: true,
      scanOptions,
      maxTargets: 2,
      now: () => new Date("2026-02-10T09:00:00Z"),
    });

    for (let i = 1; i < result.leads.length; i++) {
      const previous = result.leads[i - 1];
      const current = result.leads[i];
      expect(previous.score).toBeGreaterThanOrEqual(current.score);
      if (previous.score === current.score) {
        expect(previous.confidence).toBeGreaterThanOrEqual(current.confidence);
      }
    }
  });

  it("respeta el tope de leads y no ejecuta objetivos de más", async () => {
    const repository = new MockAgencyRepository();
    const result = await runAutonomousResearch({
      goal: { ...GOAL, maxLeads: 2 },
      repository,
      discovery: discoveryPerTarget(),
      disableMobile: true,
      scanOptions,
      maxTargets: 4,
      now: () => new Date("2026-02-10T09:00:00Z"),
    });

    expect(result.leads.length).toBeLessThanOrEqual(2);
    expect(result.targets.some((t) => t.skipped)).toBe(true);
    expect(result.stoppedBecause).toContain("2 leads");
  });

  it("registra cada decisión de triaje en la memoria", async () => {
    const repository = new MockAgencyRepository();
    const result = await runAutonomousResearch({
      goal: GOAL,
      repository,
      discovery: discoveryPerTarget(),
      disableMobile: true,
      scanOptions,
      maxTargets: 1,
      now: () => new Date("2026-02-10T09:00:00Z"),
    });

    const decisions = queryEvents({ type: "DECISION_MADE" });
    // Una por negocio analizado, más el plan.
    expect(decisions.length).toBeGreaterThanOrEqual(result.decisions.length);
    expect(decisions.some((e) => e.summary.startsWith("Plan creado"))).toBe(true);
    for (const decision of result.decisions) {
      expect(decisions.some((e) => e.businessId === decision.businessId)).toBe(true);
    }

    const conclusion = queryEvents({ type: "CONCLUSION_REACHED" });
    expect(conclusion.some((e) => e.summary.includes("Investigación autónoma terminada"))).toBe(true);
  });

  it("un objetivo que falla no detiene el plan", async () => {
    const repository = new MockAgencyRepository();
    let call = 0;
    const flaky: DiscoveryPort = {
      isActive: true,
      async search({ query }) {
        call += 1;
        if (call === 1) throw new Error("fuente caída");
        return {
          records: [
            {
              name: `Bar ${call}`,
              source: "openstreetmap" as const,
              city: query.split(" en ").pop() ?? undefined,
              address: `Carrer ${call}`,
              phone: `+3497233333${call}`,
              website_url: `${server.url}/malo`,
              sector: "Hostelería",
            },
          ],
          errors: [],
        };
      },
    };

    const result = await runAutonomousResearch({
      goal: GOAL,
      repository,
      discovery: flaky,
      disableMobile: true,
      scanOptions,
      maxTargets: 2,
      now: () => new Date("2026-02-10T09:00:00Z"),
    });

    expect(result.targets[0].reason).toContain("falló");
    expect(result.targets.filter((t) => !t.skipped).length).toBe(2);
    expect(result.leads.length).toBeGreaterThan(0);
  });

  it("acepta un plan ya aprobado en lugar de generar uno nuevo", async () => {
    const repository = new MockAgencyRepository();
    const approved = buildPlan(GOAL, { now: new Date("2026-02-10T09:00:00Z") });

    const result = await runAutonomousResearch({
      goal: GOAL,
      repository,
      plan: approved,
      discovery: discoveryPerTarget(),
      disableMobile: true,
      scanOptions,
      maxTargets: 1,
      now: () => new Date("2026-02-10T09:00:00Z"),
    });

    expect(result.plan).toBe(approved);
  });
});

describe("FASE 4.11 — informe final", () => {
  it("declara explícitamente lo que no se ha podido verificar", async () => {
    const repository = new MockAgencyRepository();
    const result = await runAutonomousResearch({
      goal: GOAL,
      repository,
      discovery: discoveryPerTarget(),
      disableMobile: true,
      scanOptions,
      maxTargets: 2,
      now: () => new Date("2026-02-10T09:00:00Z"),
    });

    const text = result.report.notVerified.lines.join(" ");
    expect(result.report.notVerified.lines.length).toBeGreaterThan(0);
    // Sin competidores suficientes el factor queda sin evaluar, y debe decirse.
    expect(text).toMatch(/competidores|evidencia|web/);
    // La ausencia de web nunca se afirma como hecho.
    expect(text).not.toContain("no tienen web.");
  });

  it("no afirma patrones sin casos suficientes", async () => {
    const repository = new MockAgencyRepository();
    const result = await runAutonomousResearch({
      goal: GOAL,
      repository,
      discovery: discoveryPerTarget(),
      disableMobile: true,
      scanOptions,
      maxTargets: 1,
      now: () => new Date("2026-02-10T09:00:00Z"),
    });

    // Un solo objetivo produce 2 negocios: por debajo del mínimo de 3 por grupo.
    expect(result.report.patterns.lines.join(" ")).toContain("No hay suficientes casos");
  });

  it("cada lead del informe explica por qué está donde está", async () => {
    const repository = new MockAgencyRepository();
    const result = await runAutonomousResearch({
      goal: GOAL,
      repository,
      discovery: discoveryPerTarget(),
      disableMobile: true,
      scanOptions,
      maxTargets: 2,
      now: () => new Date("2026-02-10T09:00:00Z"),
    });

    for (const lead of result.report.topLeads) {
      expect(lead.whyItRanks).toContain(`${lead.score}/100`);
      expect(lead.mainFinding.length).toBeGreaterThan(0);
      expect(["VERIFICADO", "PROBABLE", "NO_VERIFICADO"]).toContain(lead.verificationStatus);
    }
  });

  it("recoge la cobertura objetivo por objetivo, incluidos los no ejecutados", async () => {
    const repository = new MockAgencyRepository();
    const result = await runAutonomousResearch({
      goal: { ...GOAL, maxLeads: 2 },
      repository,
      discovery: discoveryPerTarget(),
      disableMobile: true,
      scanOptions,
      maxTargets: 3,
      now: () => new Date("2026-02-10T09:00:00Z"),
    });

    expect(result.report.coverage.lines.length).toBe(3);
    expect(result.report.coverage.lines.some((line) => line.includes("NO investigado"))).toBe(true);
  });
});

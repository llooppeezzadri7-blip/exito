import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryPersistence, WriteQueue } from "./persistence";
import {
  flushMemory,
  hydrateMemory,
  memoryPersistenceStatus,
  queryEvents,
  recordEvent,
  recordSourceQuery,
  resetMemory,
  setMemoryPersistence,
} from "./research-memory";
import {
  attachRegressionTest,
  hydrateErrors,
  listErrors,
  markFixed,
  recordError,
  resetErrorMemory,
} from "./error-memory";
import {
  concludeExperiment,
  createExperiment,
  hydrateExperiments,
  listExperiments,
  recordObservation,
  resetExperiments,
} from "./experiments";
import { sourcePerformance } from "./learning";

/**
 * FASE 5.2 — durability.
 *
 * The property under test is the one that matters for autonomy: what the
 * system learned in one process is still there in the next. A "restart" here
 * is a real one from the cache's point of view — `resetMemory()` empties it
 * completely, and everything that comes back has to come back through the
 * persistence port.
 */

function restart(persistence: InMemoryPersistence) {
  resetMemory();
  resetErrorMemory();
  resetExperiments();
  setMemoryPersistence(persistence);
}

let persistence: InMemoryPersistence;

beforeEach(() => {
  persistence = new InMemoryPersistence();
  resetMemory();
  resetErrorMemory();
  resetExperiments();
  setMemoryPersistence(persistence);
});

describe("memoria persistente", () => {
  it("los eventos sobreviven a un reinicio del proceso", async () => {
    recordSourceQuery(
      {
        source: "openstreetmap",
        municipality: "Blanes",
        sector: "Hostelería",
        category: "Restaurantes",
        returned: 20,
        usable: 14,
        ok: true,
        durationMs: 900,
        error: null,
      },
      { runId: "run-1" }
    );
    await flushMemory();

    expect(queryEvents({ type: "SOURCE_QUERIED" })).toHaveLength(1);

    restart(persistence);
    expect(queryEvents({ type: "SOURCE_QUERIED" })).toHaveLength(0);

    await hydrateMemory();

    const restored = queryEvents({ type: "SOURCE_QUERIED" });
    expect(restored).toHaveLength(1);
    expect(restored[0].municipality).toBe("Blanes");
    expect(restored[0].data.usable).toBe(14);
  });

  it("el aprendizaje calculado tras reiniciar es el mismo que antes", async () => {
    for (let i = 0; i < 12; i++) {
      recordSourceQuery(
        {
          source: "openstreetmap",
          municipality: "Roses",
          sector: "Hostelería",
          category: "Restaurantes",
          returned: 10,
          usable: 6,
          ok: true,
          durationMs: 500,
          error: null,
        },
        { runId: `run-${i}` }
      );
    }
    await flushMemory();

    const before = sourcePerformance();
    expect(before[0].sampleSufficient).toBe(true);

    restart(persistence);
    await hydrateMemory();

    const after = sourcePerformance();
    expect(after).toEqual(before);
  });

  it("hidratar dos veces no duplica eventos", async () => {
    recordEvent({
      type: "CONCLUSION_REACHED",
      runId: "run-1",
      businessId: null,
      businessName: "Can Prova",
      municipality: "Blanes",
      sector: null,
      source: null,
      summary: "Puntuado 70/100.",
      data: {},
    });
    await flushMemory();

    await hydrateMemory();
    await hydrateMemory();

    expect(queryEvents({ type: "CONCLUSION_REACHED" })).toHaveLength(1);
  });

  it("hidratar no descarta lo ocurrido desde el arranque", async () => {
    recordEvent({
      type: "CONCLUSION_REACHED",
      runId: "run-1",
      businessId: null,
      businessName: "Antiguo",
      municipality: null,
      sector: null,
      source: null,
      summary: "Antes del reinicio.",
      data: {},
    });
    await flushMemory();

    restart(persistence);

    // Trabajo hecho antes de que termine la hidratación.
    recordEvent({
      type: "CONCLUSION_REACHED",
      runId: "run-2",
      businessId: null,
      businessName: "Nuevo",
      municipality: null,
      sector: null,
      source: null,
      summary: "Después del reinicio, antes de hidratar.",
      data: {},
    });

    await hydrateMemory();

    const names = queryEvents({ type: "CONCLUSION_REACHED" }).map((e) => e.businessName);
    expect(names).toContain("Antiguo");
    expect(names).toContain("Nuevo");
  });

  it("los ids no colisionan entre procesos distintos", async () => {
    recordEvent({
      type: "DECISION_MADE",
      runId: null,
      businessId: null,
      businessName: null,
      municipality: null,
      sector: null,
      source: null,
      summary: "Proceso A.",
      data: {},
    });
    await flushMemory();

    // Un segundo proceso empieza con la caché vacía y escribe su primer evento.
    restart(persistence);
    recordEvent({
      type: "DECISION_MADE",
      runId: null,
      businessId: null,
      businessName: null,
      municipality: null,
      sector: null,
      source: null,
      summary: "Proceso B.",
      data: {},
    });
    await flushMemory();
    await hydrateMemory();

    const summaries = queryEvents({ type: "DECISION_MADE" }).map((e) => e.summary);
    expect(summaries).toContain("Proceso A.");
    expect(summaries).toContain("Proceso B.");
  });

  it("un fallo de persistencia no rompe la investigación, pero queda registrado", async () => {
    persistence.failWrites = true;

    expect(() =>
      recordEvent({
        type: "CONCLUSION_REACHED",
        runId: null,
        businessId: null,
        businessName: null,
        municipality: null,
        sector: null,
        source: null,
        summary: "Se puntúa igualmente.",
        data: {},
      })
    ).not.toThrow();

    await flushMemory();

    // La conclusión sigue disponible en memoria...
    expect(queryEvents({ type: "CONCLUSION_REACHED" })).toHaveLength(1);
    // ...y la escritura perdida se declara en lugar de ocultarse.
    const status = memoryPersistenceStatus();
    expect(status.lostWrites).toHaveLength(1);
    expect(status.lostWrites[0].operation).toContain("CONCLUSION_REACHED");
  });

  it("sin backend configurado la memoria sigue funcionando en el proceso", async () => {
    setMemoryPersistence(null);

    recordEvent({
      type: "DECISION_MADE",
      runId: null,
      businessId: null,
      businessName: null,
      municipality: null,
      sector: null,
      source: null,
      summary: "Sin persistencia.",
      data: {},
    });

    expect(queryEvents({ type: "DECISION_MADE" })).toHaveLength(1);
    expect(await hydrateMemory()).toBe(0);
    expect(memoryPersistenceStatus().backend).toBeNull();
  });
});

describe("errores conocidos persistentes", () => {
  it("una lección aprendida sobrevive al reinicio, con su test de regresión", async () => {
    const error = recordError({
      category: "false_absence",
      claim: "Smile Dentik no tiene web.",
      reality: "Sí tiene web propia.",
      cause: "Se tomó la ausencia del campo como afirmación.",
      detectedBy: "user",
      businessName: "Smile Dentik",
    });
    attachRegressionTest(error.id, "lib/scoring/website-absence.regression.test.ts");
    markFixed(error.id, "Regla de dos fuentes independientes.");
    await flushMemory();

    restart(persistence);
    expect(listErrors()).toHaveLength(0);

    await hydrateErrors();

    const restored = listErrors();
    expect(restored).toHaveLength(1);
    expect(restored[0].status).toBe("FIXED");
    expect(restored[0].regressionTest).toContain("website-absence");
  });
});

describe("experimentos persistentes", () => {
  it("un experimento conserva sus observaciones tras reiniciar", async () => {
    const experiment = createExperiment({
      hypothesis: "Consultar primero el registro oficial mejora la corroboración.",
      targetArea: "source_priority",
      variants: [
        { id: "osm_first", description: "OpenStreetMap primero" },
        { id: "registre_first", description: "Registre de Turisme primero" },
      ],
    });

    for (let i = 0; i < 6; i++) {
      recordObservation(experiment.id, "osm_first", 4);
      recordObservation(experiment.id, "registre_first", 9);
    }
    await flushMemory();

    restart(persistence);
    await hydrateExperiments();

    const restored = listExperiments()[0];
    expect(restored.variants.find((v) => v.id === "osm_first")?.observations).toHaveLength(6);
    expect(restored.variants.find((v) => v.id === "registre_first")?.observations).toHaveLength(6);

    // Y puede concluirse desde el proceso nuevo, con los datos del anterior.
    const concluded = concludeExperiment(restored.id);
    expect(concluded.conclusion?.verdict).toBe("winner");
    expect(concluded.conclusion?.winningVariantId).toBe("registre_first");
  });
});

describe("cola de escritura", () => {
  it("espera a todas las escrituras en vuelo", async () => {
    const queue = new WriteQueue();
    let done = 0;

    for (let i = 0; i < 5; i++) {
      queue.enqueue("test", async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        done += 1;
      });
    }

    expect(queue.pending).toBe(5);
    await queue.flush();
    expect(done).toBe(5);
    expect(queue.pending).toBe(0);
  });

  it("una escritura que falla no propaga la excepción", async () => {
    const queue = new WriteQueue();
    queue.enqueue("falla", async () => {
      throw new Error("backend caído");
    });

    await expect(queue.flush()).resolves.toBeUndefined();
    expect(queue.lostWrites).toHaveLength(1);
    expect(queue.lostWrites[0].message).toBe("backend caído");
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  assignVariants,
  concludeReady,
  ensureExperiments,
  observeCycle,
  proposeExperiments,
} from "./experiment-runner";
import {
  createExperiment,
  listExperiments,
  resetExperiments,
  MIN_OBSERVATIONS_PER_VARIANT,
} from "@/lib/memory/experiments";
import { recordSourceQuery, resetMemory } from "@/lib/memory/research-memory";
import type { BusinessSource } from "@/lib/database/types";

/**
 * FASE 5.7 — experiments that run themselves.
 *
 * The guardrail under test is the one that matters most: the system may
 * experiment with *how it looks*, never with *what it will claim*.
 */

function queries(source: BusinessSource, times: number, usable: number) {
  for (let i = 0; i < times; i++) {
    recordSourceQuery(
      {
        source,
        municipality: "Blanes",
        sector: "Hostelería",
        category: "Restaurantes",
        returned: 10,
        usable,
        ok: true,
        durationMs: 300,
        error: null,
      },
      { runId: `run-${i}` }
    );
  }
}

beforeEach(() => {
  resetMemory();
  resetExperiments();
});

describe("propuesta de experimentos", () => {
  it("no propone nada cuando no hay dos fuentes que comparar", () => {
    queries("openstreetmap", 5, 6);
    expect(proposeExperiments()).toEqual([]);
  });

  it("no propone nada cuando una fuente ya gana con claridad", () => {
    queries("openstreetmap", 5, 10);
    queries("turisme_cat", 5, 1);

    // 10 contra 1 no necesita experimento: necesita usarse.
    expect(proposeExperiments()).toEqual([]);
  });

  it("propone comparar dos fuentes de rendimiento parecido", () => {
    queries("openstreetmap", 5, 6);
    queries("turisme_cat", 5, 5);

    const [proposal] = proposeExperiments();
    expect(proposal).toBeDefined();
    expect(proposal.targetArea).toBe("source_priority");
    expect(proposal.variants).toHaveLength(2);
    expect(proposal.rationale).toContain("demasiado parecidos");
  });

  it("SOLO propone experimentos sobre áreas autónomas", () => {
    queries("openstreetmap", 5, 6);
    queries("turisme_cat", 5, 5);

    for (const proposal of proposeExperiments()) {
      expect(["query_strategy", "source_priority", "municipality_order", "sector_order", "research_depth_hint"]).toContain(
        proposal.targetArea
      );
    }
  });

  it("no duplica un experimento que ya está en curso", () => {
    queries("openstreetmap", 5, 6);
    queries("turisme_cat", 5, 5);

    ensureExperiments();
    expect(listExperiments("RUNNING")).toHaveLength(1);

    ensureExperiments();
    expect(listExperiments("RUNNING")).toHaveLength(1);
  });
});

describe("asignación de variantes", () => {
  it("reparte los ciclos entre variantes en lugar de cargar una", () => {
    createExperiment({
      hypothesis: "Orden de fuentes.",
      targetArea: "source_priority",
      variants: [
        { id: "a", description: "A primero" },
        { id: "b", description: "B primero" },
      ],
    });

    const counts = new Map<string, number>();
    for (let i = 0; i < 8; i++) {
      const [assignment] = assignVariants();
      counts.set(assignment.variantId, (counts.get(assignment.variantId) ?? 0) + 1);
      observeCycle([assignment], 5);
    }

    // Ocho ciclos, dos variantes: cuatro y cuatro, no siete y uno.
    expect(counts.get("a")).toBe(4);
    expect(counts.get("b")).toBe(4);
  });

  it("la asignación es determinista: la misma situación da la misma variante", () => {
    createExperiment({
      hypothesis: "Orden de fuentes.",
      targetArea: "source_priority",
      variants: [
        { id: "a", description: "A primero" },
        { id: "b", description: "B primero" },
      ],
    });

    expect(assignVariants()[0].variantId).toBe(assignVariants()[0].variantId);
  });
});

describe("conclusión automática", () => {
  it("NO concluye mientras falten observaciones", () => {
    const experiment = createExperiment({
      hypothesis: "Orden de fuentes.",
      targetArea: "source_priority",
      variants: [
        { id: "a", description: "A primero" },
        { id: "b", description: "B primero" },
      ],
    });

    for (let i = 0; i < MIN_OBSERVATIONS_PER_VARIANT - 1; i++) {
      observeCycle(
        [
          {
            experimentId: experiment.id,
            variantId: "a",
            variantDescription: "A",
            hypothesis: "",
            observations: i,
          },
          {
            experimentId: experiment.id,
            variantId: "b",
            variantDescription: "B",
            hypothesis: "",
            observations: i,
          },
        ],
        5
      );
    }

    expect(concludeReady()).toEqual([]);
    expect(listExperiments("RUNNING")).toHaveLength(1);
  });

  it("concluye cuando cada variante alcanza el mínimo, y nombra al ganador", () => {
    const experiment = createExperiment({
      hypothesis: "Orden de fuentes.",
      targetArea: "source_priority",
      variants: [
        { id: "a", description: "A primero" },
        { id: "b", description: "B primero" },
      ],
    });

    for (let i = 0; i < MIN_OBSERVATIONS_PER_VARIANT; i++) {
      observeCycle(
        [{ experimentId: experiment.id, variantId: "a", variantDescription: "A", hypothesis: "", observations: i }],
        3
      );
      observeCycle(
        [{ experimentId: experiment.id, variantId: "b", variantDescription: "B", hypothesis: "", observations: i }],
        9
      );
    }

    const [concluded] = concludeReady();
    expect(concluded.experiment.conclusion?.verdict).toBe("winner");
    expect(concluded.experiment.conclusion?.winningVariantId).toBe("b");
    // Área autónoma: puede adoptarse sin preguntar.
    expect(concluded.autoApplicable).toBe(true);
  });

  it("un experimento sobre una regla dura NUNCA se marca auto-aplicable", () => {
    const experiment = createExperiment({
      hypothesis: "Bajar el umbral de verificación produce más leads.",
      targetArea: "verification_rules",
      variants: [
        { id: "estricto", description: "Dos fuentes" },
        { id: "laxo", description: "Una fuente" },
      ],
    });

    for (let i = 0; i < MIN_OBSERVATIONS_PER_VARIANT; i++) {
      observeCycle(
        [{ experimentId: experiment.id, variantId: "estricto", variantDescription: "", hypothesis: "", observations: i }],
        2
      );
      observeCycle(
        [{ experimentId: experiment.id, variantId: "laxo", variantDescription: "", hypothesis: "", observations: i }],
        50
      );
    }

    const [concluded] = concludeReady();
    // La variante laxa gana por goleada...
    expect(concluded.experiment.conclusion?.winningVariantId).toBe("laxo");
    // ...y aun así el sistema no puede adoptarla por su cuenta.
    expect(concluded.autoApplicable).toBe(false);
    expect(concluded.experiment.constraint.allowed).toBe(false);
  });
});

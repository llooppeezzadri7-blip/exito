import { describe, expect, it, vi } from "vitest";
import {
  createRun,
  needsSecondResearch,
  phaseOf,
  retryablePhases,
  runPhase,
  skipPhase,
  summarize,
} from "./pipeline";

const noSleep = { sleep: async () => {} };

describe("runPhase", () => {
  it("guarda la salida de la fase completada", async () => {
    const run = createRun("b1");
    await runPhase(run, "WEB_SCAN", async () => ({ https: true }), noSleep);

    const state = phaseOf(run, "WEB_SCAN");
    expect(state.status).toBe("COMPLETED");
    expect(state.output).toEqual({ https: true });
    expect(state.attempts).toBe(1);
  });

  it("reintenta con backoff y acaba completando", async () => {
    const run = createRun("b1");
    const sleep = vi.fn().mockResolvedValue(undefined);
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ ok: true });

    await runPhase(run, "WEB_SCAN", handler, { sleep, maxAttempts: 3 });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(phaseOf(run, "WEB_SCAN").status).toBe("COMPLETED");
    expect(phaseOf(run, "WEB_SCAN").error).toBeNull();
  });

  it("marca FAILED tras agotar intentos y conserva el error", async () => {
    const run = createRun("b1");
    await runPhase(run, "WEB_SCAN", async () => {
      throw new Error("la web no responde");
    }, { ...noSleep, maxAttempts: 2 });

    const state = phaseOf(run, "WEB_SCAN");
    expect(state.status).toBe("FAILED");
    expect(state.attempts).toBe(2);
    expect(state.error).toBe("la web no responde");
  });

  it("NO pierde los datos de fases anteriores cuando una falla", async () => {
    const run = createRun("b1");
    await runPhase(run, "DISCOVERY", async () => ({ places: 12 }), noSleep);
    await runPhase(run, "WEB_SCAN", async () => {
      throw new Error("caída");
    }, { ...noSleep, maxAttempts: 1 });

    expect(phaseOf(run, "DISCOVERY").output).toEqual({ places: 12 });
    expect(phaseOf(run, "DISCOVERY").status).toBe("COMPLETED");
    expect(phaseOf(run, "WEB_SCAN").status).toBe("FAILED");
  });

  it("permite reintentar solo la fase caída", async () => {
    const run = createRun("b1");
    await runPhase(run, "DISCOVERY", async () => ({ places: 12 }), noSleep);
    await runPhase(run, "WEB_SCAN", async () => {
      throw new Error("caída");
    }, { ...noSleep, maxAttempts: 1 });

    expect(retryablePhases(run)).toEqual(["WEB_SCAN"]);

    await runPhase(run, "WEB_SCAN", async () => ({ recuperado: true }), noSleep);

    expect(retryablePhases(run)).toEqual([]);
    expect(phaseOf(run, "WEB_SCAN").output).toEqual({ recuperado: true });
    expect(phaseOf(run, "DISCOVERY").output).toEqual({ places: 12 });
  });

  it("expone a cada fase la salida de las anteriores", async () => {
    const run = createRun("b1");
    await runPhase(run, "WEB_RESOLUTION", async () => ({ url: "https://x.test" }), noSleep);

    let received: unknown;
    await runPhase(
      run,
      "WEB_SCAN",
      async (ctx) => {
        received = ctx.outputOf("WEB_RESOLUTION");
        return null;
      },
      noSleep
    );

    expect(received).toEqual({ url: "https://x.test" });
  });

  it("no expone la salida de una fase que no llegó a completarse", async () => {
    const run = createRun("b1");
    await runPhase(run, "WEB_RESOLUTION", async () => {
      throw new Error("nope");
    }, { ...noSleep, maxAttempts: 1 });

    let received: unknown = "sin tocar";
    await runPhase(
      run,
      "WEB_SCAN",
      async (ctx) => {
        received = ctx.outputOf("WEB_RESOLUTION");
        return null;
      },
      noSleep
    );

    expect(received).toBeUndefined();
  });
});

describe("skipPhase", () => {
  it("registra el motivo del salto en vez de dejarlo en blanco", () => {
    const run = createRun("b1");
    skipPhase(run, "MOBILE_SCAN", "Sin navegador disponible en este entorno");

    const state = phaseOf(run, "MOBILE_SCAN");
    expect(state.status).toBe("SKIPPED");
    expect(state.skipReason).toContain("navegador");
  });
});

describe("summarize", () => {
  it("cuenta el estado real de la investigación", async () => {
    const run = createRun("b1");
    await runPhase(run, "DISCOVERY", async () => ({}), noSleep);
    await runPhase(run, "WEB_SCAN", async () => {
      throw new Error("x");
    }, { ...noSleep, maxAttempts: 1 });
    skipPhase(run, "MOBILE_SCAN", "sin navegador");

    const summary = summarize(run);
    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.finished).toBe(false);
  });
});

describe("needsSecondResearch (§16)", () => {
  it("exige auditoría estricta por encima de 80", () => {
    expect(needsSecondResearch(85)).toEqual({ required: true, depth: "strict" });
  });

  it("exige segunda comprobación por encima de 70", () => {
    expect(needsSecondResearch(72)).toEqual({ required: true, depth: "standard" });
  });

  it("no gasta una segunda ronda en un lead que no lo merece", () => {
    expect(needsSecondResearch(69)).toEqual({ required: false, depth: "none" });
  });
});

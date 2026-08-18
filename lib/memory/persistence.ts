import type { MemoryEvent } from "./research-memory";
import type { ErrorRecord } from "./error-memory";
import type { Experiment } from "./experiments";

/**
 * FASE 5.2 — persistence port for everything the system learns.
 *
 * The design constraint that shapes this: the read side of memory is
 * synchronous and is consumed by the planner, the triage and the dashboard.
 * Making it async would ripple through modules that already work. So reads
 * stay synchronous against an in-process cache, and this port handles the two
 * moments where I/O is unavoidable:
 *
 *   - `load*` once at start-up, to rehydrate the cache;
 *   - `append`/`upsert` on write, in the background.
 *
 * The honest cost, stated rather than buried: a write that is still in flight
 * when the process dies is lost. That is acceptable for a learning log (the
 * next cycle simply has one observation fewer) and is why leads, businesses
 * and scores keep going through the transactional repository instead.
 * `flush()` exists so a cycle can wait for its own writes before reporting
 * itself finished.
 */

export interface MemoryPersistence {
  readonly name: string;
  loadEvents(limit: number): Promise<MemoryEvent[]>;
  appendEvent(event: MemoryEvent): Promise<void>;
  loadErrors(): Promise<ErrorRecord[]>;
  saveError(error: ErrorRecord): Promise<void>;
  loadExperiments(): Promise<Experiment[]>;
  saveExperiment(experiment: Experiment): Promise<void>;
}

/**
 * Reference implementation, and what the tests run against. It is a real
 * implementation of the contract — it survives a "restart" (a new cache
 * hydrated from the same instance), which is exactly the property under test.
 */
export class InMemoryPersistence implements MemoryPersistence {
  readonly name = "in-memory";
  events: MemoryEvent[] = [];
  errors: ErrorRecord[] = [];
  experiments: Experiment[] = [];
  /** Set by tests to simulate a backend that is down. */
  failWrites = false;

  async loadEvents(limit: number): Promise<MemoryEvent[]> {
    return this.events.slice(-limit);
  }

  async appendEvent(event: MemoryEvent): Promise<void> {
    if (this.failWrites) throw new Error("persistencia no disponible");
    this.events.push(event);
  }

  async loadErrors(): Promise<ErrorRecord[]> {
    return [...this.errors];
  }

  async saveError(error: ErrorRecord): Promise<void> {
    if (this.failWrites) throw new Error("persistencia no disponible");
    const index = this.errors.findIndex((e) => e.id === error.id);
    if (index >= 0) this.errors[index] = error;
    else this.errors.push(error);
  }

  async loadExperiments(): Promise<Experiment[]> {
    return [...this.experiments];
  }

  async saveExperiment(experiment: Experiment): Promise<void> {
    if (this.failWrites) throw new Error("persistencia no disponible");
    const index = this.experiments.findIndex((e) => e.id === experiment.id);
    if (index >= 0) this.experiments[index] = experiment;
    else this.experiments.push(experiment);
  }
}

/** Tracks background writes so a caller can wait for them and see failures. */
export class WriteQueue {
  private inFlight = new Set<Promise<void>>();
  private failures: { at: string; operation: string; message: string }[] = [];

  /**
   * Runs a write without blocking the caller. A rejection is recorded, not
   * thrown: a learning write that fails must never take down the research it
   * was describing.
   */
  enqueue(operation: string, work: () => Promise<void>, now: () => Date = () => new Date()): void {
    const promise = work()
      .catch((err: unknown) => {
        this.failures.push({
          at: now().toISOString(),
          operation,
          message: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        this.inFlight.delete(promise);
      });

    this.inFlight.add(promise);
  }

  async flush(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
    }
  }

  get pending(): number {
    return this.inFlight.size;
  }

  /** Writes that never landed. Surfaced in the dashboard, not swallowed. */
  get lostWrites(): { at: string; operation: string; message: string }[] {
    return [...this.failures];
  }

  reset(): void {
    this.inFlight.clear();
    this.failures = [];
  }
}

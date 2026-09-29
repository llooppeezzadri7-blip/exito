import { logger } from "../core/logger.js";
import { errMessage } from "../core/errors.js";

export interface LoopStatus {
  name: string;
  intervalMs: number;
  running: boolean;
  runs: number;
  errors: number;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
}

/**
 * Minimal in-process scheduler: named loops with fixed intervals, overlap protection, error isolation.
 * A loop that throws never stops the others (24/7 requirement); its error is recorded for the health page.
 */
export class Scheduler {
  private loops = new Map<string, { status: LoopStatus; fn: () => Promise<void>; timer: NodeJS.Timeout | null; busy: boolean }>();
  private stopped = false;

  add(name: string, intervalMs: number, fn: () => Promise<void>, opts: { runImmediately?: boolean } = {}): void {
    const status: LoopStatus = { name, intervalMs, running: false, runs: 0, errors: 0, lastRunAt: null, lastDurationMs: null, lastError: null };
    const entry = { status, fn, timer: null as NodeJS.Timeout | null, busy: false };
    this.loops.set(name, entry);
    const tick = async () => {
      if (this.stopped || entry.busy) return;
      entry.busy = true;
      status.running = true;
      const t0 = Date.now();
      try {
        await fn();
        status.runs++;
      } catch (e) {
        status.errors++;
        status.lastError = errMessage(e);
        logger.error({ loop: name, err: status.lastError }, "loop error");
      } finally {
        status.lastRunAt = new Date().toISOString();
        status.lastDurationMs = Date.now() - t0;
        status.running = false;
        entry.busy = false;
      }
    };
    entry.timer = setInterval(() => void tick(), intervalMs);
    if (opts.runImmediately) void tick();
  }

  status(): LoopStatus[] {
    return [...this.loops.values()].map((l) => ({ ...l.status }));
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const l of this.loops.values()) if (l.timer) clearInterval(l.timer);
    // wait for busy loops to finish (bounded)
    const start = Date.now();
    while ([...this.loops.values()].some((l) => l.busy) && Date.now() - start < 30_000) await new Promise((r) => setTimeout(r, 100));
  }
}

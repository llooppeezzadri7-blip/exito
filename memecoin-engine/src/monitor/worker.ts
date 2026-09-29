import type { EngineContext } from "../pipeline/context.js";
import { bump } from "../pipeline/context.js";
import { safeAnalyze } from "../pipeline/analyze-token.js";
import type { AnalysisOutcome } from "../pipeline/analyze-token.js";
import { backoffMs } from "../core/time.js";
import { errMessage } from "../core/errors.js";
import type { JobRecord } from "../db/records.js";

export type AnalysisHook = (out: AnalysisOutcome) => Promise<void>;

/**
 * Queue worker for the "analyze" queue: claims jobs (SKIP LOCKED in Postgres), runs the pipeline
 * with bounded concurrency, retries with exponential backoff and dead-letters after max attempts.
 */
export class AnalysisWorker {
  private hooks: AnalysisHook[] = [];
  public inFlight = 0;
  constructor(private readonly ctx: EngineContext, private readonly concurrency: number) {}

  onAnalysis(hook: AnalysisHook): void {
    this.hooks.push(hook);
  }

  async runOnce(): Promise<number> {
    const free = Math.max(0, this.concurrency - this.inFlight);
    if (free === 0) return 0;
    const jobs = await this.ctx.store.claimJobs("analyze", this.ctx.now().toISOString(), free);
    await Promise.all(jobs.map((j) => this.handle(j)));
    return jobs.length;
  }

  private async handle(job: JobRecord): Promise<void> {
    this.inFlight++;
    try {
      const { chain, mint } = job.payload as { chain: "solana"; mint: string };
      const token = await this.ctx.store.getToken(chain, mint);
      if (!token || token.status === "ARCHIVED") {
        await this.ctx.store.completeJob(job.id);
        return;
      }
      const out = await safeAnalyze(this.ctx, token);
      if (!out) throw new Error("analysis failed");
      for (const h of this.hooks) {
        try {
          await h(out);
        } catch (e) {
          this.ctx.log.error({ mint, err: errMessage(e) }, "analysis hook failed");
        }
      }
      await this.ctx.store.completeJob(job.id);
    } catch (e) {
      const retryAt = job.attempts < job.maxAttempts ? new Date(this.ctx.now().getTime() + backoffMs(job.attempts, 5000, 300_000)).toISOString() : null;
      await this.ctx.store.failJob(job.id, errMessage(e), retryAt);
      bump(this.ctx, retryAt ? "jobs_retried" : "jobs_dead");
    } finally {
      this.inFlight--;
    }
  }
}

/** Enqueue every token whose nextAnalyzeAt is due (dedupe prevents duplicates while queued). */
export async function enqueueDueTokens(ctx: EngineContext, limit = 200): Promise<number> {
  const due = await ctx.store.listDueTokens(ctx.now().toISOString(), limit);
  let n = 0;
  for (const t of due) {
    const id = await ctx.store.enqueueJob("analyze", { chain: t.chain, mint: t.mint }, { dedupeKey: `analyze:${t.chain}:${t.mint}`, maxAttempts: ctx.cfg.monitor.queue_max_attempts });
    if (id !== null) n++;
    // push nextAnalyzeAt forward so the same token is not re-enqueued every tick while it waits in the queue
    await ctx.store.patchToken(t.chain, t.mint, { nextAnalyzeAt: new Date(ctx.now().getTime() + 10 * 60_000).toISOString() });
  }
  return n;
}

import type { EngineContext } from "../pipeline/context.js";
import { bump } from "../pipeline/context.js";
import type { OutcomeLabel, OutcomeRecord, PredictionRecord } from "../db/records.js";
import { round } from "../core/stats.js";

/**
 * OUTCOME RESOLVER: after each prediction's horizon, look at what actually happened using the
 * token's own stored snapshots (no lookahead, no re-fetch). Labels feed the learning engine.
 */
export function labelOutcome(returnPct: number | null, liquidityAt: number | null, liquidityAfter: number | null, cfg: { bigMovePct: number; bigDropPct: number }): OutcomeLabel {
  if (liquidityAt !== null && liquidityAt > 0 && liquidityAfter !== null && liquidityAfter < liquidityAt * 0.2) return returnPct !== null && returnPct <= -80 ? "RUG" : "LIQUIDITY_DRAIN";
  if (returnPct === null) return "UNKNOWN";
  if (returnPct >= cfg.bigMovePct) return "BIG_UP";
  if (returnPct >= 20) return "UP";
  if (returnPct <= cfg.bigDropPct) return "BIG_DOWN";
  if (returnPct <= -20) return "DOWN";
  return "SIDEWAYS";
}

export async function resolveDuePredictions(ctx: EngineContext, limit = 200): Promise<number> {
  const now = ctx.now();
  const due = await ctx.store.listDuePredictions(now.toISOString(), limit);
  let n = 0;
  for (const p of due) {
    const outcome = await resolveOne(ctx, p);
    await ctx.store.insertOutcome(outcome);
    await ctx.store.markPredictionResolved(p.id);
    n++;
  }
  if (n) bump(ctx, "outcomes_resolved", n);
  return n;
}

export async function resolveOne(ctx: EngineContext, p: PredictionRecord): Promise<OutcomeRecord> {
  const series = await ctx.store.listSnapshots(p.chain, p.mint, p.madeAt, 1000);
  const horizonMs = p.horizonHours * 3_600_000;
  const end = new Date(p.madeAt).getTime() + horizonMs;
  const within = series.filter((s) => new Date(s.observedAt).getTime() <= end + horizonMs * 0.5);
  const last = within[within.length - 1] ?? null;
  const prices = within.map((s) => s.priceUsd).filter((x): x is number => typeof x === "number" && x > 0);
  const ret = (a: number | null, b: number | null) => (a && b ? round(((b - a) / a) * 100, 2) : null);
  const returnPct = ret(p.priceAt, last?.priceUsd ?? null);
  const label = last ? labelOutcome(returnPct, p.liquidityAt, last.liquidityUsd, { bigMovePct: ctx.cfg.learning.big_move_pct, bigDropPct: ctx.cfg.learning.big_drop_pct }) : "UNKNOWN";
  return {
    predictionId: p.id, chain: p.chain, mint: p.mint, horizonHours: p.horizonHours, priceAt: p.priceAt, priceAfter: last?.priceUsd ?? null, returnPct,
    maxReturnPct: prices.length && p.priceAt ? ret(p.priceAt, Math.max(...prices)) : null, minReturnPct: prices.length && p.priceAt ? ret(p.priceAt, Math.min(...prices)) : null,
    liquidityAt: p.liquidityAt, liquidityAfter: last?.liquidityUsd ?? null, label, resolvedAt: ctx.now().toISOString(),
  };
}

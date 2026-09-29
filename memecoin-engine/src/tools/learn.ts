import { buildContext } from "../engine.js";
import { learnFromOutcomes, toModelVersion } from "../learning/statistical.js";

/** `npx tsx src/tools/learn.ts [--apply]` — print the learning report; --apply stores + activates the proposal. */
const ctx = buildContext();
await ctx.store.init();
const pairs = await ctx.store.listPredictionsWithOutcomes(50_000);
const report = learnFromOutcomes(pairs, ctx.cfg.scoring.weights, ctx.cfg.learning.min_samples_for_stats, 4);
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--apply")) {
  const mv = toModelVersion(report, `stat-manual-${Date.now()}`, new Date().toISOString());
  if (mv) {
    await ctx.store.insertModelVersion({ ...mv, active: true });
    console.log("activated", mv.version, "(positive weights only; restart workers)");
  } else console.log("nothing to apply");
}
await ctx.store.close();

import { buildContext } from "../engine.js";
import { computeMetrics } from "../analyzers/metrics.js";
import { analyzeSecurity } from "../analyzers/security.js";
import { analyzeLiquidity } from "../analyzers/liquidity.js";
import { analyzeHolders } from "../analyzers/holders.js";
import { assessRugRisk } from "../risk/rug-detector.js";
import { assessPhase } from "../risk/phase.js";

/**
 * `npm run replay -- <mint> [snapshotId]` — AUDIT TRAIL: re-runs the pure analyzers over the stored
 * snapshot series up to a given snapshot, so any past alert can be reproduced from the data the bot had.
 */
const mint = process.argv[2];
const upTo = process.argv[3] ? Number(process.argv[3]) : null;
if (!mint) {
  console.error("usage: npm run replay -- <mint> [snapshotId]");
  process.exit(1);
}
const ctx = buildContext();
await ctx.store.init();
const series = (await ctx.store.listSnapshots("solana", mint, null, 2000)).filter((s) => upTo === null || (s.id ?? 0) <= upTo);
if (!series.length) {
  console.error("no snapshots stored for", mint);
  process.exit(1);
}
for (let i = 0; i < series.length; i++) {
  const sub = series.slice(0, i + 1);
  const latest = sub[sub.length - 1]!;
  const metrics = computeMetrics(sub, new Date(latest.observedAt));
  const results = [analyzeSecurity(latest.payload), analyzeLiquidity(latest.payload, metrics, ctx.cfg), analyzeHolders(latest.payload, metrics, ctx.cfg)];
  const rug = assessRugRisk(results, { extreme: ctx.cfg.risk_gates.extreme_risk_rug_threshold });
  const phase = assessPhase(metrics, ctx.cfg.no_fomo, false);
  console.log(`#${latest.id} ${latest.observedAt} price=${latest.priceUsd} liq=${latest.liquidityUsd} holders=${latest.holders} dq=${latest.dataQuality} | security=${results[0]!.score} liquidity=${results[1]!.score} holders=${results[2]!.score} rug=${rug.rugRisk} (${rug.level}) phase=${phase.phase} flags=${rug.flags.map((f) => f.code).join(",")}`);
}
const audit = await ctx.store.listAudit({ subject: `solana:${mint}`, limit: 50 });
console.log("\naudit entries:", audit.length);
for (const a of audit.reverse()) console.log(a.at, a.action, JSON.stringify(a.data).slice(0, 200));
await ctx.store.close();

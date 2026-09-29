import { buildContext } from "../engine.js";
import { paperStats } from "../paper/engine.js";

const ctx = buildContext();
await ctx.store.init();
const trades = await ctx.store.listPaperTrades({ limit: 10000 });
console.log(JSON.stringify(paperStats(trades, ctx.cfg.paper_trading.bankroll_usd), null, 2));
await ctx.store.close();

import { buildRegistry } from "../engine.js";
import type { DEXProvider, SecurityProvider, BlockchainProvider } from "../providers/types.js";

/**
 * `npm run check:sources` — pings every provider and runs one sample call each, printing what works.
 * Run this after deployment: endpoints of third-party APIs change without notice.
 */
const SAMPLE_MINT = process.argv[2] ?? "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"; // BONK (well-known mint for smoke tests)
const registry = buildRegistry();
const results: Record<string, string> = {};
for (const p of registry.list()) {
  if (!p.isConfigured()) {
    results[p.id] = "UNCONFIGURED";
    continue;
  }
  try {
    const ok = await p.ping();
    results[p.id] = ok ? "OK" : "PING_FALSE";
  } catch (e) {
    results[p.id] = `ERROR ${(e as Error).message}`;
  }
}
console.log("ping:", results);
const dex = registry.get<DEXProvider>("dexscreener");
if (dex) console.log("dexscreener.getMarket:", await dex.getMarket("solana", SAMPLE_MINT).then((m) => (m ? { price: m.priceUsd.value, liq: m.liquidityUsd.value, pairs: m.pairs.length } : null)).catch((e) => `ERROR ${e.message}`));
const gt = registry.get<DEXProvider>("geckoterminal");
if (gt) console.log("geckoterminal.getNewPools:", await gt.getNewPools("solana").then((l) => `${l.length} pools`).catch((e) => `ERROR ${e.message}`));
const rc = registry.get<SecurityProvider>("rugcheck");
if (rc) console.log("rugcheck.getReport:", await rc.getReport("solana", SAMPLE_MINT).then((r) => (r ? { riskIndex: r.riskIndex.value, risks: r.risks.length, holders: r.totalHolders.value } : null)).catch((e) => `ERROR ${e.message}`));
const bc = registry.get<BlockchainProvider>("solana-rpc");
if (bc) console.log("solana-rpc.getMintInfo:", await bc.getMintInfo("solana", SAMPLE_MINT).then((s) => ({ mint: s.mintAuthorityActive.value, freeze: s.freezeAuthorityActive.value, program: s.tokenProgram.value, supply: s.supply.value })).catch((e) => `ERROR ${e.message}`));
process.exit(0);

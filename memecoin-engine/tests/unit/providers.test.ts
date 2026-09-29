import { describe, it, expect } from "vitest";
import { toMarketSnapshot } from "../../src/providers/dexscreener/provider.js";
import { poolsToMarket, discoveredFromPool, uniqueTradersFromRaw, poolSchema } from "../../src/providers/geckoterminal/provider.js";
import { mapRugcheckReport } from "../../src/providers/rugcheck/provider.js";
import { parsePumpPortalMessage } from "../../src/providers/pumpportal/stream.js";
import { findFunder, tradeFromBalances, parseMetaplexMetadata } from "../../src/providers/solana/rpc-provider.js";
import { handleFromUrl } from "../../src/providers/social/telegram.js";
import { PublicKey } from "@solana/web3.js";

describe("DexScreener mapper", () => {
  it("aggregates pairs, picks the deepest pool as primary and extracts socials", () => {
    const pairs = [
      { chainId: "solana", dexId: "raydium", pairAddress: "P1", baseToken: { address: "M", symbol: "T" }, quoteToken: { symbol: "SOL" }, priceUsd: "0.01", txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 50, sells: 20 } }, volume: { h1: 1000, h24: 5000 }, priceChange: { h1: 12.5 }, liquidity: { usd: 20000 }, fdv: 100000, marketCap: 90000, pairCreatedAt: 1759140000000, info: { websites: [{ url: "https://t.co" }], socials: [{ type: "telegram", url: "https://t.me/x" }] } },
      { chainId: "solana", dexId: "orca", pairAddress: "P2", baseToken: { address: "M", symbol: "T" }, priceUsd: "0.0101", txns: { h1: { buys: 10, sells: 5 } }, volume: { h1: 200 }, liquidity: { usd: 5000 } },
    ] as any;
    const m = toMarketSnapshot(pairs, "2026-09-29T10:00:00.000Z");
    expect(m.primaryPair?.pairAddress).toBe("P1");
    expect(m.liquidityUsd.value).toBe(25000);
    expect(m.volumeUsd.h1).toBe(1200);
    expect(m.txns.h1).toEqual({ buys: 60, sells: 25 });
    expect(m.priceChangePct.h1).toBe(12.5);
    expect(m.socials[0]).toEqual({ type: "telegram", url: "https://t.me/x" });
    expect(m.pairCreatedAt).toBe(new Date(1759140000000).toISOString());
    expect(m.marketCapUsd.source).toBe("dexscreener");
  });
});

describe("GeckoTerminal mapper", () => {
  const pool = poolSchema.parse({ id: "solana_P", attributes: { name: "TKN / SOL", address: "P", base_token_price_usd: "0.5", pool_created_at: "2026-09-29T09:00:00Z", reserve_in_usd: "12000", fdv_usd: "100000", market_cap_usd: null, price_change_percentage: { m5: "1.5", h1: "-3" }, transactions: { h1: { buys: 10, sells: 4, buyers: 8, sellers: 3 } }, volume_usd: { h1: "900" } }, relationships: { base_token: { data: { id: "solana_MINTX" } }, dex: { data: { id: "raydium" } } } } as any);
  it("maps a new pool to a DiscoveredToken with unique-trader hints", () => {
    const d = discoveredFromPool("solana", pool, "2026-09-29T10:00:00Z")!;
    expect(d.mint).toBe("MINTX");
    expect(d.symbol).toBe("TKN");
    expect(d.liquidityUsd).toBe(12000);
    expect(uniqueTradersFromRaw(d.raw).h1).toEqual({ buyers: 8, sellers: 3 });
  });
  it("maps pools to a MarketSnapshot with UNKNOWN market cap when absent", () => {
    const m = poolsToMarket([pool]);
    expect(m.priceUsd.value).toBe(0.5);
    expect(m.marketCapUsd.value).toBeNull();
    expect(m.marketCapUsd.confidence).toBe("UNKNOWN");
    expect(m.fdvUsd.value).toBe(100000);
    expect(m.priceChangePct.h1).toBe(-3);
  });
});

describe("RugCheck mapper", () => {
  it("maps risks, lp lock, authorities and known accounts", () => {
    const r = mapRugcheckReport({ mint: "M", creator: "C", token: { mintAuthority: null, freezeAuthority: "F", supply: 1, decimals: 6 }, mintAuthority: null, freezeAuthority: "F", risks: [{ name: "Freeze Authority still enabled", level: "danger", description: "", score: 500 }], score: 1200, score_normalised: 45, rugged: false, totalHolders: 321, markets: [{ pubkey: "P", marketType: "raydium", lp: { lpLockedPct: 99.5 } }], topHolders: [{ address: "A", owner: "O", pct: 12, uiAmount: 1, insider: true }, { address: "B", owner: "POOL", pct: 30, uiAmount: 2 }], knownAccounts: { POOL: { name: "Raydium", type: "AMM" } } } as any, "2026-09-29T10:00:00Z");
    expect(r.riskIndex.value).toBe(45);
    expect(r.freezeAuthorityActive.value).toBe(true);
    expect(r.mintAuthorityActive.value).toBe(false);
    expect(r.lpLockedPct.value).toBe(99.5);
    expect(r.topHolders[0]!.label).toMatch(/insider/);
    expect(r.topHolders[1]!.isLpPool).toBe(true);
    expect(r.risks[0]!.level).toBe("danger");
  });
});

describe("PumpPortal parser", () => {
  it("parses create/migrate messages and ignores acks", () => {
    expect(parsePumpPortalMessage({ message: "Successfully subscribed" })).toBeNull();
    const t = parsePumpPortalMessage({ signature: "s", mint: "MINT", traderPublicKey: "DEP", txType: "create", name: "N", symbol: "S", bondingCurveKey: "BC", pool: "pump" })!;
    expect(t.source).toBe("pumpportal:create");
    expect(t.pairAddress).toBe("BC");
    expect((t.raw as any).deployer).toBe("DEP");
    expect(parsePumpPortalMessage({ mint: "M", txType: "buy" })).toBeNull();
  });
});

describe("Solana RPC pure helpers", () => {
  it("finds the SOL funder of a wallet from system transfer instructions", () => {
    const tx = { transaction: { message: { accountKeys: [], instructions: [{ program: "system", programId: {}, parsed: { type: "transfer", info: { source: "FUNDER", destination: "W", lamports: 1 } } }] } }, meta: { innerInstructions: [] } } as any;
    expect(findFunder(tx, "W")).toBe("FUNDER");
    expect(findFunder(tx, "OTHER")).toBeNull();
  });
  it("classifies buy/sell from token balance deltas of non-pool owners", () => {
    const tx = { transaction: { message: { accountKeys: [{ pubkey: new PublicKey("11111111111111111111111111111111"), signer: true }] } }, meta: { preTokenBalances: [{ accountIndex: 1, mint: "M", owner: "USER", uiTokenAmount: { uiAmount: 10 } }, { accountIndex: 2, mint: "M", owner: "POOL", uiTokenAmount: { uiAmount: 1000 } }], postTokenBalances: [{ accountIndex: 1, mint: "M", owner: "USER", uiTokenAmount: { uiAmount: 60 } }, { accountIndex: 2, mint: "M", owner: "POOL", uiTokenAmount: { uiAmount: 950 } }] } } as any;
    const ev = tradeFromBalances(tx, "M", "POOL")!;
    expect(ev.kind).toBe("buy");
    expect(ev.amountToken).toBe(50);
  });
  it("parses Metaplex metadata update authority and isMutable", () => {
    const ua = new PublicKey("11111111111111111111111111111111");
    const str = (s: string) => Buffer.concat([Buffer.from(Uint32Array.of(s.length).buffer), Buffer.from(s)]);
    const buf = Buffer.concat([Buffer.from([4]), ua.toBuffer(), ua.toBuffer(), str("name"), str("SYM"), str("uri"), Buffer.from([0, 0]), Buffer.from([0]), Buffer.from([1]), Buffer.from([1])]);
    expect(parseMetaplexMetadata(buf)).toEqual({ updateAuthority: ua.toBase58(), isMutable: true });
  });
  it("extracts telegram handles and rejects private invites", () => {
    expect(handleFromUrl("https://t.me/mycoin")).toBe("mycoin");
    expect(handleFromUrl("https://t.me/+abc123")).toBeNull();
  });
});

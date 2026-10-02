import type { Tier } from "../core/types.js";
import { dp, isKnown, unknown } from "../core/types.js";
import type { DeployerInfo, HoldersSnapshot, MarketSnapshot, SocialSnapshot, TokenSnapshot, TradeEvent, WalletProfile, Candle } from "../core/model.js";
import type { BlockchainProvider, DEXProvider, SecurityProvider, SocialProvider } from "../providers/types.js";
import type { TokenRecord, SnapshotRecord, WalletRecord } from "../db/records.js";
import type { EngineContext } from "./context.js";
import { errMessage } from "../core/errors.js";
import { holderStats } from "../analyzers/holders.js";
import { uniqueTradersFromRaw } from "../providers/geckoterminal/provider.js";

/**
 * DATA INGESTION: builds a TokenSnapshot for a token according to its tier (cost control).
 * Every failure is isolated: a failing provider leaves that section UNKNOWN and marks the source degraded.
 * The snapshot records which sources answered and a dataQuality score (0..1) of critical fields.
 */
export async function buildSnapshot(ctx: EngineContext, token: TokenRecord, tier: Tier, hint?: { raw?: unknown }): Promise<{ snapshot: TokenSnapshot; record: SnapshotRecord; walletRecords: WalletRecord[] }> {
  const { registry, cfg, log } = ctx;
  const chain = token.chain;
  const mint = token.mint;
  const allowed = new Set(cfg.tiers[tier].providers);
  const sources = new Set<string>();
  const degraded = new Set<string>();
  const observedAt = ctx.now().toISOString();
  const markDegraded = (cap: "dex" | "blockchain" | "security" | "social") => {
    degraded.add(cap);
    for (const p of registry.byCapability(cap as never)) degraded.add((p as { id: string }).id);
  };

  // ---- market (always) ----
  let market: MarketSnapshot | null = null;
  try {
    const r = await registry.call<DEXProvider, MarketSnapshot | null>("dex", (p) => p.getMarket(chain, mint), { preferred: ["dexscreener", "geckoterminal"].filter((x) => allowed.has(x) || x === "dexscreener") });
    market = r.value;
    r.degraded.forEach((d) => degraded.add(d));
    if (market) sources.add(market.source);
  } catch (e) {
    log.warn({ mint, err: errMessage(e) }, "market fetch failed");
    markDegraded("dex");
  }

  // ---- security + report (tier >= 2) ----
  let security: TokenSnapshot["security"] = null;
  let report: TokenSnapshot["securityReport"] = null;
  if (tier >= 2) {
    if (allowed.has("solana-rpc") || allowed.has("helius")) {
      try {
        const r = await registry.call<BlockchainProvider, TokenSnapshot["security"]>("blockchain", (p) => p.getMintInfo(chain, mint));
        security = r.value;
        sources.add(r.providerId);
        r.degraded.forEach((d) => degraded.add(d));
      } catch (e) {
        log.warn({ mint, err: errMessage(e) }, "mint info failed");
        markDegraded("blockchain");
      }
    }
    if (allowed.has("rugcheck")) {
      try {
        const r = await registry.call<SecurityProvider, TokenSnapshot["securityReport"]>("security", (p) => p.getReport(chain, mint));
        report = r.value;
        if (report) sources.add(report.source);
        r.degraded.forEach((d) => degraded.add(d));
      } catch (e) {
        log.warn({ mint, err: errMessage(e) }, "security report failed");
        markDegraded("security");
      }
    }
  }

  // ---- holders (tier >= 2) ----
  let holders: HoldersSnapshot | null = null;
  if (tier >= 2 && (allowed.has("solana-rpc") || allowed.has("helius"))) {
    try {
      const r = await registry.call<BlockchainProvider, HoldersSnapshot["top"]>("blockchain", (p) => p.getTopHolders(chain, mint, 20));
      const top = r.value;
      sources.add(r.providerId);
      holders = {
        totalHolders: report && isKnown(report.totalHolders) ? report.totalHolders : unknown(r.providerId),
        top,
        lpLockedPct: report?.lpLockedPct ?? unknown(r.providerId),
        lpBurnedPct: unknown(r.providerId),
        lpProviders: unknown(r.providerId),
        source: r.providerId,
        observedAt: ctx.now().toISOString(),
      };
    } catch (e) {
      log.warn({ mint, err: errMessage(e) }, "top holders failed");
      markDegraded("blockchain");
    }
  }
  if (!holders && report?.topHolders.length) {
    holders = { totalHolders: report.totalHolders, top: report.topHolders, lpLockedPct: report.lpLockedPct, lpBurnedPct: unknown(report.source), lpProviders: unknown(report.source), source: report.source, observedAt: report.observedAt };
  }

  // ---- trades / candles (tier >= 3) ----
  let trades: TradeEvent[] = [];
  let candles: Candle[] = [];
  const pair = market?.primaryPair?.pairAddress ?? token.pairAddress ?? null;
  if (tier >= 3 && pair) {
    const gt = registry.get<DEXProvider>("geckoterminal");
    if (gt && allowed.has("geckoterminal") && gt.getTrades) {
      try {
        trades = await gt.getTrades(chain, pair);
        if (trades.length) sources.add("geckoterminal");
      } catch (e) {
        log.debug({ mint, err: errMessage(e) }, "trades failed");
        degraded.add("geckoterminal");
      }
      if (gt.getOhlcv && tier >= 3) {
        try {
          candles = await gt.getOhlcv(chain, pair, "minute", 5, 100);
        } catch (e) {
          log.debug({ mint, err: errMessage(e) }, "ohlcv failed");
        }
      }
    }
    if (tier >= 4 && trades.length < 10) {
      const bc = registry.byCapability<BlockchainProvider>("blockchain")[0];
      if (bc?.getRecentTrades) {
        try {
          const rpcTrades = await bc.getRecentTrades(chain, pair, mint, 30);
          const price = market?.priceUsd.value ?? null;
          for (const t of rpcTrades) trades.push({ ...t, priceUsd: price, amountUsd: price !== null && t.amountToken !== null ? t.amountToken * price : null });
          if (rpcTrades.length) sources.add(bc.id);
        } catch (e) {
          log.debug({ mint, err: errMessage(e) }, "rpc trades failed");
        }
      }
    }
  }

  // ---- deployer (tier >= 2) ----
  let deployer: DeployerInfo | null = null;
  if (tier >= 2) deployer = await resolveDeployer(ctx, token, report, holders, allowed, sources, degraded);

  // ---- wallet profiles (tier >= 3): top non-LP holders + recent buyers ----
  const walletProfiles: WalletProfile[] = [];
  const walletRecords: WalletRecord[] = [];
  if (tier >= 3 && (allowed.has("solana-rpc") || allowed.has("helius"))) {
    const limit = tier >= 4 ? 16 : 8;
    const candidates = new Set<string>();
    for (const h of holders?.top ?? []) {
      if (h.isLpPool) continue;
      const a = h.owner ?? h.address;
      if (a && a !== deployer?.address.value) candidates.add(a);
      if (candidates.size >= limit / 2) break;
    }
    for (const t of [...trades].reverse()) {
      if (t.kind === "buy" && t.wallet) candidates.add(t.wallet);
      if (candidates.size >= limit) break;
    }
    const addrs = [...candidates].slice(0, limit);
    const cached = await ctx.store.getWallets(chain, addrs);
    const fresh = new Map(cached.filter((w) => ctx.now().getTime() - new Date(w.updatedAt).getTime() < 6 * 3_600_000).map((w) => [w.address, w]));
    for (const a of addrs) {
      const c = fresh.get(a);
      if (c) {
        walletProfiles.push(c);
        continue;
      }
      try {
        const r = await registry.call<BlockchainProvider, WalletProfile>("blockchain", (p) => p.getWalletProfile(chain, a));
        walletProfiles.push(r.value);
        walletRecords.push({ ...r.value, chain, tags: [], updatedAt: ctx.now().toISOString() });
        sources.add(r.providerId);
      } catch (e) {
        log.debug({ wallet: a, err: errMessage(e) }, "wallet profile failed");
        break; // stop burning RPC budget on a failing provider
      }
    }
  }

  // ---- social (tier >= 3) ----
  let social: SocialSnapshot | null = null;
  if (tier >= 3 && market) {
    social = await gatherSocial(ctx, { mint, symbol: token.symbol, name: token.name, websites: market.websites, socials: market.socials }, sources, degraded);
  }

  // ---- unique buyers/sellers (1h) ----
  const hourAgo = ctx.now().getTime() - 3_600_000;
  const recent = trades.filter((t) => new Date(t.ts).getTime() >= hourAgo);
  let uniqueBuyersH1: number | null = recent.length ? new Set(recent.filter((t) => t.kind === "buy").map((t) => t.wallet)).size : null;
  let uniqueSellersH1: number | null = recent.length ? new Set(recent.filter((t) => t.kind === "sell").map((t) => t.wallet)).size : null;
  const hintTraders = uniqueTradersFromRaw(hint?.raw);
  if (uniqueBuyersH1 === null && hintTraders.h1) {
    uniqueBuyersH1 = hintTraders.h1.buyers;
    uniqueSellersH1 = hintTraders.h1.sellers;
  }
  const createdAt = token.createdAt ?? market?.pairCreatedAt ?? null;
  const snapshot: TokenSnapshot = {
    chain,
    mint,
    symbol: market?.baseSymbol ?? token.symbol ?? null,
    name: market?.baseName ?? token.name ?? null,
    observedAt,
    createdAt,
    market,
    security,
    holders,
    deployer,
    securityReport: report,
    trades,
    candles,
    social,
    walletProfiles,
    sources: [...sources],
    degradedSources: [...degraded],
    dataQuality: 0,
  };
  snapshot.dataQuality = computeDataQuality(snapshot, tier);
  const hs = holders ? holderStats(holders.top, cfg.holders.whale_pct) : null;
  const record: SnapshotRecord = {
    chain,
    mint,
    observedAt,
    priceUsd: market?.priceUsd.value ?? null,
    marketCapUsd: market?.marketCapUsd.value ?? market?.fdvUsd.value ?? null,
    liquidityUsd: market?.liquidityUsd.value ?? null,
    volumeM5Usd: market?.volumeUsd.m5 ?? null,
    volumeH1Usd: market?.volumeUsd.h1 ?? null,
    volumeH24Usd: market?.volumeUsd.h24 ?? null,
    buysH1: market?.txns.h1?.buys ?? null,
    sellsH1: market?.txns.h1?.sells ?? null,
    buysM5: market?.txns.m5?.buys ?? null,
    sellsM5: market?.txns.m5?.sells ?? null,
    holders: holders?.totalHolders.value ?? report?.totalHolders.value ?? null,
    uniqueBuyersH1,
    uniqueSellersH1,
    top10Pct: hs?.top10Pct ?? null,
    dataQuality: snapshot.dataQuality,
    sources: [...sources],
    payload: snapshot,
  };
  return { snapshot, record, walletRecords };
}

async function resolveDeployer(ctx: EngineContext, token: TokenRecord, report: TokenSnapshot["securityReport"], holders: HoldersSnapshot | null, allowed: Set<string>, sources: Set<string>, degraded: Set<string>): Promise<DeployerInfo | null> {
  const chain = token.chain;
  let address: string | null = token.deployer;
  let src = "engine-db";
  if (!address && (allowed.has("solana-rpc") || allowed.has("helius"))) {
    try {
      const r = await ctx.registry.call<BlockchainProvider, { address: string; createdAt: string | null } | null>("blockchain", (p) => p.getDeployer(chain, token.mint));
      if (r.value) {
        address = r.value.address;
        src = r.providerId;
        sources.add(r.providerId);
        if (!token.createdAt && r.value.createdAt) token.createdAt = r.value.createdAt;
      }
    } catch (e) {
      ctx.log.debug({ mint: token.mint, err: errMessage(e) }, "deployer lookup failed");
      degraded.add("blockchain");
    }
  }
  if (!address && report && isKnown(report.creator)) {
    address = report.creator.value;
    src = report.source;
  }
  if (!address) return null;
  const observedAt = ctx.now().toISOString();
  const info: DeployerInfo = {
    address: dp(address, src, src === "engine-db" ? "HIGH" : "HIGH", observedAt),
    walletAgeDays: unknown(src),
    txCount: unknown(src),
    previousTokens: unknown(src),
    previousRuggedTokens: unknown(src),
    fundedBy: unknown(src),
    holdsPct: unknown(src),
    previousSurvivalRate: unknown(src),
    source: src,
    observedAt,
  };
  const holding = holders?.top.find((h) => h.owner === address || h.address === address);
  if (holders) info.holdsPct = dp(holding?.pct ?? 0, holders.source, "MEDIUM", holders.observedAt);
  if (allowed.has("solana-rpc") || allowed.has("helius")) {
    try {
      const r = await ctx.registry.call<BlockchainProvider, WalletProfile>("blockchain", (p) => p.getWalletProfile(chain, address!));
      const w = r.value;
      sources.add(r.providerId);
      if (isKnown(w.firstSeenAt)) info.walletAgeDays = dp((ctx.now().getTime() - new Date(w.firstSeenAt.value).getTime()) / 86_400_000, r.providerId, w.firstSeenAt.confidence, observedAt);
      info.txCount = w.txCount;
      info.fundedBy = w.fundedBy;
      await ctx.store.upsertWallet({ ...w, chain, tags: ["deployer"], updatedAt: observedAt });
    } catch (e) {
      ctx.log.debug({ mint: token.mint, err: errMessage(e) }, "deployer profile failed");
    }
  }
  const hist = await ctx.store.getDeployer(chain, address);
  if (hist) {
    info.previousTokens = dp(hist.tokensCreated, "engine-db", "HIGH", hist.lastSeenAt);
    info.previousRuggedTokens = dp(hist.tokensRugged, "engine-db", "HIGH", hist.lastSeenAt);
    info.previousSurvivalRate = dp(hist.tokensCreated > 0 ? 1 - (hist.tokensRugged + hist.tokensAbandoned) / hist.tokensCreated : 1, "engine-db", "MEDIUM", hist.lastSeenAt);
  }
  return info;
}

async function gatherSocial(ctx: EngineContext, token: { mint: string; symbol: string | null; name: string | null; websites: string[]; socials: { type: string; url: string }[] }, sources: Set<string>, degraded: Set<string>): Promise<SocialSnapshot> {
  const observedAt = ctx.now().toISOString();
  const base: SocialSnapshot = {
    mentions1h: unknown("social"),
    mentions24h: unknown("social"),
    uniqueAuthors24h: unknown("social"),
    newAccountShare: unknown("social"),
    engagement24h: unknown("social"),
    sentiment: unknown("social"),
    telegramMembers: unknown("social"),
    twitterFollowers: unknown("social"),
    hasWebsite: token.websites.length > 0,
    hasTwitter: token.socials.some((s) => /twitter|x\.com/i.test(s.type + s.url)),
    hasTelegram: token.socials.some((s) => /telegram|t\.me/i.test(s.type + s.url)),
    keywords: [],
    sources: [],
    observedAt,
  };
  for (const p of ctx.registry.byCapability<SocialProvider>("social")) {
    try {
      const part = await p.getSocial("solana", token);
      for (const [k, v] of Object.entries(part)) {
        if (v === undefined) continue;
        if (k === "sources") continue;
        (base as unknown as Record<string, unknown>)[k] = v;
      }
      if (part.sources?.length) {
        base.sources.push(...part.sources);
        part.sources.forEach((s) => sources.add(s));
      }
    } catch (e) {
      ctx.log.debug({ provider: p.id, err: errMessage(e) }, "social provider failed");
      degraded.add(p.id);
    }
  }
  return base;
}

/** 0..1 — weighted share of critical fields known for the tier's expectations. */
export function computeDataQuality(s: TokenSnapshot, tier: Tier): number {
  const checks: { ok: boolean; w: number }[] = [
    { ok: !!s.market && isKnown(s.market.priceUsd), w: 2 },
    { ok: !!s.market && isKnown(s.market.liquidityUsd), w: 2 },
    { ok: !!s.market && (isKnown(s.market.marketCapUsd) || isKnown(s.market.fdvUsd)), w: 1 },
    { ok: !!s.market && s.market.volumeUsd.h1 !== null, w: 1 },
    { ok: !!s.market && s.market.txns.h1 !== null, w: 1 },
  ];
  if (tier >= 2) {
    checks.push(
      { ok: !!s.security && isKnown(s.security.mintAuthorityActive) && isKnown(s.security.freezeAuthorityActive), w: 3 },
      { ok: !!s.holders && s.holders.top.length > 0, w: 2 },
      { ok: !!s.holders && isKnown(s.holders.totalHolders), w: 1 },
      { ok: !!s.deployer && isKnown(s.deployer.address), w: 1 },
      { ok: !!s.securityReport, w: 1 },
    );
  }
  if (tier >= 3) {
    checks.push({ ok: s.trades.length >= 10, w: 1.5 }, { ok: s.walletProfiles.length >= 3, w: 1 }, { ok: !!s.social && s.social.sources.length > 0, w: 0.5 });
  }
  const tot = checks.reduce((a, c) => a + c.w, 0);
  const ok = checks.filter((c) => c.ok).reduce((a, c) => a + c.w, 0);
  return Math.round((ok / tot) * 100) / 100;
}

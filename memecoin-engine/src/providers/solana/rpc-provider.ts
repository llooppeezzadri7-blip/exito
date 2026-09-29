import { Connection, PublicKey, type ParsedAccountData, type ParsedTransactionWithMeta } from "@solana/web3.js";
import type { Chain } from "../../core/types.js";
import { dp, unknown } from "../../core/types.js";
import type { HolderInfo, SecurityInfo, TradeEvent, WalletProfile } from "../../core/model.js";
import type { BlockchainProvider } from "../types.js";
import { TokenBucket } from "../../core/rate-limiter.js";
import { TtlCache } from "../../core/cache.js";
import { logger } from "../../core/logger.js";
import { METAPLEX_METADATA_PROGRAM, POOL_PROGRAMS, SYSTEM_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, labelFor } from "./known-accounts.js";

const SRC = "solana-rpc";

/**
 * Read-only Solana JSON-RPC provider (web3.js v1).
 * Uses documented RPC methods only:
 *  - getAccountInfo(jsonParsed) for mint data: mintAuthority, freezeAuthority, supply, decimals, extensions
 *  - getTokenLargestAccounts for the 20 largest token accounts
 *  - getMultipleAccounts(jsonParsed) to resolve token-account owners and detect program-owned (pool) accounts
 *  - getSignaturesForAddress / getParsedTransaction for deployer & wallet history
 * It never signs or sends transactions.
 */
export class SolanaRpcProvider implements BlockchainProvider {
  readonly id = SRC;
  readonly capability = "blockchain" as const;
  readonly chains: Chain[] = ["solana"];
  private conn: Connection;
  private bucket: TokenBucket;
  private cache = new TtlCache<unknown>(2000);

  constructor(
    private readonly rpcUrl: string,
    opts: { requestsPerSecond?: number; wsUrl?: string } = {},
  ) {
    this.conn = new Connection(rpcUrl, { commitment: "confirmed", wsEndpoint: opts.wsUrl });
    const rps = opts.requestsPerSecond ?? 8; // public RPC is ~10 rps per IP; stay under it
    this.bucket = new TokenBucket(rps, 1000);
  }

  isConfigured(): boolean {
    return Boolean(this.rpcUrl);
  }

  async ping(): Promise<boolean> {
    await this.bucket.acquire();
    const slot = await this.conn.getSlot();
    return slot > 0;
  }

  get connection(): Connection {
    return this.conn;
  }

  async getMintInfo(_chain: Chain, mint: string): Promise<SecurityInfo> {
    const key = `mint:${mint}`;
    const cached = this.cache.get(key) as SecurityInfo | undefined;
    if (cached) return cached;
    await this.bucket.acquire();
    const res = await this.conn.getParsedAccountInfo(new PublicKey(mint));
    const observedAt = new Date().toISOString();
    const acc = res.value;
    const base: SecurityInfo = {
      mintAuthorityActive: unknown(SRC),
      freezeAuthorityActive: unknown(SRC),
      tokenProgram: unknown(SRC),
      extensions: unknown(SRC),
      supply: unknown(SRC),
      decimals: unknown(SRC),
      permanentDelegate: unknown(SRC),
      transferHook: unknown(SRC),
      transferFeeBps: unknown(SRC),
      nonTransferable: unknown(SRC),
      metadataMutable: unknown(SRC),
      updateAuthority: unknown(SRC),
      source: SRC,
      observedAt,
    };
    if (!acc || !("parsed" in (acc.data as object))) return base; // account missing or not parsable => UNKNOWN
    const data = acc.data as ParsedAccountData;
    const info = data.parsed?.info ?? {};
    if (data.parsed?.type !== "mint") return base;
    const program = acc.owner.toBase58();
    const extensions: { extension: string; state?: Record<string, unknown> }[] = Array.isArray(info.extensions) ? info.extensions : [];
    const extNames = extensions.map((e) => e.extension);
    const decimals = typeof info.decimals === "number" ? info.decimals : null;
    const supplyRaw = typeof info.supply === "string" ? Number(info.supply) : null;
    const supply = supplyRaw !== null && decimals !== null ? supplyRaw / 10 ** decimals : supplyRaw;

    const transferFee = extensions.find((e) => e.extension === "transferFeeConfig");
    const feeBps = transferFee ? Number((transferFee.state as any)?.newerTransferFee?.transferFeeBasisPoints ?? (transferFee.state as any)?.olderTransferFee?.transferFeeBasisPoints ?? 0) : 0;
    const tokenMetadataExt = extensions.find((e) => e.extension === "tokenMetadata");

    const result: SecurityInfo = {
      ...base,
      mintAuthorityActive: dp(info.mintAuthority !== null && info.mintAuthority !== undefined, SRC, "HIGH", observedAt),
      freezeAuthorityActive: dp(info.freezeAuthority !== null && info.freezeAuthority !== undefined, SRC, "HIGH", observedAt),
      tokenProgram: dp(program === TOKEN_PROGRAM ? "spl-token" : program === TOKEN_2022_PROGRAM ? "spl-token-2022" : program, SRC, "HIGH", observedAt),
      extensions: dp(extNames, SRC, "HIGH", observedAt),
      supply: dp(supply, SRC, "HIGH", observedAt),
      decimals: dp(decimals, SRC, "HIGH", observedAt),
      permanentDelegate: dp(extNames.includes("permanentDelegate"), SRC, "HIGH", observedAt),
      transferHook: dp(extNames.includes("transferHook"), SRC, "HIGH", observedAt),
      transferFeeBps: dp(feeBps, SRC, "HIGH", observedAt),
      nonTransferable: dp(extNames.includes("nonTransferable"), SRC, "HIGH", observedAt),
    };
    if (tokenMetadataExt?.state) {
      const ua = (tokenMetadataExt.state as any).updateAuthority ?? null;
      result.updateAuthority = dp(ua, SRC, "HIGH", observedAt);
      result.metadataMutable = dp(ua !== null, SRC, "MEDIUM", observedAt);
    } else {
      // Metaplex metadata PDA (classic SPL tokens)
      try {
        const meta = await this.getMetaplexMetadata(mint);
        if (meta) {
          result.updateAuthority = dp(meta.updateAuthority, SRC, "HIGH", observedAt);
          result.metadataMutable = dp(meta.isMutable, SRC, "HIGH", observedAt);
        }
      } catch (e) {
        logger.debug({ mint, err: (e as Error).message }, "metaplex metadata read failed");
      }
    }
    this.cache.set(key, result, 5 * 60_000);
    return result;
  }

  /** Parse the Metaplex Token Metadata account (borsh layout) for update authority + isMutable. */
  private async getMetaplexMetadata(mint: string): Promise<{ updateAuthority: string; isMutable: boolean } | null> {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), new PublicKey(METAPLEX_METADATA_PROGRAM).toBuffer(), new PublicKey(mint).toBuffer()],
      new PublicKey(METAPLEX_METADATA_PROGRAM),
    );
    await this.bucket.acquire();
    const acc = await this.conn.getAccountInfo(pda);
    if (!acc) return null;
    return parseMetaplexMetadata(acc.data);
  }

  async getTopHolders(_chain: Chain, mint: string, limit = 20): Promise<HolderInfo[]> {
    await this.bucket.acquire();
    const [largest, mintInfo] = await Promise.all([this.conn.getTokenLargestAccounts(new PublicKey(mint)), this.getMintInfo("solana", mint)]);
    const supply = mintInfo.supply.value ?? null;
    const accounts = largest.value.slice(0, limit);
    if (accounts.length === 0) return [];
    await this.bucket.acquire();
    const parsed = await this.conn.getMultipleParsedAccounts(accounts.map((a) => a.address));
    const owners = parsed.value.map((a) => {
      const d = a?.data as ParsedAccountData | undefined;
      return (d && "parsed" in d ? (d.parsed?.info?.owner as string | undefined) : undefined) ?? null;
    });
    // Resolve owner accounts to detect program-owned (PDA) owners => pools/vaults/lockers.
    const uniqueOwners = [...new Set(owners.filter((o): o is string => !!o))];
    const ownerIsProgramOwned = new Map<string, string | null>();
    if (uniqueOwners.length > 0) {
      await this.bucket.acquire();
      const ownerAccs = await this.conn.getMultipleAccountsInfo(uniqueOwners.map((o) => new PublicKey(o)));
      ownerAccs.forEach((acc, i) => {
        const owner = uniqueOwners[i]!;
        const programOwner = acc ? acc.owner.toBase58() : null;
        ownerIsProgramOwned.set(owner, programOwner && programOwner !== SYSTEM_PROGRAM ? programOwner : null);
      });
    }
    return accounts.map((a, i) => {
      const owner = owners[i] ?? null;
      const amount = a.uiAmount ?? Number(a.amount) / 10 ** a.decimals;
      const programOwner = owner ? ownerIsProgramOwned.get(owner) ?? null : null;
      // Any program-owned (PDA) owner is treated as a pool/vault/locker, not a person. Known pool programs get a label.
      const isLpPool = !!programOwner;
      void POOL_PROGRAMS;
      const label = owner ? labelFor(owner) ?? (programOwner ? labelFor(programOwner) ?? `program-owned (${programOwner.slice(0, 6)}…)` : null) : null;
      return {
        address: a.address.toBase58(),
        owner,
        amount,
        pct: supply && supply > 0 ? (amount / supply) * 100 : 0,
        isLpPool,
        label,
      };
    });
  }

  async getDeployer(_chain: Chain, mint: string): Promise<{ address: string; createdAt: string | null; signature: string | null } | null> {
    const key = `deployer:${mint}`;
    const cached = this.cache.get(key) as { address: string; createdAt: string | null; signature: string | null } | null | undefined;
    if (cached !== undefined) return cached;
    // Walk signature history to the oldest one (bounded pages to control RPC cost).
    let before: string | undefined;
    let oldest: { signature: string; blockTime: number | null | undefined } | null = null;
    for (let page = 0; page < 5; page++) {
      await this.bucket.acquire();
      const sigs = await this.conn.getSignaturesForAddress(new PublicKey(mint), { limit: 1000, before });
      if (sigs.length === 0) break;
      const last = sigs[sigs.length - 1]!;
      oldest = { signature: last.signature, blockTime: last.blockTime };
      if (sigs.length < 1000) break;
      before = last.signature;
      if (page === 4) {
        this.cache.set(key, null, 10 * 60_000);
        return null; // too deep => UNKNOWN, do not guess
      }
    }
    if (!oldest) {
      this.cache.set(key, null, 60_000);
      return null;
    }
    await this.bucket.acquire();
    const tx = await this.conn.getParsedTransaction(oldest.signature, { maxSupportedTransactionVersion: 0 });
    const signer = tx?.transaction.message.accountKeys.find((k) => k.signer);
    const result = signer
      ? {
          address: signer.pubkey.toBase58(),
          createdAt: oldest.blockTime ? new Date(oldest.blockTime * 1000).toISOString() : null,
          signature: oldest.signature,
        }
      : null;
    this.cache.set(key, result, 60 * 60_000);
    return result;
  }

  async getWalletProfile(_chain: Chain, address: string): Promise<WalletProfile> {
    const key = `wallet:${address}`;
    const cached = this.cache.get(key) as WalletProfile | undefined;
    if (cached) return cached;
    const observedAt = new Date().toISOString();
    await this.bucket.acquire();
    const sigs = await this.conn.getSignaturesForAddress(new PublicKey(address), { limit: 1000 });
    const exact = sigs.length < 1000;
    const oldest = sigs[sigs.length - 1];
    let fundedBy: string | null = null;
    let fundedAt: string | null = null;
    if (oldest && exact) {
      try {
        await this.bucket.acquire();
        const tx = await this.conn.getParsedTransaction(oldest.signature, { maxSupportedTransactionVersion: 0 });
        const f = findFunder(tx, address);
        if (f) {
          fundedBy = f;
          fundedAt = oldest.blockTime ? new Date(oldest.blockTime * 1000).toISOString() : null;
        }
      } catch (e) {
        logger.debug({ address, err: (e as Error).message }, "funder lookup failed");
      }
    }
    await this.bucket.acquire();
    const lamports = await this.conn.getBalance(new PublicKey(address)).catch(() => null);
    const profile: WalletProfile = {
      address,
      firstSeenAt: oldest?.blockTime ? dp(new Date(oldest.blockTime * 1000).toISOString(), SRC, exact ? "HIGH" : "LOW", observedAt) : unknown(SRC),
      txCount: dp(sigs.length, SRC, exact ? "HIGH" : "LOW", observedAt),
      fundedBy: fundedBy ? dp(fundedBy, SRC, "MEDIUM", observedAt) : unknown(SRC),
      fundedAt: fundedAt ? dp(fundedAt, SRC, "MEDIUM", observedAt) : unknown(SRC),
      balance: lamports === null ? unknown(SRC) : dp(lamports / 1e9, SRC, "HIGH", observedAt),
      source: SRC,
      observedAt,
    };
    this.cache.set(key, profile, 30 * 60_000);
    return profile;
  }

  /**
   * Derive recent buy/sell events for `mint` from the pool account's transaction history using
   * pre/post token balances. Bounded to `limit` transactions (each costs one RPC call).
   */
  async getRecentTrades(_chain: Chain, pairAddress: string, mint: string, limit = 40): Promise<TradeEvent[]> {
    await this.bucket.acquire();
    const sigs = await this.conn.getSignaturesForAddress(new PublicKey(pairAddress), { limit });
    const ok = sigs.filter((s) => !s.err);
    const events: TradeEvent[] = [];
    for (const s of ok) {
      await this.bucket.acquire();
      const tx = await this.conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null);
      if (!tx?.meta) continue;
      const ev = tradeFromBalances(tx, mint, pairAddress);
      if (ev) events.push({ ...ev, ts: s.blockTime ? new Date(s.blockTime * 1000).toISOString() : new Date().toISOString(), txHash: s.signature, source: SRC });
    }
    return events;
  }
}

/** Pure: find the SOL funder of `address` in a parsed transaction (system transfer to the address). */
export function findFunder(tx: ParsedTransactionWithMeta | null, address: string): string | null {
  if (!tx) return null;
  for (const ix of tx.transaction.message.instructions) {
    if ("parsed" in ix && ix.program === "system" && ix.parsed?.type === "transfer") {
      const info = ix.parsed.info ?? {};
      if (info.destination === address && typeof info.source === "string") return info.source;
    }
  }
  for (const inner of tx.meta?.innerInstructions ?? []) {
    for (const ix of inner.instructions) {
      if ("parsed" in ix && ix.program === "system" && ix.parsed?.type === "transfer") {
        const info = ix.parsed.info ?? {};
        if (info.destination === address && typeof info.source === "string") return info.source;
      }
    }
  }
  return null;
}

/** Pure: classify a parsed tx as a buy/sell of `mint` by a non-pool wallet using token balance deltas. */
export function tradeFromBalances(tx: ParsedTransactionWithMeta, mint: string, pairAddress: string): Omit<TradeEvent, "ts" | "txHash" | "source"> | null {
  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];
  const byOwner = new Map<string, number>();
  const keys = tx.transaction.message.accountKeys;
  for (const b of post) {
    if (b.mint !== mint) continue;
    const owner = b.owner ?? keys[b.accountIndex]?.pubkey.toBase58() ?? "?";
    const prev = pre.find((p) => p.accountIndex === b.accountIndex);
    const delta = (b.uiTokenAmount.uiAmount ?? 0) - (prev?.uiTokenAmount.uiAmount ?? 0);
    byOwner.set(owner, (byOwner.get(owner) ?? 0) + delta);
  }
  for (const p of pre) {
    if (p.mint !== mint) continue;
    if (post.some((b) => b.accountIndex === p.accountIndex)) continue;
    const owner = p.owner ?? "?";
    byOwner.set(owner, (byOwner.get(owner) ?? 0) - (p.uiTokenAmount.uiAmount ?? 0));
  }
  const signer = keys.find((k) => k.signer)?.pubkey.toBase58() ?? null;
  let best: { owner: string; delta: number } | null = null;
  for (const [owner, delta] of byOwner) {
    if (owner === pairAddress) continue;
    if (!best || Math.abs(delta) > Math.abs(best.delta)) best = { owner, delta };
  }
  if (!best || best.delta === 0) return null;
  return {
    kind: best.delta > 0 ? "buy" : "sell",
    wallet: signer ?? best.owner,
    amountToken: Math.abs(best.delta),
    amountUsd: null,
    priceUsd: null,
  };
}

/** Pure: minimal borsh reader for Metaplex Metadata (key, updateAuthority, mint, name, symbol, uri, sfbp, creators?, primarySaleHappened, isMutable). */
export function parseMetaplexMetadata(buf: Buffer): { updateAuthority: string; isMutable: boolean } | null {
  try {
    let o = 0;
    o += 1; // key
    const updateAuthority = new PublicKey(buf.subarray(o, o + 32)).toBase58();
    o += 32;
    o += 32; // mint
    for (let i = 0; i < 3; i++) {
      const len = buf.readUInt32LE(o);
      o += 4 + len;
    }
    o += 2; // seller fee bps
    const hasCreators = buf.readUInt8(o);
    o += 1;
    if (hasCreators === 1) {
      const n = buf.readUInt32LE(o);
      o += 4 + n * 34;
    }
    o += 1; // primary sale happened
    const isMutable = buf.readUInt8(o) === 1;
    return { updateAuthority, isMutable };
  } catch {
    return null;
  }
}

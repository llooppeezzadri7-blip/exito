# DATA SOURCES

All sources are public/official endpoints or free tiers. The engine never depends on a single source; each capability has a
provider list with failover (see `src/engine.ts#buildRegistry`). Run `npm run check:sources` after deployment — third-party
endpoints change without notice, and this environment could not reach them live (network policy), so field mappings are
defensive (`zod` with optional/passthrough) and must be smoke-tested on the target machine.

| Provider | Capability | Endpoints used | Limits | Notes |
|---|---|---|---|---|
| Solana JSON-RPC (`SOLANA_RPC_URL`) | blockchain | `getAccountInfo` (jsonParsed mint: `mintAuthority`, `freezeAuthority`, `supply`, `decimals`, Token-2022 `extensions`), `getTokenLargestAccounts` (20 largest), `getMultipleAccounts` (owners, program-owned detection), `getSignaturesForAddress`, `getTransaction`, `getBalance` | public RPC ≈10 rps/IP (bucket set to 8) | Authoritative for security. Metaplex metadata PDA parsed for update authority / isMutable. |
| Helius (`HELIUS_API_KEY`, optional) | blockchain | same RPC methods via Helius endpoint | free tier 1M credits/mo | Registered as `helius`; used in tier 4 lists. |
| DexScreener | dex + market feeds | `GET /latest/dex/tokens/{mint}` (300/min): pairs, priceUsd, txns m5/h1/h6/h24, volume, priceChange, liquidity, fdv, marketCap, pairCreatedAt, info.websites/socials, boosts · `GET /token-profiles/latest/v1`, `GET /token-boosts/latest/v1` (60/min) | no key | Profiles/boosts = paid promotion → discovery hint only. |
| GeckoTerminal | dex | `GET /networks/solana/new_pools?page=N` (48h, 20/page) · `GET /networks/solana/tokens/{mint}/pools` · `GET /networks/solana/pools/{pool}/ohlcv/{minute|hour}` · `GET /networks/solana/pools/{pool}/trades` (last trades with `tx_from_address`, `kind`, `volume_in_usd`) | 30/min, header `Accept: application/json;version=20230302` | Provides unique buyers/sellers per window (`transactions.h1.buyers`). |
| RugCheck | security | `GET /v1/tokens/{mint}/report` (risks, score, score_normalised, topHolders, markets.lp.lpLockedPct, totalHolders, creator, graphInsidersDetected, rugged, knownAccounts) · `GET /v1/stats/new_tokens` | no key for reads (bucket 30/min) | Advisory; cross-checked with RPC. Score = higher is riskier. |
| PumpPortal WS | discovery stream | `wss://pumpportal.fun/api/data` → `subscribeNewToken`, `subscribeMigration` | free methods only | Third-party stream of pump.fun-style launches; metered methods are never used. |
| Reddit (public JSON) | social | `search.json?q="$SYMBOL"&sort=new&t=day`, `user/{name}/about.json` (author age sample) | anonymous, throttled | LOW confidence; cached 10 min. Disable with `REDDIT_ENABLED=0`. |
| Telegram Bot API (`TELEGRAM_BOT_TOKEN`) | social | `getChatMemberCount` for public channels linked from the token | 20/min | Presence/growth signal only. |
| News | news | — | — | Interface exists (`NewsProvider`), no free provider integrated: reported as UNCONFIGURED, never faked. |

Not integrated (would need paid keys): X/Twitter API, Birdeye (key slot exists), LunarCrush, Google Trends, TikTok, YouTube.
When a capability has no data the analyzer returns `null` → **UNKNOWN**, and the scorer records it in `missingSignals`.

## Data quality

`computeDataQuality()` weights the critical fields expected for the token's tier (price, liquidity, MC, volume, txns, authorities,
top holders, holder count, deployer, report, tape, wallet profiles, social). Below `risk_gates.min_data_quality_for_opportunity`
the token is `INSUFFICIENT_DATA` regardless of score. Every snapshot stores `sources[]` and `degradedSources[]`.

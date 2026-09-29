# ARCHITECTURE — Memecoin Intelligence Engine

Read-only, 24/7 research engine for new Solana memecoins. Its first job is to say **NO** (scams, rugs,
honeypots, manipulation, illiquid tokens, late entries, insufficient data); only then to surface early setups.

## Pipeline

```
DISCOVERY ENGINE      src/discovery/engine.ts        polling (GeckoTerminal new pools, DexScreener profiles/boosts,
                                                     RugCheck new tokens) + streaming (PumpPortal WS) → tokens (TIER 1)
      ↓
DATA INGESTION        src/pipeline/build-snapshot.ts tiered fetch → TokenSnapshot (every datum: source/timestamp/confidence)
      ↓
ON-CHAIN ANALYZER     src/analyzers/security.ts      mint/freeze authority, Token-2022 extensions, metadata, program
LIQUIDITY ANALYZER    src/analyzers/liquidity.ts     depth, liq/MC, stability, LP lock, sell impact → LIQUIDITY_SCORE, EXIT_RISK
HOLDER ANALYZER       src/analyzers/holders.ts       concentration (pools excluded), whale behaviour, growth
DEPLOYER ANALYZER     src/analyzers/deployer.ts      wallet age, funding, holdings, own-DB history → reputation (UNKNOWN allowed)
WALLET CLUSTERING     src/analyzers/wallet-cluster.ts same funder / simultaneous buys / deployer-funded → POTENTIAL_CLUSTER
MICROSTRUCTURE        src/analyzers/microstructure.ts wash trading, bots, volume w/o holders, big trades → MARKET_QUALITY_SCORE
SOCIAL / NARRATIVE    src/analyzers/social.ts, narrative.ts  mention growth, author diversity, fake engagement; narrative momentum/freshness/saturation
EARLY MOMENTUM        src/analyzers/early-momentum.ts participation acceleration while MC is small (price capped)
ANOMALY DETECTOR      src/analyzers/anomaly.ts       robust z-scores vs population and own history
      ↓
RUG DETECTOR          src/risk/rug-detector.ts       deterministic flag weights → rug index + level (never "SAFE")
NO-FOMO / PHASE       src/risk/phase.ts              EARLY / LATE / EXHAUSTED
RISK GATES            src/risk/gates.ts              deterministic blocks: REJECTED / INSUFFICIENT_DATA / SECURITY_UNVERIFIED / INVESTIGATE
ADVERSARIAL           src/scoring/adversarial.ts     BULL case, BEAR case, CONFLICT analysis (lowers confidence)
OPPORTUNITY SCORER    src/scoring/opportunity.ts     explained +/- breakdown, category, confidence, status text
EXIT / THESIS ENGINE  src/risk/thesis.ts             THESIS_INTACT / WEAKENING / INVALIDATED / RISK_ESCALATING
      ↓
ALERT ENGINE          src/alerts/*                   cooldowns, hourly caps, Telegram/Discord/dashboard, audit
PAPER TRADING         src/paper/engine.ts            simulated entries/exits with slippage+fees, stats
LEARNING ENGINE       src/learning/*                 predictions ledger → outcomes → feature lifts → bounded weight proposals
DATABASE              src/db/*                       Postgres (Supabase-compatible) or in-memory; migrations/0001_init.sql
MONITOR               src/monitor/*                  scheduler loops, queue worker (SKIP LOCKED), health snapshots
API + DASHBOARD       src/api/server.ts, src/dashboard/public
```

## Key design rules

* **DataPoint everywhere.** `{ value | null, source, observedAt, confidence }`. `null` = UNKNOWN. Nothing is extrapolated.
* **Facts vs inferences.** Analyzer evidence is tagged `FACT` (observed) or `INFERENCE` (derived).
* **Tiers control cost.** TIER 1 (market only) → TIER 2 (+ chain security, holders, deployer, report) → TIER 3 (+ tape, wallet
  profiles, social, candles) → TIER 4 (more wallets, RPC tape). Promotion/demotion rules live in `config.yaml`.
* **Gates before scores.** No learned parameter can bypass `src/risk/gates.ts`. Learned weights touch positive factors only.
* **NO is a valid output.** `NO_OPPORTUNITY`, `INSUFFICIENT_DATA`, `SECURITY_UNVERIFIED`, `INVESTIGATE`, `REJECTED` are first-class.
* **Provider abstraction.** `DataProvider` → Blockchain / DEX / MarketData / Social / Security / News. `ProviderRegistry` does
  failover + health (`OK / DEGRADED / DOWN / UNCONFIGURED`). A failing API never stops the engine.
* **Multi-chain ready.** `Chain` type + per-chain provider lists. Only `solana` is implemented; adding a chain means adding a
  `BlockchainProvider` and enabling it in `engine.chains`.
* **Everything persisted with timestamps.** Snapshots keep the full typed payload so any alert can be replayed (`npm run replay`).

## Process model

`src/main.ts` runs everything in one Node process (scheduler loops + queue worker + Fastify API). `src/api-main.ts` runs the
API alone for split deployments. The queue is a Postgres table (`jobs`) claimed with `FOR UPDATE SKIP LOCKED`, so several
worker processes can share one database. Loops: discovery, enqueue, workers, outcomes, narratives, learning, health, retention.

## Data model (migrations/0001_init.sql)

tokens · token_snapshots · liquidity_snapshots · holder_snapshots · pools · holders · transactions · wallets · wallet_clusters ·
deployers · social_mentions · social_snapshots · narratives · risk_events · alerts · opportunities · predictions · feature_values ·
outcomes · paper_trades · model_versions · audit_logs · jobs · health_snapshots.

## What is NOT here (by design, v0.1)

No wallet, no private key, no signing, no swaps. See SECURITY.md.

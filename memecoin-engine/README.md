# MEMECOIN INTELLIGENCE ENGINE

24/7 research and risk-filtering engine for newly launched Solana memecoins. It discovers tokens early, verifies them
on-chain, scores them across many independent dimensions, and — above all — **says NO** to scams, rugs, honeypots,
manipulation, illiquid tokens, late entries and insufficient data. Read-only. Paper trading only. No wallet exists in the system.

> Every listed token is an extremely speculative asset. No score, signal or alert predicts price. Outputs are research, not advice.

## What it does

* **Discovery** from several sources (GeckoTerminal new pools, DexScreener profiles/boosts, RugCheck new tokens, PumpPortal stream).
* **Verification**: mint/freeze authority and Token-2022 extensions read directly from the mint account; holders; deployer; LP.
* **Analysis**: liquidity & exit risk, holder concentration/behaviour, deployer reputation, wallet clustering, market microstructure
  (wash/bot detection), social momentum, narratives, early momentum, anomalies, multi-timeframe metrics.
* **Risk engine**: deterministic rug index + gates, NO-FOMO phase (EARLY/LATE/EXHAUSTED), bull/bear/conflict analysis,
  thesis tracking (INTACT / WEAKENING / INVALIDATED / RISK_ESCALATING).
* **Explained scoring** with +/- breakdown, categories WATCHLIST / HIGH_CONVICTION_SETUP / EXTREME_RISK / NO_OPPORTUNITY.
* **Alerts** (Telegram, Discord, dashboard) in a professional format with cooldowns; never "buy".
* **Paper trading** with slippage/fees and honest statistics; **learning ledger** (predictions → outcomes → feature lifts →
  bounded weight proposals, manual activation).
* **Dashboard**: live market, token detail (charts, holders, clusters, security, bull/bear, entry zones, prediction history,
  audit), health, paper trading. **API** for everything.

## Quick start

```bash
cd memecoin-engine
npm install
cp .env.example .env            # add SOLANA_RPC_URL (free Helius key recommended), TELEGRAM_BOT_TOKEN/CHAT_ID, DATABASE_URL
npm run check:sources           # confirm each API works from your network
npm run dev                     # engine + dashboard at http://localhost:8080
```
Production: `docker compose up -d --build` (see docs/DEPLOYMENT.md).

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` / `npm start` | run workers + API (dev / built) |
| `npm run start:api` | API + dashboard only |
| `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` | quality gates |
| `npm run migrate` | apply SQL migrations manually |
| `npm run check:sources` | ping + sample-call every provider |
| `npm run paper:stats` | paper-trading statistics |
| `npm run replay -- <mint> [snapshotId]` | reproduce past analyses from stored snapshots (audit) |
| `npx tsx src/tools/learn.ts [--apply]` | learning report / activate proposed weights |

## Documentation

`docs/ARCHITECTURE.md` · `docs/SECURITY.md` · `docs/DATA_SOURCES.md` · `docs/SCORING.md` · `docs/RISK_ENGINE.md` ·
`docs/DEPLOYMENT.md` · `docs/MONITORING.md`

## Status (v0.1)

Phases 1–5 of the plan are implemented for Solana (discovery, DB, security, liquidity, holders, deployer, scoring, wallet
clustering, microstructure, risk engine, 24/7 monitor, social/narrative, alerts, paper trading, learning ledger + statistical
engine, dashboard). Phase 6 (ML) is scaffolded via `model_versions` and the feature/outcome ledger but no ML model is trained.
Other chains are typed in the abstraction but not implemented. Social coverage is limited to free sources (Reddit, Telegram
member counts) — X/TikTok/YouTube require paid APIs and are reported as UNKNOWN, never guessed.

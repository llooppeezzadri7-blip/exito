# SCORING

The Opportunity Score is a **multi-dimensional, fully explained** number (0–100). It is never shown without its breakdown.
Weights live in `config.yaml → scoring` and can be tuned; penalties and gates are fixed by design.

## Sub-scores (each 0–100 or UNKNOWN)

| Sub-score | Analyzer | Main inputs |
|---|---|---|
| Security | `security.ts` | mint/freeze authority, Token-2022 extensions (permanentDelegate, transferHook, transferFee, nonTransferable), mutable metadata, owning program, third-party report cross-check |
| Liquidity | `liquidity.ts` | log depth ($3k→0, $300k→100), liquidity/MC band, 15m/1h stability, LP locked %, est. sell impact |
| Market Quality | `microstructure.ts` | volume/liquidity turnover, holders created per $10k volume, buys per unique buyer, symmetric flow, tape: round-trips, single-wallet dominance, repetitive sizes, large sells |
| Holder Quality | `holders.ts` | top10/largest wallet (pools excluded), deployer share, insiders, whale net flow, holder growth |
| Wallet Quality | `wallet-cluster.ts` | 100 − cluster risk − clustered supply |
| Deployer Quality | `deployer.ts` | wallet age, tx count, funder known, holdings, own-DB history (rugs/abandoned) — UNKNOWN when nothing is known |
| Social Momentum | `social.ts` | mentions 1h vs 24h average, own-history z-score, author diversity, new-account share, engagement, telegram growth |
| Narrative Momentum | `narrative.ts` | narrative momentum·0.6 + freshness·0.4 − saturation·30 |
| Early Momentum | `early-momentum.ts` | blended 5m/15m/1h holder growth, unique buyers growth, volume acceleration, liquidity growth, buyer dominance, social, capped price; smallness bonus (MC < $250k) |
| Anomaly | `anomaly.ts` | robust z-scores vs population + own history |

## Metrics (multi-timeframe)

`computeMetrics()` derives from the token's own snapshot series (1m/5m/15m/1h/4h/24h):
`holders_growth_*`, `volume_growth_*`, `liquidity_growth_*`, `marketcap_growth_*`, `unique_buyers_growth_*`,
`volume_acceleration_{5m,15m,1h}`, `holders_acceleration_*`, `buy_sell_ratio_{m5,h1}`, `volume_per_holder_h1`,
`liquidity_to_marketcap`, `volume_to_liquidity_{h1,h24}`, `price_acceleration`, `new_holders_per_10k_volume_h1`, `ath_drawdown_pct`.
A window is only computed when a snapshot exists between 0.6× and 2.5× of the window age — never extrapolated. Blends
(5m/15m/1h) stop a single 1-minute signal from dominating.

## Composition

```
score = Σ positive_i = weight_i × subscore_i / 100        (missing sub-scores contribute 0 and are listed in missingSignals)
      − wallet_concentration (top10 > 25%)  − deployer_uncertainty (unknown/low)  − exit_risk (> 30)
      − late_phase / exhausted_phase (NO-FOMO)  − narrative_saturation  − anomalies  − conflicting_signals  − rug_risk (> 20)
```
Default positive weights: early_momentum 18, holder_growth 14, liquidity 12, social 10, narrative 9, market_quality 12,
security 10, deployer 7, wallet_quality 8.

Example output (real structure):
```
OPPORTUNITY 68.4  WATCHLIST  EARLY  MEDIUM_RISK  confidence MEDIUM
 +13.8 early momentum 77/100        +11.9 holder growth +38% / 15m
 +10.6 liquidity score 89           +10.0 security 100
  +6.6 market quality 55            +6.1 wallet quality 76
  +3.5 deployer reputation 50
  -6.0 deployer unknown             -4.0 conflicting signals: momentum may be manufactured by a wallet cluster
```

## Categories

* `HIGH_CONVICTION_SETUP` — score ≥ 72, ≥ 3 *independent* signals (different data families ≥ 60: early momentum, holder
  growth, liquidity, social, market quality), phase EARLY, confidence not LOW, all gates passed.
* `WATCHLIST` — score ≥ 50, phase not EXHAUSTED, gates passed.
* `EXTREME_RISK` — rug level EXTREME (or HIGH with a good score): may pump, is never a setup.
* `NO_OPPORTUNITY` — the default and expected outcome for most tokens.
* Gate-forced: `REJECTED`, `INSUFFICIENT_DATA`, `SECURITY_UNVERIFIED`, `INVESTIGATE`.

## Confidence

HIGH needs ≥ 8 snapshots, data quality ≥ 0.8 and ≥ 6 known sub-scores; MEDIUM needs ≥ 3 snapshots and ≥ 4 sub-scores.
Each 2 conflicts from the adversarial analysis lower confidence one step; ≥ 4 missing signals lower it again.

## Adaptive weights

The statistical learning engine (`src/learning/statistical.ts`) proposes new *positive* weights from resolved outcomes
(median-split lift per feature, bounded ±30 %, total kept constant). Proposals are stored as inactive `model_versions`;
activation is a manual action (`POST /api/learning/activate` or `npx tsx src/tools/learn.ts --apply`). Penalties and
risk gates are never learned.

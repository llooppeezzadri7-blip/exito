# RISK ENGINE

## 1. Rug detector (`src/risk/rug-detector.ts`)

Every analyzer emits flags `{code, severity}`. The detector de-duplicates by code (max severity), multiplies a fixed
per-code weight by a severity factor (LOW 0.5 · MEDIUM 1 · HIGH 1.4 · CRITICAL 1.8) and sums into a **rug index 0–100**.

Highest weights: `REPORTED_RUGGED` 60, `LIQUIDITY_DROP` 40, `MINT_AUTHORITY_ACTIVE` 35, `FREEZE_AUTHORITY_ACTIVE` 35,
`DEPLOYER_PREVIOUS_RUGS` 30, `SUSPICIOUS_PERMISSIONS/PROGRAM` 25, `UNKNOWN_CONFIGURATION` 15, `SUPPLY_CONCENTRATION` 14,
`SUSPICIOUS_WALLET_CLUSTER` 14, `DEPLOYER_HOLDS_SUPPLY` 12, `WHALE_DISTRIBUTION` 12, `WASH_TRADING_SUSPECTED` 12,
`LP_UNLOCKED` 10, `VOLUME_WITHOUT_HOLDERS` 10, `FLAGGED_INSIDERS` 10 … (full table in the source).

Levels: `RELATIVELY_LOW_RISK` (< 15) · `LOW_RISK` · `MEDIUM_RISK` (≥ 30) · `HIGH_RISK` (≥ 55) · `EXTREME_RISK` (≥ 80) ·
`UNKNOWN` (security not verifiable). There is no "SAFE".

## 2. Risk gates (`src/risk/gates.ts`) — deterministic, never learned

| Gate | Condition | Result |
|---|---|---|
| freeze_authority / mint_authority | active | `REJECTED` |
| min_liquidity / min_holders | below `filters.*` | `REJECTED` |
| data_quality | < `risk_gates.min_data_quality_for_opportunity` (0.6) | `INSUFFICIENT_DATA` |
| security_verified | authorities unknown from every source | `SECURITY_UNVERIFIED` |
| security_score | < 55 | `REJECTED` |
| wallet_manipulation | HIGH/CRITICAL `POTENTIAL_CLUSTER` | `INVESTIGATE` |
| rug_risk | > 65 (→ `EXTREME_RISK` when ≥ 80) | not an opportunity |
| exit_risk | > 70 | not an opportunity |

A failed gate forces the category and blocks opportunity alerts, whatever the score.

## 3. NO-FOMO engine (`src/risk/phase.ts`)

`LATE`: +150 %/1h, +400 %/24h, +60 %/5m vertical, price up without liquidity/holders following.
`EXHAUSTED`: 1h volume −60 % vs previous hour, last hour ≪ 6h average after a run-up, −45 % from observed high,
insiders/whales distributing. Penalties: up to −20 (LATE) / −35 (EXHAUSTED). A rising price never makes a token EARLY.

## 4. Exit risk (`src/analyzers/liquidity.ts`)

`100 − depth·0.5 − stability·0.3 − lpLock·0.2`, floored at 85 on a liquidity drop, 90 with freeze authority, 70 when a
$5k sell would move price > 25 % (constant-product estimate). Answers "could I get out?".

## 5. Thesis engine (`src/risk/thesis.ts`)

For tokens that were WATCHLIST/HIGH_CONVICTION: `THESIS_INVALIDATED` (hard flags, liquidity −30 %, rejected/extreme,
score −30), `RISK_ESCALATING` (rug index +15 and ≥ 30), `THESIS_WEAKENING` (score −10, holders −10 %/15m, volume −70 %/1h,
−50 % from high), else `THESIS_INTACT`. Transitions drive `EXIT_WARNING`, `RISK_ESCALATION`, `LIQUIDITY_DROP`,
`WHALE_EXIT`, `RUG_WARNING` alerts and close paper positions.

## 6. Adversarial analysis (`src/scoring/adversarial.ts`)

Independent BULL and BEAR cases from the same facts; the bear case always includes: what invalidates the thesis, what a −70 %
volume scenario implies for exit impact, whale exit vs liquidity, limited history, and "no signal predicts price".
CONFLICTS (e.g. volume up / holders flat, price up / liquidity down, social without on-chain follow-through, retail buying into
whale distribution, momentum + cluster) reduce confidence and score.

## 7. Alerts (`src/alerts`)

Types: NEW_HIGH_POTENTIAL, BREAKOUT_SETUP, RISK_ESCALATION, RUG_WARNING, LIQUIDITY_DROP, WHALE_EXIT, VOLUME_SPIKE,
SOCIAL_SPIKE, NARRATIVE_SPIKE, EXIT_WARNING (+ DATA_SOURCE_DEGRADED in logs/health). Cooldown 45 min per token/type,
max 12/hour globally. Format: facts (age, MC, liquidity, volume), score/risk/exit risk/confidence/phase/data quality,
WHY, RISKS, CONFLICTS, STATUS, contract, sources, timestamp, manual-verification reminder. Never "buy".

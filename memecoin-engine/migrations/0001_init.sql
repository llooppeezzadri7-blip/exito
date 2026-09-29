-- MEMECOIN INTELLIGENCE ENGINE — initial schema. Postgres 14+ (Supabase compatible).
-- Every table carries timestamps. JSONB payloads keep the full typed snapshot for reproducibility.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tokens (
  chain TEXT NOT NULL,
  mint TEXT NOT NULL,
  symbol TEXT,
  name TEXT,
  created_at TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ NOT NULL,
  discovery_sources TEXT[] NOT NULL DEFAULT '{}',
  pair_address TEXT,
  deployer TEXT,
  tier SMALLINT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'NEW',
  reject_reason TEXT,
  category TEXT,
  last_score DOUBLE PRECISION,
  last_risk TEXT,
  last_analyzed_at TIMESTAMPTZ,
  next_analyze_at TIMESTAMPTZ,
  cycles_below_tier INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain, mint)
);
CREATE INDEX IF NOT EXISTS tokens_due_idx ON tokens (status, next_analyze_at);
CREATE INDEX IF NOT EXISTS tokens_score_idx ON tokens (last_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS tokens_deployer_idx ON tokens (chain, deployer);

CREATE TABLE IF NOT EXISTS token_snapshots (
  id BIGSERIAL PRIMARY KEY,
  chain TEXT NOT NULL,
  mint TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  price_usd DOUBLE PRECISION,
  market_cap_usd DOUBLE PRECISION,
  liquidity_usd DOUBLE PRECISION,
  volume_m5_usd DOUBLE PRECISION,
  volume_h1_usd DOUBLE PRECISION,
  volume_h24_usd DOUBLE PRECISION,
  buys_h1 INT, sells_h1 INT, buys_m5 INT, sells_m5 INT,
  holders INT,
  unique_buyers_h1 INT,
  unique_sellers_h1 INT,
  top10_pct DOUBLE PRECISION,
  data_quality DOUBLE PRECISION NOT NULL DEFAULT 0,
  sources TEXT[] NOT NULL DEFAULT '{}',
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS token_snapshots_token_idx ON token_snapshots (chain, mint, observed_at);
CREATE INDEX IF NOT EXISTS token_snapshots_time_idx ON token_snapshots (observed_at);

-- Denormalized time series required by the spec (written together with token_snapshots).
CREATE TABLE IF NOT EXISTS liquidity_snapshots (
  id BIGSERIAL PRIMARY KEY,
  snapshot_id BIGINT REFERENCES token_snapshots(id) ON DELETE CASCADE,
  chain TEXT NOT NULL, mint TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  liquidity_usd DOUBLE PRECISION, market_cap_usd DOUBLE PRECISION,
  source TEXT
);
CREATE INDEX IF NOT EXISTS liquidity_snapshots_idx ON liquidity_snapshots (chain, mint, observed_at);

CREATE TABLE IF NOT EXISTS holder_snapshots (
  id BIGSERIAL PRIMARY KEY,
  snapshot_id BIGINT REFERENCES token_snapshots(id) ON DELETE CASCADE,
  chain TEXT NOT NULL, mint TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  holders INT, top10_pct DOUBLE PRECISION,
  source TEXT
);
CREATE INDEX IF NOT EXISTS holder_snapshots_idx ON holder_snapshots (chain, mint, observed_at);

CREATE TABLE IF NOT EXISTS pools (
  chain TEXT NOT NULL, mint TEXT NOT NULL, pair_address TEXT NOT NULL,
  dex_id TEXT, quote_symbol TEXT,
  liquidity_usd DOUBLE PRECISION, price_usd DOUBLE PRECISION,
  pair_created_at TIMESTAMPTZ,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain, mint, pair_address)
);

CREATE TABLE IF NOT EXISTS holders (
  chain TEXT NOT NULL, mint TEXT NOT NULL, address TEXT NOT NULL,
  owner TEXT, amount DOUBLE PRECISION, pct DOUBLE PRECISION,
  is_lp_pool BOOLEAN NOT NULL DEFAULT false, label TEXT,
  observed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (chain, mint, address)
);

CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  chain TEXT NOT NULL, mint TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL,
  wallet TEXT, amount_usd DOUBLE PRECISION, amount_token DOUBLE PRECISION, price_usd DOUBLE PRECISION,
  tx_hash TEXT, source TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  UNIQUE (chain, mint, dedupe_key)
);
CREATE INDEX IF NOT EXISTS transactions_token_idx ON transactions (chain, mint, ts);

CREATE TABLE IF NOT EXISTS wallets (
  chain TEXT NOT NULL, address TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ, tx_count INT, funded_by TEXT, funded_at TIMESTAMPTZ, balance DOUBLE PRECISION,
  tags TEXT[] NOT NULL DEFAULT '{}',
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain, address)
);

CREATE TABLE IF NOT EXISTS wallet_clusters (
  id TEXT PRIMARY KEY,
  chain TEXT NOT NULL, mint TEXT NOT NULL,
  wallets TEXT[] NOT NULL,
  kind TEXT NOT NULL DEFAULT 'POTENTIAL_CLUSTER',
  risk_score DOUBLE PRECISION NOT NULL,
  supply_pct DOUBLE PRECISION,
  evidence JSONB NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS wallet_clusters_token_idx ON wallet_clusters (chain, mint);

CREATE TABLE IF NOT EXISTS deployers (
  chain TEXT NOT NULL, address TEXT NOT NULL,
  tokens_created INT NOT NULL DEFAULT 0,
  tokens_rugged INT NOT NULL DEFAULT 0,
  tokens_abandoned INT NOT NULL DEFAULT 0,
  reputation_score DOUBLE PRECISION,
  reputation TEXT NOT NULL DEFAULT 'UNKNOWN',
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (chain, address)
);

CREATE TABLE IF NOT EXISTS social_mentions (
  id BIGSERIAL PRIMARY KEY,
  chain TEXT NOT NULL, mint TEXT NOT NULL,
  platform TEXT NOT NULL, author_id TEXT, author_age_days DOUBLE PRECISION,
  text TEXT, url TEXT, posted_at TIMESTAMPTZ NOT NULL, engagement DOUBLE PRECISION,
  source TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  UNIQUE (chain, mint, dedupe_key)
);
CREATE INDEX IF NOT EXISTS social_mentions_idx ON social_mentions (chain, mint, posted_at);

CREATE TABLE IF NOT EXISTS social_snapshots (
  id BIGSERIAL PRIMARY KEY,
  chain TEXT NOT NULL, mint TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  mentions_1h INT, mentions_24h INT, unique_authors_24h INT, new_account_share DOUBLE PRECISION,
  engagement_24h DOUBLE PRECISION, sentiment DOUBLE PRECISION,
  telegram_members INT, twitter_followers INT, score DOUBLE PRECISION,
  sources TEXT[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS social_snapshots_idx ON social_snapshots (chain, mint, observed_at);

CREATE TABLE IF NOT EXISTS narratives (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  keywords TEXT[] NOT NULL,
  tokens_count INT NOT NULL DEFAULT 0,
  mentions_24h INT NOT NULL DEFAULT 0,
  momentum DOUBLE PRECISION, freshness DOUBLE PRECISION, saturation DOUBLE PRECISION,
  first_seen_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_events (
  id BIGSERIAL PRIMARY KEY,
  chain TEXT NOT NULL, mint TEXT NOT NULL,
  type TEXT NOT NULL, severity TEXT NOT NULL, message TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS risk_events_token_idx ON risk_events (chain, mint, at);
CREATE INDEX IF NOT EXISTS risk_events_time_idx ON risk_events (at);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  chain TEXT NOT NULL, mint TEXT NOT NULL,
  type TEXT NOT NULL, severity TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  channels TEXT[] NOT NULL DEFAULT '{}',
  delivered_to TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  error TEXT
);
CREATE INDEX IF NOT EXISTS alerts_token_idx ON alerts (chain, mint, type, created_at);
CREATE INDEX IF NOT EXISTS alerts_time_idx ON alerts (created_at);

CREATE TABLE IF NOT EXISTS opportunities (
  chain TEXT NOT NULL, mint TEXT NOT NULL,
  score DOUBLE PRECISION, category TEXT NOT NULL, confidence TEXT NOT NULL, phase TEXT NOT NULL,
  risk TEXT NOT NULL, rug_risk DOUBLE PRECISION, exit_risk DOUBLE PRECISION, data_quality DOUBLE PRECISION NOT NULL,
  thesis TEXT NOT NULL,
  data JSONB NOT NULL,
  snapshot_id BIGINT,
  computed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (chain, mint)
);
CREATE INDEX IF NOT EXISTS opportunities_score_idx ON opportunities (category, score DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY,
  chain TEXT NOT NULL, mint TEXT NOT NULL,
  made_at TIMESTAMPTZ NOT NULL,
  horizon_hours DOUBLE PRECISION NOT NULL,
  resolve_at TIMESTAMPTZ NOT NULL,
  category TEXT NOT NULL, score DOUBLE PRECISION, confidence TEXT NOT NULL,
  features JSONB NOT NULL,
  price_at DOUBLE PRECISION, market_cap_at DOUBLE PRECISION, liquidity_at DOUBLE PRECISION,
  model_version TEXT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS predictions_due_idx ON predictions (resolved, resolve_at);
CREATE INDEX IF NOT EXISTS predictions_token_idx ON predictions (chain, mint, made_at);

CREATE TABLE IF NOT EXISTS feature_values (
  prediction_id TEXT NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value DOUBLE PRECISION,
  PRIMARY KEY (prediction_id, name)
);

CREATE TABLE IF NOT EXISTS outcomes (
  id BIGSERIAL PRIMARY KEY,
  prediction_id TEXT NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  chain TEXT NOT NULL, mint TEXT NOT NULL,
  horizon_hours DOUBLE PRECISION NOT NULL,
  price_at DOUBLE PRECISION, price_after DOUBLE PRECISION,
  return_pct DOUBLE PRECISION, max_return_pct DOUBLE PRECISION, min_return_pct DOUBLE PRECISION,
  liquidity_at DOUBLE PRECISION, liquidity_after DOUBLE PRECISION,
  label TEXT NOT NULL,
  resolved_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_trades (
  id TEXT PRIMARY KEY,
  chain TEXT NOT NULL, mint TEXT NOT NULL, symbol TEXT,
  opened_at TIMESTAMPTZ NOT NULL, closed_at TIMESTAMPTZ,
  entry_price_usd DOUBLE PRECISION NOT NULL, entry_fill_price_usd DOUBLE PRECISION NOT NULL,
  size_usd DOUBLE PRECISION NOT NULL, tokens DOUBLE PRECISION NOT NULL, fees_usd DOUBLE PRECISION NOT NULL, slippage_pct DOUBLE PRECISION NOT NULL,
  exit_price_usd DOUBLE PRECISION, exit_fill_price_usd DOUBLE PRECISION,
  pnl_usd DOUBLE PRECISION, pnl_pct DOUBLE PRECISION,
  peak_price_usd DOUBLE PRECISION NOT NULL, trough_price_usd DOUBLE PRECISION NOT NULL, max_drawdown_pct DOUBLE PRECISION NOT NULL,
  reason TEXT NOT NULL, exit_reason TEXT,
  score_at_entry DOUBLE PRECISION, opportunity_category TEXT,
  status TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS paper_trades_status_idx ON paper_trades (status, opened_at);

CREATE TABLE IF NOT EXISTS model_versions (
  version TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  weights JSONB NOT NULL,
  metrics JSONB NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  subject TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS audit_subject_idx ON audit_logs (subject, at);

CREATE TABLE IF NOT EXISTS jobs (
  id BIGSERIAL PRIMARY KEY,
  queue TEXT NOT NULL,
  payload JSONB NOT NULL,
  run_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dedupe_key TEXT
);
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs (queue, status, run_at);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedupe_idx ON jobs (dedupe_key) WHERE status IN ('PENDING','RUNNING') AND dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS health_snapshots (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL
);
